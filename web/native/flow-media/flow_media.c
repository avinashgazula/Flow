/* Marquee's universal media engine: FFmpeg's demuxers, mov muxer, audio decoders, resampler and FLAC and AAC
   encoders behind a small C ABI, built to one WebAssembly module (web/scripts/build-media-engine.sh).

   It turns any container a source hands the page (AVI, MPEG-TS, MP4, WMV, FLV, Ogg, ...) into the two
   fragmented-MP4 streams that Media Source Extensions play, one for the picture and one for the sound. The
   picture is copied as it is, or, when the browser has no decoder for it, decoded here (the video build only,
   FM_VIDEO) and handed to the page as plain frames, which the page encodes again with WebCodecs and gives back
   packet by packet to the same muxer. The sound is copied when the browser plays that codec in MP4, and
   otherwise decoded, mixed to stereo or 5.1 at 48 kHz and encoded again as FLAC or AAC.

   Calling convention (src/lib/media/engine.ts is the only caller; every number is an int or a double, every
   pointer an offset into the module's memory):

     the host provides   fm_js_read(buf, size) -> bytes read (0 at the end, < 0 on failure)
                         fm_js_seek(offset, whence) -> the new position, or the file's length for whence 0x10000
                         The file is always read through these two: the host keeps a block cache, fills it ahead of
                         the read position with parallel range requests, and falls back to a blocking request for a
                         read the cache doesn't have (the probe, an index at the end, a seek). The module never waits
                         on anything else, and does a bounded amount of work per call.

     fm_open()           opens the input and reads its stream parameters; 0, or a negative FFmpeg error
     fm_strerror(code)   a message for an error code
     fm_streams(), fm_stream_info(i, key), fm_stream_str(i, key), fm_stream_extradata(i), fm_can_decode(i)
     fm_duration_ms(), fm_offset_ms(), fm_chapters(), fm_chapter(i, key)
     fm_start(video, audio, mode, at_ms, floor_ms, flags)
                         begins (or begins again) at a media time: reads from the keyframe at or before it.
                         video / audio: stream indexes, -1 for none. mode: 0 copy the sound, 1 convert to FLAC,
                         2 convert to AAC. flags: 1 keep 5.1 in converted sound, 2 convert the picture (below).
                         floor_ms: video before this time is already buffered and is skipped (an audio switch),
                         0 for none.
     fm_step(max_bytes)  reads about that many bytes of the file and routes the packets; 0 more to come, 1 at
                         the end of the file (everything is then flushed), < 0 an error
     fm_out_next()       the next piece of output: its length, 0 when there is none. Then fm_out_ptr(),
                         fm_out_kind() (0 picture, 1 sound) and fm_out_pos() say where it is and what it is.
                         The bytes are whole boxes: ftyp and moov (the init segment), then moof and mdat pairs.
     fm_info(key)        counters and facts about the run (see INFO_*)
     fm_close()

   Converting the picture (flag 2 of fm_start, video build only). The step decodes the picture instead of copying
   it and queues each frame as output of kind 2: whole frames of planar 8-bit 4:2:0 (Y, then U, then V, no padding,
   an even width and height locked on the first frame), in presentation order, already on the timeline, 10-bit and
   4:2:2 or 4:4:4 sources reduced to it and interlaced frames blended. fm_out_info(key) says what a frame is: 1 its
   time in microseconds, 2 its duration, 3 and 4 its size, 5 how it was handled (bit 0 interlaced, bit 1 full range
   made limited), 6 and 7 the pixel aspect ratio, 8 the colour matrix (an AVCOL_SPC_* value). The page encodes the
   frames and hands the encoder's packets back:
     fm_scratch(size)    a buffer of at least `size` bytes inside the module, for what the page passes in
     fm_video_open(width, height, sar_num, sar_den, extradata_len)
                         opens the picture's muxer for H.264 in AVC form; the avcC record is in the scratch buffer
     fm_video_packet(length, pts_us, dur_us, key)
                         one encoded packet, in the scratch buffer; times are on the timeline, in microseconds
     fm_video_end()      the encoder is flushed: write the last fragment
     fm_video_tune(bits) 1 skip frames nothing refers to, 2 also skip the loop filter (both trade picture for speed when
                         the device can't keep up), 4 leave interlaced frames as they are (a diagnostic)
   A step returns after a few frames (FRAME_BATCH), so the page can encode them before more are decoded.

   Time: the file's own timestamps are moved so the earliest packet sits at zero (an MPEG-TS file starts a second
   or so in), and a jump in the stream (a splice, a reset clock) is closed up so the output is one continuous
   timeline. The host never sees the file's time, only the timeline: media time = file time - fm_offset_ms().

   Nothing here touches stdio: FFmpeg's logging is replaced by functions that drop every message. */

#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavcodec/bsf.h>
#include <libavformat/avformat.h>
#include <libavformat/avio.h>
#include <libavutil/audio_fifo.h>
#include <libavutil/channel_layout.h>
#include <libavutil/downmix_info.h>
#include <libavutil/error.h>
#include <libavutil/frame.h>
#include <libavutil/log.h>
#include <libavutil/mathematics.h>
#include <libavutil/opt.h>
#include <libavutil/pixdesc.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>

#define IMPORT(name) __attribute__((import_module("env"), import_name(name)))
IMPORT("fm_js_read") extern int js_read(uint8_t *buf, int size);
IMPORT("fm_js_seek") extern double js_seek(double offset, int whence);

#ifndef FM_VIDEO
#define FM_VIDEO 0 /* 1: the build with the picture decoders */
#endif

enum { MODE_COPY = 0, MODE_FLAC = 1, MODE_AAC = 2 };
enum { FLAG_SURROUND = 1, FLAG_CONVERT_VIDEO = 2 };
enum { KIND_VIDEO = 0, KIND_AUDIO = 1, KIND_FRAME = 2 };
enum { TUNE_SKIP_NONREF = 1, TUNE_SKIP_LOOP = 2, TUNE_KEEP_INTERLACED = 4 };
/* A step hands the page at most this many decoded frames: they are big, and the page encodes them before asking for more. */
#define FRAME_BATCH 4
/* A picture decoder that fails on this many packets in a row, with no frame between, is a picture that can't be played. */
#define MAX_VIDEO_ERRORS 200
enum {
  INFO_AUDIO_FAILED = 1,   /* the converted sound gave up (no decoder, or every packet fails): the picture plays on without it */
  INFO_AUDIO_ERRORS = 2,   /* packets the decoder refused, this run */
  INFO_SEEK_FAILED = 3,    /* the file can't be moved to the time asked for (it was read from its start instead) */
  INFO_BYTES = 4,          /* where the input is now, in bytes */
  INFO_VIDEO_PACKETS = 5,
  INFO_AUDIO_PACKETS = 6,
  INFO_DISCONTINUITIES = 7,
  INFO_START_MS = 8,       /* where the first picture of this run is on the timeline (it can be before `at`) */
  INFO_OUT_CHANNELS = 9,   /* converted sound: 2 or 6 */
  INFO_BITRATE = 10,       /* the container's overall bit rate, 0 when it doesn't say */
  INFO_AUDIO_ERROR = 11,   /* the FFmpeg error code of the last audio failure */
  INFO_AUDIO_START_MS = 12, /* where the converted sound begins on the timeline, -1 before it has */
  INFO_VIDEO_FRAMES = 13,   /* converted picture: frames decoded and handed to the page, this run */
  INFO_VIDEO_FAILED = 14,   /* converted picture: the decoder gave up (no decoder, or every packet fails) */
  INFO_VIDEO_ERRORS = 15,   /* packets the picture decoder refused, this run */
  INFO_INTERLACED = 16,     /* frames that were flagged interlaced and blended, this run */
  INFO_VIDEO_ERROR = 17,    /* the FFmpeg error code of the last picture failure */
  INFO_VIDEO_DROPPED = 18   /* frames decoded and dropped for coming before the time the run began at */
};
enum { OUT_RATE = 48000 };
/* A jump of the packet clock this far backwards, or this far forwards, is a break in the stream, not play. */
#define JUMP_BACK_US 500000
#define JUMP_FORWARD_US 10000000
/* Converted sound: silence stands in for a gap shorter than this (a dropped packet, a splice); a longer one restarts the clock. */
#define MAX_PAD_SAMPLES (30 * OUT_RATE)
#define GAP_TOLERANCE_SAMPLES (OUT_RATE / 20)
#define MAX_RESEEKS 4
#define CALIBRATE_PACKETS 600
#define IO_BUFFER 65536

/* ---- The output side: one fragmented MP4 per kind of track ---- */

typedef struct {
  AVFormatContext *oc;
  AVStream *ost;
  AVIOContext *pb;
  uint8_t *buf; /* what the muxer has written and the host hasn't yet taken */
  size_t len, cap;
  int64_t last_dts; /* in the output stream's time base; INT64_MIN before the first packet */
  int64_t last_dur;
  int64_t last_end_us; /* the end of the last packet, on the timeline, for gap and jump checks */
} Out;

typedef struct {
  AVCodecContext *dec;
  AVCodecContext *enc;
  SwrContext *swr;
  AVAudioFifo *fifo;
  AVFrame *in, *rs;
  AVPacket *epkt;
  AVChannelLayout layout;
  int enc_fmt;
  int frame_size;
  int64_t fifo_end;  /* the timeline position (in OUT_RATE samples) the fifo's last sample ends at; INT64_MIN before the first */
  int64_t enc_pts;   /* the pts the next encoded frame starts at, in OUT_RATE samples */
  int64_t first_pts; /* where the first sample sits, in OUT_RATE samples; INT64_MIN before it */
  int swr_ready;
  int src_channels;
  int errors_in_a_row;
  int mode;
  int surround;
} Conv;

/* A piece of output. Fragments and init segments are copies the queue owns; a frame's pixels are the queue's too, and
   `pts`, `dur`, `w`, `h`, `flags`, `sar_*` and `matrix` say what the frame is (fm_out_info). */
typedef struct {
  int kind, init;
  uint8_t *ptr;
  size_t len;
  int64_t pts, dur;
  int w, h, flags, sar_num, sar_den, matrix;
} Chunk;

/* Converting the picture: the decoder, and what the frames are being made into. */
typedef struct {
  AVCodecContext *dec;
  AVFrame *frame;
  uint8_t *row; /* two rows of one source plane reduced to 8 bits */
  size_t row_cap;
  int out_w, out_h; /* locked by the first frame */
  int sar_num, sar_den;
  int64_t frames, errors_in_a_row;
  int64_t next_file_us; /* where a frame that carries no time goes: after the last one */
  int64_t last_dur_us;
  int64_t last_t; /* the last frame's place on the timeline, to keep them strictly in order */
  int64_t first_file_us;
  int range_full;
  uint8_t lut_y[256], lut_c[256];
} VConv;

typedef struct {
  AVFormatContext *ic;
  AVIOContext *io;
  AVPacket *pkt;
  int64_t offset_us;  /* the file's clock at media time zero */
  int64_t shift[2];   /* what closing up jumps in each track has added, this run */
  int vidx, aidx, mode, surround;
  int convert_video, tune, video_failed, video_error, frames_out;
  int64_t video_errors, interlaced, dropped;
  VConv *vconv;
  uint8_t *scratch; /* what the page hands in: an avcC record, an encoded packet */
  size_t scratch_cap;
  int64_t at_us, floor_us;
  int reseeks;
  int v_started, a_started;
  int eof;
  int seek_failed;
  int audio_failed;
  int64_t v_first_us;
  int64_t jumps;
  int64_t video_packets, audio_packets;
  int64_t audio_errors;
  int audio_error;
  int consumed; /* packets have been read since the file was opened or last moved */
  Out out[2];
  Conv *conv;
  AVBSFContext *adts;
  AVBSFContext *extra;
  Chunk cur;
  /* The queue of output pieces the host hasn't collected. */
  Chunk *queue;
  int q_len, q_cap, q_head;
  char err[96];
  char str[256];
} FM;

static FM *M;

static void *grow(void *p, size_t *cap, size_t need) {
  if (need <= *cap) return p;
  size_t n = *cap ? *cap : 65536;
  while (n < need) n *= 2;
  void *q = realloc(p, n);
  if (!q) return NULL;
  *cap = n;
  return q;
}

static int64_t to_us(int64_t ts, AVRational tb) { return av_rescale_q(ts, tb, AV_TIME_BASE_Q); }

/* ---- Reading: the host's read and seek behind an AVIO context ---- */

static int io_read(void *opaque, uint8_t *buf, int size) {
  (void)opaque;
  int n = js_read(buf, size);
  if (n < 0) return AVERROR(EIO);
  return n == 0 ? AVERROR_EOF : n;
}

static int64_t io_seek(void *opaque, int64_t offset, int whence) {
  (void)opaque;
  if (whence & AVSEEK_SIZE) {
    double size = js_seek(0, 0x10000);
    return size < 0 ? AVERROR(ENOSYS) : (int64_t)size;
  }
  double pos = js_seek((double)offset, whence & ~AVSEEK_FORCE);
  return pos < 0 ? AVERROR(EIO) : (int64_t)pos;
}

/* ---- The queue of output the host collects ---- */

static int queue_room(FM *m) {
  if (m->q_len == m->q_cap) {
    if (m->q_head > 0) {
      memmove(m->queue, m->queue + m->q_head, (size_t)(m->q_len - m->q_head) * sizeof(Chunk));
      m->q_len -= m->q_head;
      m->q_head = 0;
    }
    if (m->q_len == m->q_cap) {
      int cap = m->q_cap ? m->q_cap * 2 : 16;
      Chunk *q = realloc(m->queue, (size_t)cap * sizeof(Chunk));
      if (!q) return 0;
      m->queue = q;
      m->q_cap = cap;
    }
  }
  return 1;
}

static void queue_push(FM *m, int kind, const uint8_t *data, size_t len) {
  if (!queue_room(m)) return;
  uint8_t *copy = malloc(len);
  if (!copy) return;
  memcpy(copy, data, len);
  m->queue[m->q_len++] = (Chunk){.kind = kind, .ptr = copy, .len = len};
}

#if FM_VIDEO
/* A decoded frame: the queue takes over `pixels`. */
static int queue_push_frame(FM *m, uint8_t *pixels, size_t len, const Chunk *info) {
  if (!queue_room(m)) {
    free(pixels);
    return AVERROR(ENOMEM);
  }
  Chunk c = *info;
  c.kind = KIND_FRAME;
  c.ptr = pixels;
  c.len = len;
  m->queue[m->q_len++] = c;
  return 0;
}
#endif

static void queue_clear(FM *m) {
  for (int i = m->q_head; i < m->q_len; i++) free(m->queue[i].ptr);
  m->q_len = m->q_head = 0;
  free(m->cur.ptr);
  m->cur = (Chunk){0};
}

/* ---- The muxers ---- */

static int out_write(void *opaque, const uint8_t *buf, int size) {
  Out *o = opaque;
  uint8_t *p = grow(o->buf, &o->cap, o->len + (size_t)size);
  if (!p) return AVERROR(ENOMEM);
  o->buf = p;
  memcpy(o->buf + o->len, buf, (size_t)size);
  o->len += (size_t)size;
  return size;
}

/* Hands what the muxer has written so far to the host. Called after every packet, so each call's output is
   exactly the box or boxes that packet completed: an init segment and/or one whole fragment. */
static void out_flush(FM *m, int kind) {
  Out *o = &m->out[kind];
  if (o->pb) avio_flush(o->pb);
  if (o->len) queue_push(m, kind, o->buf, o->len);
  o->len = 0;
}

static void out_close(Out *o) {
  if (o->oc) {
    if (o->pb) {
      av_freep(&o->pb->buffer);
      avio_context_free(&o->pb);
    }
    o->oc->pb = NULL;
    avformat_free_context(o->oc);
  }
  free(o->buf);
  memset(o, 0, sizeof(*o));
}

static void conv_free(Conv *c) {
  if (!c) return;
  avcodec_free_context(&c->dec);
  avcodec_free_context(&c->enc);
  swr_free(&c->swr);
  if (c->fifo) av_audio_fifo_free(c->fifo);
  av_frame_free(&c->in);
  av_frame_free(&c->rs);
  av_packet_free(&c->epkt);
  av_channel_layout_uninit(&c->layout);
  free(c);
}

#if FM_VIDEO
static void vconv_free(VConv *v) {
  if (!v) return;
  avcodec_free_context(&v->dec);
  av_frame_free(&v->frame);
  free(v->row);
  free(v);
}
#endif

/* Forgets everything of the previous run: the outputs (their time starts again), the converter, the queue. */
static void reset_run(FM *m) {
  out_close(&m->out[0]);
  out_close(&m->out[1]);
  conv_free(m->conv);
  m->conv = NULL;
#if FM_VIDEO
  vconv_free(m->vconv);
  m->vconv = NULL;
#endif
  m->video_failed = m->video_error = m->frames_out = 0;
  m->video_errors = m->interlaced = m->dropped = 0;
  av_bsf_free(&m->adts);
  av_bsf_free(&m->extra);
  queue_clear(m);
  m->v_started = m->a_started = 0;
  m->eof = 0;
  m->audio_failed = 0;
  m->audio_error = 0;
  m->jumps = m->video_packets = m->audio_packets = m->audio_errors = 0;
  m->v_first_us = AV_NOPTS_VALUE;
  for (int k = 0; k < 2; k++) {
    m->out[k].last_dts = INT64_MIN;
    m->out[k].last_end_us = AV_NOPTS_VALUE;
  }
  m->shift[0] = m->shift[1] = 0;
}

/* Opens a fragmented-MP4 muxer for one track. `par` is what the track is, `in_tb` the clock its packets use.
   The moov is held back until the first fragment is cut (delay_moov), so codecs that learn their parameters from
   the first packets (E-AC-3, HEVC without a config record, ADTS AAC) get them into the init segment. */
static int out_open(FM *m, int kind, const AVCodecParameters *par, AVRational in_tb, AVRational sar) {
  Out *o = &m->out[kind];
  int r = avformat_alloc_output_context2(&o->oc, NULL, "mp4", NULL);
  if (r < 0) return r;
  uint8_t *iobuf = av_malloc(32768);
  if (!iobuf) return AVERROR(ENOMEM);
  o->pb = avio_alloc_context(iobuf, 32768, 1, o, NULL, out_write, NULL);
  if (!o->pb) {
    av_free(iobuf);
    return AVERROR(ENOMEM);
  }
  o->oc->pb = o->pb;
  o->oc->flags |= AVFMT_FLAG_CUSTOM_IO | AVFMT_FLAG_FLUSH_PACKETS;
  o->ost = avformat_new_stream(o->oc, NULL);
  if (!o->ost) return AVERROR(ENOMEM);
  r = avcodec_parameters_copy(o->ost->codecpar, par);
  if (r < 0) return r;
  o->ost->codecpar->codec_tag = par->codec_id == AV_CODEC_ID_HEVC ? MKTAG('h', 'v', 'c', '1') : 0;
  o->ost->time_base = in_tb;
  if (sar.num > 0 && sar.den > 0) {
    o->ost->sample_aspect_ratio = sar;
    o->ost->codecpar->sample_aspect_ratio = sar;
  }
  AVDictionary *opts = NULL;
  /* default_base_moof and no edit list: Media Source Extensions want self-contained fragments with plain times.
     Fragments are cut at key frames (at least a second long), or every second for sound. */
  av_dict_set(&opts, "movflags", kind == KIND_VIDEO ? "delay_moov+default_base_moof+frag_discont+negative_cts_offsets+frag_keyframe" : "delay_moov+default_base_moof+frag_discont", 0);
  av_dict_set(&opts, "use_editlist", "0", 0);
  /* Times are already on the timeline: the muxer must not move the first packet to zero (it would, with no edit list). */
  av_dict_set(&opts, "avoid_negative_ts", "disabled", 0);
  if (kind == KIND_VIDEO) {
    av_dict_set(&opts, "min_frag_duration", "1000000", 0);
    av_dict_set(&opts, "frag_duration", "6000000", 0);
  } else {
    av_dict_set(&opts, "frag_duration", "1000000", 0);
  }
  r = avformat_write_header(o->oc, &opts);
  av_dict_free(&opts);
  if (r < 0) return r;
  out_flush(m, kind);
  return 0;
}

/* Parameter sets of a stream that doesn't carry a config record (MPEG-TS, AVI): the first key frame has them. */
static int fill_extradata(AVCodecParameters *par, const AVPacket *pkt) {
  if (par->extradata_size > 0) return 0;
  if (par->codec_id != AV_CODEC_ID_H264 && par->codec_id != AV_CODEC_ID_HEVC && par->codec_id != AV_CODEC_ID_AV1 && par->codec_id != AV_CODEC_ID_MPEG4) return 0;
  const AVBitStreamFilter *f = av_bsf_get_by_name("extract_extradata");
  if (!f) return 0;
  AVBSFContext *b = NULL;
  if (av_bsf_alloc(f, &b) < 0) return 0;
  avcodec_parameters_copy(b->par_in, par);
  b->time_base_in = (AVRational){1, 90000};
  if (av_bsf_init(b) < 0) {
    av_bsf_free(&b);
    return 0;
  }
  AVPacket *copy = av_packet_clone(pkt);
  if (copy && av_bsf_send_packet(b, copy) >= 0) {
    AVPacket *res = av_packet_alloc();
    if (res && av_bsf_receive_packet(b, res) >= 0) {
      size_t size = 0;
      uint8_t *side = av_packet_get_side_data(res, AV_PKT_DATA_NEW_EXTRADATA, &size);
      if (side && size > 0 && size < (1 << 20)) {
        par->extradata = av_mallocz(size + AV_INPUT_BUFFER_PADDING_SIZE);
        if (par->extradata) {
          memcpy(par->extradata, side, size);
          par->extradata_size = (int)size;
        }
      }
    }
    av_packet_free(&res);
  }
  av_packet_free(&copy);
  av_bsf_free(&b);
  return 0;
}

/* ---- Copying a track ---- */

/* The packet's time on the timeline, closing up breaks in the stream: after a jump the clock carries on from
   where the last packet ended. Each track keeps its own account, so a splice that moves both clocks the same
   way is closed in both, and the two stay together to within how far the file's interleaving had them apart. */
static int64_t timeline_us(FM *m, int kind, int64_t file_us, int64_t dur_us) {
  Out *o = &m->out[kind];
  int64_t t = file_us - m->offset_us + m->shift[kind];
  if (o->last_end_us != AV_NOPTS_VALUE) {
    int64_t d = t - o->last_end_us;
    if (d < -JUMP_BACK_US || d > JUMP_FORWARD_US) {
      m->shift[kind] -= d;
      t -= d;
      m->jumps++;
    }
  }
  o->last_end_us = t + (dur_us > 0 ? dur_us : 0);
  return t;
}

/* AAC from a transport stream or an .aac file is ADTS: every frame carries its own header, and the muxer wants
   the headers gone and a config record in the init segment. The filter makes the record from the first packet. */
static int adts_open(FM *m, AVStream *ist, AVPacket *pkt, AVCodecParameters *par) {
  const AVBitStreamFilter *f = av_bsf_get_by_name("aac_adtstoasc");
  if (!f) return AVERROR_BSF_NOT_FOUND;
  int r = av_bsf_alloc(f, &m->adts);
  if (r < 0) return r;
  avcodec_parameters_copy(m->adts->par_in, ist->codecpar);
  m->adts->time_base_in = ist->time_base;
  r = av_bsf_init(m->adts);
  if (r < 0) return r;
  /* Feeding the first packet is what makes the filter work out the config: peek with a copy. */
  AVPacket *copy = av_packet_clone(pkt);
  if (!copy) return AVERROR(ENOMEM);
  r = av_bsf_send_packet(m->adts, copy);
  if (r >= 0) {
    AVPacket *res = av_packet_alloc();
    if (res && av_bsf_receive_packet(m->adts, res) >= 0) {
      av_packet_free(&res);
    } else {
      av_packet_free(&res);
    }
  }
  if (m->adts->par_out->extradata_size > 0) {
    av_freep(&par->extradata);
    par->extradata = av_mallocz(m->adts->par_out->extradata_size + AV_INPUT_BUFFER_PADDING_SIZE);
    if (!par->extradata) return AVERROR(ENOMEM);
    memcpy(par->extradata, m->adts->par_out->extradata, m->adts->par_out->extradata_size);
    par->extradata_size = m->adts->par_out->extradata_size;
  }
  /* A fresh filter for the real run, so the first packet isn't lost to the peek. */
  av_bsf_free(&m->adts);
  r = av_bsf_alloc(f, &m->adts);
  if (r < 0) return r;
  avcodec_parameters_copy(m->adts->par_in, ist->codecpar);
  m->adts->time_base_in = ist->time_base;
  return av_bsf_init(m->adts);
}

static int is_adts(const AVStream *ist, const AVPacket *pkt) {
  return ist->codecpar->codec_id == AV_CODEC_ID_AAC && ist->codecpar->extradata_size == 0 && pkt->size > 7 && pkt->data[0] == 0xff && (pkt->data[1] & 0xf0) == 0xf0;
}

/* Writes a packet unchanged (apart from its time) into the track's muxer. `tb` is the packet's clock. */
static int write_copy(FM *m, int kind, AVStream *ist, AVPacket *pkt) {
  Out *o = &m->out[kind];
  AVRational tb = ist->time_base;
  int64_t dts = pkt->dts != AV_NOPTS_VALUE ? pkt->dts : pkt->pts;
  int64_t pts = pkt->pts != AV_NOPTS_VALUE ? pkt->pts : dts;
  if (dts == AV_NOPTS_VALUE) return 0;
  int64_t dur_us = pkt->duration > 0 ? to_us(pkt->duration, tb) : 0;
  int64_t t_us = timeline_us(m, kind, to_us(dts, tb), dur_us);
  /* Sound that ends before the timeline begins (an encoder's start-up padding) is dropped; sound that straddles it starts at zero. */
  if (kind == KIND_AUDIO && t_us + dur_us <= 0) return 0;
  if (!o->oc) {
    AVCodecParameters *par = avcodec_parameters_alloc();
    if (!par) return AVERROR(ENOMEM);
    avcodec_parameters_copy(par, ist->codecpar);
    if (kind == KIND_VIDEO) fill_extradata(par, pkt);
    if (kind == KIND_AUDIO && is_adts(ist, pkt)) {
      int r = adts_open(m, ist, pkt, par);
      if (r < 0) {
        avcodec_parameters_free(&par);
        return r;
      }
    }
    int r = out_open(m, kind, par, tb, ist->sample_aspect_ratio.num ? ist->sample_aspect_ratio : par->sample_aspect_ratio);
    avcodec_parameters_free(&par);
    if (r < 0) return r;
  }
  AVRational otb = o->ost->time_base;
  /* The file's clock to the output's, then the offset taken off in the output's own units, so the spacing of
     packets stays exact (no rounding through microseconds). */
  int64_t adj = av_rescale_q(m->offset_us - m->shift[kind], AV_TIME_BASE_Q, otb);
  int64_t odts = av_rescale_q(dts, tb, otb) - adj;
  int64_t opts = av_rescale_q(pts, tb, otb) - adj;
  /* A picture's decode time can be before the timeline's zero (B-frames): the muxer moves it, and the presentation time stays. */
  if (kind == KIND_AUDIO && odts < 0) odts = 0;
  if (o->last_dts != INT64_MIN && odts <= o->last_dts) odts = o->last_dts + 1;
  if (opts < odts) opts = odts;
  o->last_dts = odts;
  pkt->dts = odts;
  pkt->pts = opts;
  pkt->duration = pkt->duration > 0 ? av_rescale_q(pkt->duration, tb, otb) : 0;
  pkt->stream_index = 0;
  pkt->pos = -1;
  int r = 0;
  if (kind == KIND_AUDIO && m->adts) {
    /* Strip the ADTS header; the filter keeps the packet's times. */
    r = av_bsf_send_packet(m->adts, pkt);
    if (r < 0) return r;
    AVPacket *res = av_packet_alloc();
    if (!res) return AVERROR(ENOMEM);
    while (r >= 0 && (r = av_bsf_receive_packet(m->adts, res)) >= 0) {
      res->stream_index = 0;
      int w = av_write_frame(o->oc, res);
      av_packet_unref(res);
      out_flush(m, kind);
      if (w < 0) r = w;
    }
    av_packet_free(&res);
    return (r == AVERROR(EAGAIN) || r == AVERROR_EOF) ? 0 : r;
  }
  r = av_write_frame(o->oc, pkt);
  out_flush(m, kind);
  return r;
}

/* ---- Converting a track: decode, mix, resample, encode ---- */

/* Opens the encoder, the muxer and the resampler for the sound's first decoded frame. */
static int conv_start(FM *m, AVStream *ist, const AVFrame *frame) {
  Conv *c = m->conv;
  const AVCodec *enc = avcodec_find_encoder(c->mode == MODE_FLAC ? AV_CODEC_ID_FLAC : AV_CODEC_ID_AAC);
  if (!enc) return AVERROR_ENCODER_NOT_FOUND;
  int channels = frame->ch_layout.nb_channels;
  c->enc_fmt = c->mode == MODE_FLAC ? AV_SAMPLE_FMT_S16 : AV_SAMPLE_FMT_FLTP;
  /* The layouts to try, best first: 5.1 for a surround source when asked for (the encoder says which flavour it takes), else stereo. */
  AVChannelLayout tries[3] = {AV_CHANNEL_LAYOUT_5POINT1_BACK, AV_CHANNEL_LAYOUT_5POINT1, AV_CHANNEL_LAYOUT_STEREO};
  int first = c->surround && channels >= 3 ? 0 : 2;
  int r = AVERROR(EINVAL);
  for (int i = first; i < 3 && r < 0; i++) {
    avcodec_free_context(&c->enc);
    c->enc = avcodec_alloc_context3(enc);
    if (!c->enc) return AVERROR(ENOMEM);
    c->enc->sample_fmt = c->enc_fmt;
    c->enc->sample_rate = OUT_RATE;
    c->enc->time_base = (AVRational){1, OUT_RATE};
    c->enc->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    r = av_channel_layout_copy(&c->enc->ch_layout, &tries[i]);
    if (r < 0) return r;
    if (c->mode == MODE_AAC) c->enc->bit_rate = tries[i].nb_channels > 2 ? 384000 : 160000;
    r = avcodec_open2(c->enc, enc, NULL);
    if (r >= 0) r = av_channel_layout_copy(&c->layout, &tries[i]);
  }
  if (r < 0) return r;
  c->frame_size = c->enc->frame_size > 0 ? c->enc->frame_size : 4096;
  c->fifo = av_audio_fifo_alloc(c->enc_fmt, c->layout.nb_channels, c->frame_size * 4);
  c->rs = av_frame_alloc();
  c->epkt = av_packet_alloc();
  if (!c->fifo || !c->rs || !c->epkt) return AVERROR(ENOMEM);

  AVCodecParameters *par = avcodec_parameters_alloc();
  if (!par) return AVERROR(ENOMEM);
  r = avcodec_parameters_from_context(par, c->enc);
  if (r >= 0) r = out_open(m, KIND_AUDIO, par, c->enc->time_base, (AVRational){0, 1});
  avcodec_parameters_free(&par);
  (void)ist;
  return r;
}

static int conv_swr(FM *m, const AVFrame *frame) {
  Conv *c = m->conv;
  AVChannelLayout in = {0};
  if (frame->ch_layout.order == AV_CHANNEL_ORDER_UNSPEC) av_channel_layout_default(&in, frame->ch_layout.nb_channels);
  else av_channel_layout_copy(&in, &frame->ch_layout);
  int r = swr_alloc_set_opts2(&c->swr, &c->layout, c->enc_fmt, OUT_RATE, &in, frame->format, frame->sample_rate, 0, NULL);
  av_channel_layout_uninit(&in);
  if (r < 0) return r;
  /* Never clip: the default mix lets a loud 5.1 track add up past full scale. The stream's own mix levels
     (Dolby Digital carries them in every frame) say how much centre and surround to fold in. */
  av_opt_set_double(c->swr, "rematrix_maxval", 1.0, 0);
  const AVFrameSideData *sd = av_frame_get_side_data(frame, AV_FRAME_DATA_DOWNMIX_INFO);
  if (sd && sd->size >= sizeof(AVDownmixInfo)) {
    const AVDownmixInfo *dm = (const AVDownmixInfo *)sd->data;
    if (dm->center_mix_level_ltrt > 0) av_opt_set_double(c->swr, "center_mix_level", dm->center_mix_level_ltrt, 0);
    if (dm->surround_mix_level_ltrt > 0) av_opt_set_double(c->swr, "surround_mix_level", dm->surround_mix_level_ltrt, 0);
    if (dm->lfe_mix_level > 0) av_opt_set_double(c->swr, "lfe_mix_level", dm->lfe_mix_level, 0);
  }
  r = swr_init(c->swr);
  if (r >= 0) c->swr_ready = 1;
  return r;
}

/* The resampler's output frame must say what it should hold before every conversion; it then allocates its own samples. */
static void rs_prepare(Conv *c) {
  av_frame_unref(c->rs);
  c->rs->format = c->enc_fmt;
  c->rs->sample_rate = OUT_RATE;
  av_channel_layout_copy(&c->rs->ch_layout, &c->layout);
}

/* Appends `n` samples of converted sound to the fifo, skipping the first `skip` of them. */
static int fifo_append(Conv *c, const AVFrame *f, int skip) {
  int n = f->nb_samples - skip;
  if (n <= 0) return 0;
  int planar = av_sample_fmt_is_planar(f->format);
  int bps = av_get_bytes_per_sample(f->format);
  void *planes[AV_NUM_DATA_POINTERS + 8];
  int count = planar ? f->ch_layout.nb_channels : 1;
  if (count > AV_NUM_DATA_POINTERS + 8) return AVERROR(EINVAL);
  for (int i = 0; i < count; i++) planes[i] = f->extended_data[i] + (size_t)skip * bps * (planar ? 1 : f->ch_layout.nb_channels);
  int r = av_audio_fifo_write(c->fifo, planes, n);
  return r < 0 ? r : 0;
}

static int fifo_silence(Conv *c, int64_t samples) {
  while (samples > 0) {
    int n = samples > OUT_RATE ? OUT_RATE : (int)samples;
    AVFrame *f = av_frame_alloc();
    if (!f) return AVERROR(ENOMEM);
    f->format = c->enc_fmt;
    f->sample_rate = OUT_RATE;
    f->nb_samples = n;
    av_channel_layout_copy(&f->ch_layout, &c->layout);
    int r = av_frame_get_buffer(f, 0);
    if (r >= 0) {
      av_samples_set_silence(f->extended_data, 0, n, c->layout.nb_channels, c->enc_fmt);
      r = fifo_append(c, f, 0);
    }
    av_frame_free(&f);
    if (r < 0) return r;
    samples -= n;
  }
  return 0;
}

static int conv_write_packets(FM *m, int flushing) {
  Conv *c = m->conv;
  Out *o = &m->out[KIND_AUDIO];
  for (;;) {
    int r = avcodec_receive_packet(c->enc, c->epkt);
    if (r == AVERROR(EAGAIN) || r == AVERROR_EOF) return 0;
    if (r < 0) return r;
    /* The encoder counts its own start-up delay out of the first packets' times; without an edit list the
       sound would begin a frame early, so it is added back (the browser's decoder drops it again). */
    c->epkt->pts += c->enc->initial_padding;
    c->epkt->dts = c->epkt->pts;
    av_packet_rescale_ts(c->epkt, c->enc->time_base, o->ost->time_base);
    if (c->epkt->pts < 0) {
      av_packet_unref(c->epkt);
      continue;
    }
    c->epkt->stream_index = 0;
    r = av_write_frame(o->oc, c->epkt);
    av_packet_unref(c->epkt);
    out_flush(m, KIND_AUDIO);
    if (r < 0) return r;
  }
  (void)flushing;
}

static int conv_encode(FM *m, int flush) {
  Conv *c = m->conv;
  for (;;) {
    int avail = av_audio_fifo_size(c->fifo);
    if (avail < c->frame_size && !(flush && avail > 0)) break;
    int n = avail < c->frame_size ? avail : c->frame_size;
    AVFrame *f = av_frame_alloc();
    if (!f) return AVERROR(ENOMEM);
    f->format = c->enc_fmt;
    f->sample_rate = OUT_RATE;
    f->nb_samples = n;
    av_channel_layout_copy(&f->ch_layout, &c->layout);
    int r = av_frame_get_buffer(f, 0);
    if (r >= 0) r = av_audio_fifo_read(c->fifo, (void **)f->extended_data, n) < n ? AVERROR(EIO) : 0;
    if (r >= 0) {
      f->pts = c->enc_pts;
      c->enc_pts += n;
      r = avcodec_send_frame(c->enc, f);
    }
    av_frame_free(&f);
    if (r < 0) return r;
    r = conv_write_packets(m, 0);
    if (r < 0) return r;
  }
  if (flush) {
    int r = avcodec_send_frame(c->enc, NULL);
    if (r < 0 && r != AVERROR_EOF) return r;
    return conv_write_packets(m, 1);
  }
  return 0;
}

/* One decoded frame in: set the sound's place on the timeline, mix and resample it, and feed the encoder. */
static int conv_frame(FM *m, AVStream *ist, AVFrame *frame) {
  Conv *c = m->conv;
  int r;
  /* A decoder that doesn't know the speaker order (PCM, WMA) says "unspecified": give it the usual one for that many channels. */
  if (frame->ch_layout.order == AV_CHANNEL_ORDER_UNSPEC && frame->ch_layout.nb_channels > 0) {
    int n = frame->ch_layout.nb_channels;
    av_channel_layout_uninit(&frame->ch_layout);
    av_channel_layout_default(&frame->ch_layout, n);
  }
  if (!c->enc) {
    r = conv_start(m, ist, frame);
    if (r < 0) return r;
  }
  if (!c->swr_ready) {
    r = conv_swr(m, frame);
    if (r < 0) return r;
  }
  int64_t pts = frame->pts != AV_NOPTS_VALUE ? frame->pts : frame->best_effort_timestamp;
  int64_t start = c->fifo_end;
  if (pts != AV_NOPTS_VALUE) {
    int64_t dur_us = (int64_t)frame->nb_samples * 1000000 / (frame->sample_rate > 0 ? frame->sample_rate : OUT_RATE);
    int64_t t_us = timeline_us(m, KIND_AUDIO, to_us(pts, ist->time_base), dur_us);
    start = av_rescale(t_us, OUT_RATE, 1000000);
  } else if (start == INT64_MIN) {
    start = 0;
  }
  rs_prepare(c);
  r = swr_convert_frame(c->swr, c->rs, frame);
  if (r < 0) return r;
  int skip = 0;
  if (c->fifo_end == INT64_MIN) {
    /* The very first sound: anything before the timeline's zero is dropped. */
    if (start < 0) skip = (int)-start, start = 0;
    c->fifo_end = c->enc_pts = c->first_pts = start;
  } else {
    int64_t gap = start - c->fifo_end;
    if (gap > GAP_TOLERANCE_SAMPLES && gap <= (int64_t)MAX_PAD_SAMPLES) {
      r = fifo_silence(c, gap);
      if (r < 0) return r;
      c->fifo_end += gap;
    } else if (gap < -GAP_TOLERANCE_SAMPLES) {
      skip = (int)(-gap < c->rs->nb_samples ? -gap : c->rs->nb_samples);
    }
  }
  r = fifo_append(c, c->rs, skip);
  c->fifo_end += c->rs->nb_samples - skip;
  av_frame_unref(c->rs);
  if (r < 0) return r;
  return conv_encode(m, 0);
}

static int conv_decode(FM *m, AVStream *ist, AVPacket *pkt) {
  Conv *c = m->conv;
  int r = avcodec_send_packet(c->dec, pkt);
  if (r < 0 && r != AVERROR(EAGAIN)) return r;
  for (;;) {
    r = avcodec_receive_frame(c->dec, c->in);
    if (r == AVERROR(EAGAIN) || r == AVERROR_EOF) return 0;
    if (r < 0) return r;
    r = conv_frame(m, ist, c->in);
    av_frame_unref(c->in);
    if (r < 0) return r;
  }
}

static int conv_open(FM *m, AVStream *ist) {
  const AVCodec *dec = avcodec_find_decoder(ist->codecpar->codec_id);
  if (!dec) return AVERROR_DECODER_NOT_FOUND;
  Conv *c = calloc(1, sizeof(Conv));
  if (!c) return AVERROR(ENOMEM);
  m->conv = c;
  c->mode = m->mode;
  c->surround = m->surround;
  c->fifo_end = c->enc_pts = c->first_pts = INT64_MIN;
  c->dec = avcodec_alloc_context3(dec);
  c->in = av_frame_alloc();
  if (!c->dec || !c->in) return AVERROR(ENOMEM);
  int r = avcodec_parameters_to_context(c->dec, ist->codecpar);
  if (r < 0) return r;
  c->dec->pkt_timebase = ist->time_base;
  return avcodec_open2(c->dec, dec, NULL);
}

/* The sound gave out: the picture plays on without it. */
static void audio_give_up(FM *m) {
  m->audio_failed = 1;
  conv_free(m->conv);
  m->conv = NULL;
  out_close(&m->out[KIND_AUDIO]);
}

static int audio_packet(FM *m, AVPacket *pkt) {
  AVStream *ist = m->ic->streams[m->aidx];
  if (m->audio_failed) return 0;
  m->audio_packets++;
  if (m->mode == MODE_COPY) return write_copy(m, KIND_AUDIO, ist, pkt);
  if (!m->conv) {
    int r = conv_open(m, ist);
    if (r < 0) {
      m->audio_error = r;
      audio_give_up(m);
      return 0;
    }
  }
  int r = conv_decode(m, ist, pkt);
  if (r < 0) {
    m->audio_errors++;
    m->audio_error = r;
    /* A corrupt packet or two is part of life; a decoder that never succeeds is a track that can't be played. */
    if (++m->conv->errors_in_a_row > 40 || r == AVERROR(ENOMEM) || r == AVERROR_ENCODER_NOT_FOUND) audio_give_up(m);
  } else if (m->conv) {
    m->conv->errors_in_a_row = 0;
  }
  return 0;
}

/* ---- Converting the picture: decode, reduce to 8-bit 4:2:0, hand the frame to the page ---- */

#if FM_VIDEO

static const uint8_t bayer4[16] = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};

/* A row of one source plane as 8-bit samples. Deeper samples (10-bit anime, 12-bit HEVC) are dithered with a 4x4 ordered
   pattern on the way down, so smooth gradients keep their steps from showing as bands. */
static void reduce_row(uint8_t *dst, const uint8_t *src, int n, int depth, int bytes, int be, int y) {
  if (bytes == 1 && depth == 8) {
    memcpy(dst, src, (size_t)n);
    return;
  }
  const int shift = depth - 8;
  const uint8_t *d = bayer4 + (y & 3) * 4;
  for (int x = 0; x < n; x++) {
    int v = bytes == 1 ? src[x] : be ? (src[2 * x] << 8) | src[2 * x + 1] : src[2 * x] | (src[2 * x + 1] << 8);
    v = (v + ((d[x & 3] << shift) >> 4)) >> shift;
    dst[x] = (uint8_t)(v > 255 ? 255 : v);
  }
}

/* Full-range ("JPEG") samples to the limited range every H.264 decoder assumes. */
static void make_range_tables(VConv *v) {
  for (int i = 0; i < 256; i++) {
    int y = (i * 219 + 127) / 255 + 16;
    int c = ((i - 128) * 224 + (i >= 128 ? 127 : -127)) / 255 + 128;
    v->lut_y[i] = (uint8_t)(y < 16 ? 16 : y > 235 ? 235 : y);
    v->lut_c[i] = (uint8_t)(c < 16 ? 16 : c > 240 ? 240 : c);
  }
}

static void apply_lut(uint8_t *p, int n, const uint8_t *lut) {
  for (int i = 0; i < n; i++) p[i] = lut[p[i]];
}

/* Blends the rows that show combing: a row that sits above or below both its neighbours by a clear margin is the
   signature of two fields taken at different moments, and a [1 2 1] filter across the three takes it out. Rows that
   already agree with their neighbours (everything still, and flat areas) are left exactly as they are. `line` is 2*w bytes. */
static void deint_plane(uint8_t *p, int w, int h, uint8_t *line) {
  if (h < 3) return;
  uint8_t *prev = line, *orig = line + w;
  memcpy(prev, p, (size_t)w);
  for (int y = 1; y < h - 1; y++) {
    uint8_t *cur = p + (size_t)y * w;
    const uint8_t *next = cur + w;
    memcpy(orig, cur, (size_t)w);
    for (int x = 0; x < w; x++) {
      int c = orig[x], da = prev[x] - c, db = next[x] - c;
      if (da * db > 400) cur[x] = (uint8_t)((prev[x] + 2 * c + next[x] + 2) >> 2);
    }
    uint8_t *t = prev;
    prev = orig;
    orig = t;
  }
}

/* The frame as planar 8-bit 4:2:0 of exactly out_w x out_h (even): luma, then the two chroma planes. A frame of another
   size than the first is cropped or has its last row and column repeated; a source with finer chroma has it averaged down. */
static void frame_to_i420(VConv *v, const AVFrame *f, const AVPixFmtDescriptor *d, uint8_t *dst, int deinterlace) {
  const int ow = v->out_w, oh = v->out_h, cw = ow / 2, ch = oh / 2;
  const int depth = d->comp[0].depth, bytes = d->comp[0].step > 1 ? 2 : 1, be = !!(d->flags & AV_PIX_FMT_FLAG_BE);
  uint8_t *row = v->row;
  const int n = f->width < ow ? f->width : ow;

  for (int y = 0; y < oh; y++) {
    int sy = y < f->height ? y : f->height - 1;
    uint8_t *out = dst + (size_t)y * ow;
    reduce_row(out, f->data[0] + (ptrdiff_t)sy * f->linesize[0], n, depth, bytes, be, sy);
    for (int x = n; x < ow; x++) out[x] = out[n - 1];
  }
  if (v->range_full) apply_lut(dst, ow * oh, v->lut_y);

  uint8_t *u = dst + (size_t)ow * oh, *vv = u + (size_t)cw * ch;
  if (d->nb_components < 3) {
    memset(u, 128, (size_t)cw * ch * 2);
  } else {
    const int lw = d->log2_chroma_w, lh = d->log2_chroma_h;
    const int scw = AV_CEIL_RSHIFT(f->width, lw), sch = AV_CEIL_RSHIFT(f->height, lh);
    uint8_t *a = row, *b = row + v->row_cap / 2;
    for (int plane = 1; plane <= 2; plane++) {
      uint8_t *base = plane == 1 ? u : vv;
      for (int cy = 0; cy < ch; cy++) {
        uint8_t *out = base + (size_t)cy * cw;
        int r0 = (2 * cy) >> lh, r1 = (2 * cy + 1) >> lh;
        if (r0 > sch - 1) r0 = sch - 1;
        if (r1 > sch - 1) r1 = sch - 1;
        const uint8_t *s0 = f->data[plane] + (ptrdiff_t)r0 * f->linesize[plane];
        if (lw == 1 && lh == 1 && scw >= cw && sch >= ch) {
          reduce_row(out, s0, cw, depth, bytes, be, r0);
          continue;
        }
        reduce_row(a, s0, scw, depth, bytes, be, r0);
        const uint8_t *two = a;
        if (r1 != r0) {
          reduce_row(b, f->data[plane] + (ptrdiff_t)r1 * f->linesize[plane], scw, depth, bytes, be, r1);
          two = b;
        }
        for (int cx = 0; cx < cw; cx++) {
          int c0 = (2 * cx) >> lw, c1 = (2 * cx + 1) >> lw;
          if (c0 > scw - 1) c0 = scw - 1;
          if (c1 > scw - 1) c1 = scw - 1;
          out[cx] = (uint8_t)((a[c0] + a[c1] + two[c0] + two[c1] + 2) >> 2);
        }
      }
    }
  }
  if (v->range_full) apply_lut(u, cw * ch * 2, v->lut_c);
  if (deinterlace) {
    deint_plane(dst, ow, oh, row);
    deint_plane(u, cw, ch, row);
    deint_plane(vv, cw, ch, row);
  }
}

static void vconv_tune(FM *m) {
  if (!m->vconv) return;
  AVCodecContext *c = m->vconv->dec;
  c->skip_frame = (m->tune & TUNE_SKIP_NONREF) ? AVDISCARD_NONREF : AVDISCARD_DEFAULT;
  c->skip_loop_filter = (m->tune & TUNE_SKIP_LOOP) ? AVDISCARD_ALL : AVDISCARD_DEFAULT;
}

static int vconv_open(FM *m, AVStream *ist) {
  const AVCodec *dec = avcodec_find_decoder(ist->codecpar->codec_id);
  if (!dec) return AVERROR_DECODER_NOT_FOUND;
  VConv *v = calloc(1, sizeof(VConv));
  if (!v) return AVERROR(ENOMEM);
  m->vconv = v;
  v->next_file_us = AV_NOPTS_VALUE;
  v->last_t = INT64_MIN;
  v->dec = avcodec_alloc_context3(dec);
  v->frame = av_frame_alloc();
  if (!v->dec || !v->frame) return AVERROR(ENOMEM);
  int r = avcodec_parameters_to_context(v->dec, ist->codecpar);
  if (r < 0) return r;
  v->dec->pkt_timebase = ist->time_base;
  v->dec->thread_count = 1;
  r = avcodec_open2(v->dec, dec, NULL);
  if (r < 0) return r;
  vconv_tune(m);
  return 0;
}

/* One decoded frame: its time on the timeline, then its pixels, queued for the page. */
static int vconv_emit(FM *m, AVStream *ist, AVFrame *f) {
  VConv *v = m->vconv;
  const AVPixFmtDescriptor *d = av_pix_fmt_desc_get((enum AVPixelFormat)f->format);
  if (!d || (d->flags & (AV_PIX_FMT_FLAG_RGB | AV_PIX_FMT_FLAG_PAL | AV_PIX_FMT_FLAG_BITSTREAM | AV_PIX_FMT_FLAG_HWACCEL)) ||
      (d->nb_components >= 3 && !(d->flags & AV_PIX_FMT_FLAG_PLANAR)) || d->comp[0].depth < 8 || d->comp[0].depth > 16 || f->width < 2 || f->height < 2)
    return AVERROR(EINVAL);

  int64_t pts = f->pts != AV_NOPTS_VALUE ? f->pts : f->best_effort_timestamp;
  int64_t dur_us = f->duration > 0 ? to_us(f->duration, ist->time_base) : 0;
  if (dur_us <= 0) {
    AVRational r = ist->avg_frame_rate.num > 0 ? ist->avg_frame_rate : ist->r_frame_rate;
    dur_us = r.num > 0 && r.den > 0 ? 1000000LL * r.den / r.num : v->last_dur_us > 0 ? v->last_dur_us : 40000;
  }
  int64_t file_us;
  if (pts != AV_NOPTS_VALUE) file_us = to_us(pts, ist->time_base);
  else if (v->next_file_us != AV_NOPTS_VALUE) file_us = v->next_file_us;
  else return 0;
  v->next_file_us = file_us + dur_us;
  v->last_dur_us = dur_us;

  int64_t t = timeline_us(m, KIND_VIDEO, file_us, dur_us);
  /* Frames before the time this run began at (the key frame it had to start from comes earlier than the seek) and before
     the floor (picture already buffered, after an audio switch) are decoded, since the ones after depend on them, and dropped. */
  if (t < 0 || (m->floor_us > 0 && t < m->floor_us) || t + dur_us / 2 < m->at_us || t <= v->last_t) {
    m->dropped++;
    return 0;
  }

  if (v->out_w == 0) {
    v->out_w = f->width & ~1;
    v->out_h = f->height & ~1;
    AVRational sar = f->sample_aspect_ratio;
    if (sar.num <= 0 || sar.den <= 0) sar = ist->sample_aspect_ratio;
    if (sar.num <= 0 || sar.den <= 0) sar = ist->codecpar->sample_aspect_ratio;
    v->sar_num = sar.num > 0 && sar.den > 0 ? sar.num : 1;
    v->sar_den = sar.num > 0 && sar.den > 0 ? sar.den : 1;
  }
  /* Two rows of the widest source plane (also what the deinterlacer works in), for a frame of any size. */
  size_t need = (size_t)(f->width > v->out_w ? f->width : v->out_w) * 2 + 64;
  if (need > v->row_cap) {
    uint8_t *grown = realloc(v->row, need);
    if (!grown) return AVERROR(ENOMEM);
    v->row = grown;
    v->row_cap = need;
  }
  v->range_full = f->color_range == AVCOL_RANGE_JPEG || f->format == AV_PIX_FMT_YUVJ420P || f->format == AV_PIX_FMT_YUVJ422P ||
                  f->format == AV_PIX_FMT_YUVJ444P || f->format == AV_PIX_FMT_YUVJ440P;
  if (v->range_full) make_range_tables(v);

  size_t size = (size_t)v->out_w * v->out_h * 3 / 2;
  uint8_t *pixels = malloc(size);
  if (!pixels) return AVERROR(ENOMEM);
  int interlaced = !!(f->flags & AV_FRAME_FLAG_INTERLACED);
  frame_to_i420(v, f, d, pixels, interlaced && !(m->tune & TUNE_KEEP_INTERLACED));
  if (interlaced) m->interlaced++;

  Chunk info = {.pts = t, .dur = dur_us, .w = v->out_w, .h = v->out_h, .flags = (interlaced ? 1 : 0) | (v->range_full ? 2 : 0), .sar_num = v->sar_num, .sar_den = v->sar_den, .matrix = f->colorspace};
  v->last_t = t;
  v->frames++;
  m->frames_out++;
  return queue_push_frame(m, pixels, size, &info);
}

static int vconv_receive(FM *m, AVStream *ist) {
  VConv *v = m->vconv;
  for (;;) {
    int r = avcodec_receive_frame(v->dec, v->frame);
    if (r == AVERROR(EAGAIN) || r == AVERROR_EOF) return 0;
    if (r < 0) {
      m->video_errors++;
      m->video_error = r;
      return 0;
    }
    v->errors_in_a_row = 0;
    r = vconv_emit(m, ist, v->frame);
    av_frame_unref(v->frame);
    if (r < 0) {
      m->video_error = r;
      m->video_failed = 1;
      return 0;
    }
  }
}

static int vconv_packet(FM *m, AVStream *ist, AVPacket *pkt) {
  if (m->video_failed) return 0;
  if (!m->vconv) {
    int r = vconv_open(m, ist);
    if (r < 0) {
      m->video_error = r;
      m->video_failed = 1;
      return 0;
    }
  }
  VConv *v = m->vconv;
  int r = avcodec_send_packet(v->dec, pkt);
  if (r < 0 && r != AVERROR(EAGAIN)) {
    /* A corrupt packet or two is part of life; a decoder that never succeeds is a picture that can't be played. */
    m->video_errors++;
    m->video_error = r;
    if (++v->errors_in_a_row > MAX_VIDEO_ERRORS || r == AVERROR(ENOMEM)) m->video_failed = 1;
    return 0;
  }
  return vconv_receive(m, ist);
}

#endif /* FM_VIDEO */

/* ---- Seeking ---- */

static int rewind_input(FM *m);

static int seek_to(FM *m, int64_t media_us) {
  /* The very start is the start of the file: a time seek near it can land after the first key frame. */
  if (media_us <= 1000000) return rewind_input(m);
  int idx = m->vidx >= 0 ? m->vidx : m->aidx;
  int64_t target = media_us + m->offset_us;
  int r = -1;
  if (idx >= 0) r = av_seek_frame(m->ic, idx, av_rescale_q(target, AV_TIME_BASE_Q, m->ic->streams[idx]->time_base), AVSEEK_FLAG_BACKWARD);
  if (r < 0) r = av_seek_frame(m->ic, -1, target, AVSEEK_FLAG_BACKWARD);
  if (r < 0) {
    /* A file with no index (MPEG-TS, MPEG-PS) can still be entered at about the right place: by its average bit rate. */
    int64_t size = m->ic->pb ? avio_size(m->ic->pb) : -1;
    int64_t dur = m->ic->duration;
    if (size > 0 && dur > 0 && media_us < dur) {
      double fraction = (double)media_us / (double)dur;
      int64_t pos = (int64_t)(fraction * 0.98 * (double)size);
      r = av_seek_frame(m->ic, -1, pos < 0 ? 0 : pos, AVSEEK_FLAG_BYTE);
    }
  }
  if (r < 0) m->seek_failed = 1;
  return r;
}

static int rewind_input(FM *m) {
  /* A transport or program stream has no index to seek by time, and its time seek can land after the first key frame:
     the start of the file is exactly the start. Everything else keeps its own index. */
  const char *name = m->ic->iformat ? m->ic->iformat->name : "";
  if (!strcmp(name, "mpegts") || !strcmp(name, "mpeg")) {
    if (av_seek_frame(m->ic, -1, 0, AVSEEK_FLAG_BYTE) >= 0) return 0;
  }
  int64_t ts = m->ic->start_time != AV_NOPTS_VALUE ? m->ic->start_time : 0;
  int r = av_seek_frame(m->ic, -1, ts, AVSEEK_FLAG_BACKWARD);
  if (r < 0) r = av_seek_frame(m->ic, -1, 0, AVSEEK_FLAG_BYTE);
  return r;
}

/* The key frame this run began at is later than the time asked for (an index-less file lands where it lands):
   go back by twice the overshoot, and again if need be. */
static int reseek(FM *m, int64_t key_us) {
  int64_t back = m->at_us - 2 * (key_us - m->at_us) - 1000000;
  reset_run(m);
  m->reseeks++;
  if (seek_to(m, back < 0 ? 0 : back) < 0) rewind_input(m);
  return 0;
}

/* ---- Routing packets ---- */

static int video_packet(FM *m, AVPacket *pkt) {
  AVStream *ist = m->ic->streams[m->vidx];
  if (!m->v_started) {
    if (!(pkt->flags & AV_PKT_FLAG_KEY)) return 0;
    int64_t ts = pkt->pts != AV_NOPTS_VALUE ? pkt->pts : pkt->dts;
    if (ts == AV_NOPTS_VALUE) return 0;
    int64_t t = to_us(ts, ist->time_base) - m->offset_us;
    if (m->at_us > 0 && t > m->at_us + 300000 && m->reseeks < MAX_RESEEKS) return reseek(m, t);
    m->v_started = 1;
    m->v_first_us = t;
  }
  int64_t dts = pkt->dts != AV_NOPTS_VALUE ? pkt->dts : pkt->pts;
  /* Pictures before the floor are already buffered (an audio switch): the stream joins where they end. A converted picture
     decodes them all, since what follows refers to them, and drops the frames instead. */
  if (!m->convert_video && m->floor_us > 0 && dts != AV_NOPTS_VALUE && to_us(dts, ist->time_base) - m->offset_us + m->shift[KIND_VIDEO] < m->floor_us) return 0;
  m->video_packets++;
#if FM_VIDEO
  if (m->convert_video) return vconv_packet(m, ist, pkt);
#endif
  return write_copy(m, KIND_VIDEO, ist, pkt);
}

static int route(FM *m, AVPacket *pkt) {
  if (pkt->stream_index == m->vidx) return video_packet(m, pkt);
  if (pkt->stream_index == m->aidx) return audio_packet(m, pkt);
  return 0;
}

/* The end of the file: what the decoder, resampler and encoder still hold, and the last fragment of each track. */
static int finish(FM *m) {
  m->eof = 1;
  if (m->conv && m->conv->dec && !m->audio_failed) {
    Conv *c = m->conv;
    AVStream *ist = m->ic->streams[m->aidx];
    avcodec_send_packet(c->dec, NULL);
    for (;;) {
      int r = avcodec_receive_frame(c->dec, c->in);
      if (r < 0) break;
      if (conv_frame(m, ist, c->in) < 0) break;
      av_frame_unref(c->in);
    }
    if (c->swr_ready && c->enc) {
      for (;;) {
        rs_prepare(c);
        int r = swr_convert_frame(c->swr, c->rs, NULL);
        if (r < 0 || c->rs->nb_samples == 0) break;
        fifo_append(c, c->rs, 0);
        c->fifo_end += c->rs->nb_samples;
        av_frame_unref(c->rs);
      }
      conv_encode(m, 1);
    }
  }
#if FM_VIDEO
  if (m->vconv && !m->video_failed) {
    /* The frames the decoder still holds (it reorders): the page encodes them, and then calls fm_video_end. */
    avcodec_send_packet(m->vconv->dec, NULL);
    vconv_receive(m, m->ic->streams[m->vidx]);
  }
#endif
  for (int k = 0; k < 2; k++) {
    /* A converted picture's last fragment waits for the encoder to be flushed (fm_video_end). */
    if (!m->out[k].oc || (k == KIND_VIDEO && m->convert_video)) continue;
    /* With delay_moov the first flush may only write the moov, so ask twice. */
    av_write_frame(m->out[k].oc, NULL);
    out_flush(m, k);
    av_write_frame(m->out[k].oc, NULL);
    out_flush(m, k);
  }
  return 0;
}

/* ---- Opening ---- */

static int64_t first_us(AVStream *st, AVPacket *pkt) {
  int64_t ts = pkt->pts != AV_NOPTS_VALUE ? pkt->pts : pkt->dts;
  return ts == AV_NOPTS_VALUE ? AV_NOPTS_VALUE : to_us(ts, st->time_base);
}

/* Reads the first packets to find where the file's clock starts: the earliest presentation time of the picture and the
   sound, which is the timeline's zero (so a time on the timeline is the time the file itself shows). Then the input goes back to its start. */
static void calibrate(FM *m) {
  AVFormatContext *ic = m->ic;
  int64_t first[64];
  int n = ic->nb_streams < 64 ? (int)ic->nb_streams : 64;
  for (int i = 0; i < n; i++) first[i] = AV_NOPTS_VALUE;
  int need = 0, have = 0;
  for (int i = 0; i < n; i++) {
    int t = ic->streams[i]->codecpar->codec_type;
    if (t == AVMEDIA_TYPE_VIDEO || t == AVMEDIA_TYPE_AUDIO) need++;
  }
  for (int count = 0; count < CALIBRATE_PACKETS && have < need; count++) {
    if (av_read_frame(ic, m->pkt) < 0) break;
    int i = m->pkt->stream_index;
    if (i < n && first[i] == AV_NOPTS_VALUE) {
      int t = ic->streams[i]->codecpar->codec_type;
      if (t == AVMEDIA_TYPE_VIDEO || t == AVMEDIA_TYPE_AUDIO) {
        first[i] = first_us(ic->streams[i], m->pkt);
        if (first[i] != AV_NOPTS_VALUE) have++;
      }
    }
    av_packet_unref(m->pkt);
  }
  int64_t lowest = AV_NOPTS_VALUE;
  for (int i = 0; i < n; i++) if (first[i] != AV_NOPTS_VALUE && (lowest == AV_NOPTS_VALUE || first[i] < lowest)) lowest = first[i];
  if (lowest == AV_NOPTS_VALUE) lowest = ic->start_time != AV_NOPTS_VALUE ? ic->start_time : 0;
  m->offset_us = lowest;
  rewind_input(m);
  m->consumed = 0;
}

int fm_open(void) {
  if (M) return AVERROR(EBUSY);
  FM *m = calloc(1, sizeof(FM));
  if (!m) return AVERROR(ENOMEM);
  M = m;
  m->vidx = m->aidx = -1;
  m->pkt = av_packet_alloc();
  m->ic = avformat_alloc_context();
  uint8_t *buf = av_malloc(IO_BUFFER);
  if (!m->pkt || !m->ic || !buf) return AVERROR(ENOMEM);
  m->io = avio_alloc_context(buf, IO_BUFFER, 0, m, io_read, NULL, io_seek);
  if (!m->io) return AVERROR(ENOMEM);
  m->ic->pb = m->io;
  m->ic->flags |= AVFMT_FLAG_CUSTOM_IO;
  AVDictionary *opts = NULL;
  /* A transport stream is probed as far as the first few megabytes, which the host has already fetched. */
  av_dict_set(&opts, "probesize", "8000000", 0);
  av_dict_set(&opts, "analyzeduration", "6000000", 0);
  int r = avformat_open_input(&m->ic, "", NULL, &opts);
  av_dict_free(&opts);
  if (r < 0) return r;
  r = avformat_find_stream_info(m->ic, NULL);
  if (r < 0) return r;
  calibrate(m);
  reset_run(m);
  return 0;
}

const char *fm_strerror(int code) {
  if (!M) return "";
  if (av_strerror(code, M->err, sizeof(M->err)) < 0) M->err[0] = 0;
  return M->err;
}

/* ---- What the file is ---- */

int fm_streams(void) { return M && M->ic ? (int)M->ic->nb_streams : 0; }
double fm_duration_ms(void) { return M && M->ic && M->ic->duration != AV_NOPTS_VALUE ? (double)M->ic->duration / 1000.0 : 0; }
double fm_offset_ms(void) { return M ? (double)M->offset_us / 1000.0 : 0; }

enum { S_TYPE = 1, S_CODEC_ID, S_PROFILE, S_LEVEL, S_WIDTH, S_HEIGHT, S_CHANNELS, S_RATE, S_BITRATE, S_EXTRADATA, S_DEFAULT, S_FORCED, S_COMMENT, S_HEARING,
       S_FPS, S_DEPTH, S_TRANSFER, S_DELAY, S_SAR_NUM, S_SAR_DEN, S_DECODABLE, S_PRIMARIES, S_ATTACHED_PIC, S_BITS_PER_SAMPLE, S_ENCODABLE };

double fm_stream_info(int i, int key) {
  if (!M || !M->ic || i < 0 || i >= (int)M->ic->nb_streams) return -1;
  AVStream *st = M->ic->streams[i];
  AVCodecParameters *p = st->codecpar;
  switch (key) {
    case S_TYPE: return p->codec_type == AVMEDIA_TYPE_VIDEO ? 0 : p->codec_type == AVMEDIA_TYPE_AUDIO ? 1 : p->codec_type == AVMEDIA_TYPE_SUBTITLE ? 2 : 3;
    case S_CODEC_ID: return p->codec_id;
    case S_PROFILE: return p->profile;
    case S_LEVEL: return p->level;
    case S_WIDTH: return p->width;
    case S_HEIGHT: return p->height;
    case S_CHANNELS: return p->ch_layout.nb_channels;
    case S_RATE: return p->sample_rate;
    case S_BITRATE: return (double)p->bit_rate;
    case S_EXTRADATA: return p->extradata_size;
    case S_DEFAULT: return !!(st->disposition & AV_DISPOSITION_DEFAULT);
    case S_FORCED: return !!(st->disposition & AV_DISPOSITION_FORCED);
    case S_COMMENT: return !!(st->disposition & AV_DISPOSITION_COMMENT);
    case S_HEARING: return !!(st->disposition & AV_DISPOSITION_HEARING_IMPAIRED);
    case S_ATTACHED_PIC: return !!(st->disposition & AV_DISPOSITION_ATTACHED_PIC);
    case S_FPS: {
      AVRational f = st->avg_frame_rate.num ? st->avg_frame_rate : st->r_frame_rate;
      return f.den > 0 ? (double)f.num * 1000.0 / (double)f.den : 0;
    }
    case S_DEPTH: {
      if (p->codec_type != AVMEDIA_TYPE_VIDEO) return 0;
      const AVPixFmtDescriptor *d = av_pix_fmt_desc_get((enum AVPixelFormat)p->format);
      return d ? d->comp[0].depth : (p->bits_per_raw_sample ? p->bits_per_raw_sample : 8);
    }
    case S_TRANSFER: return p->color_trc;
    case S_PRIMARIES: return p->color_primaries;
    case S_DELAY: return p->video_delay;
    case S_SAR_NUM: return st->sample_aspect_ratio.num ? st->sample_aspect_ratio.num : p->sample_aspect_ratio.num;
    case S_SAR_DEN: return st->sample_aspect_ratio.den ? st->sample_aspect_ratio.den : p->sample_aspect_ratio.den;
    case S_DECODABLE: return avcodec_find_decoder(p->codec_id) != NULL;
    case S_BITS_PER_SAMPLE: return p->bits_per_coded_sample;
  }
  return -1;
}

/* A string about stream `i`: 1 codec name, 2 language, 3 title, 4 pixel format, 5 profile name. */
const char *fm_stream_str(int i, int key) {
  if (!M || !M->ic || i < 0 || i >= (int)M->ic->nb_streams) return "";
  AVStream *st = M->ic->streams[i];
  const char *s = "";
  AVDictionaryEntry *e;
  switch (key) {
    case 1: s = avcodec_get_name(st->codecpar->codec_id); break;
    case 2: e = av_dict_get(st->metadata, "language", NULL, 0); s = e ? e->value : ""; break;
    case 3:
      e = av_dict_get(st->metadata, "title", NULL, 0);
      if (!e) e = av_dict_get(st->metadata, "handler_name", NULL, 0);
      s = e ? e->value : "";
      break;
    case 4: {
      const char *n = st->codecpar->codec_type == AVMEDIA_TYPE_VIDEO ? av_get_pix_fmt_name((enum AVPixelFormat)st->codecpar->format) : NULL;
      s = n ? n : "";
      break;
    }
    case 5: s = avcodec_profile_name(st->codecpar->codec_id, st->codecpar->profile); if (!s) s = ""; break;
  }
  strncpy(M->str, s, sizeof(M->str) - 1);
  M->str[sizeof(M->str) - 1] = 0;
  return M->str;
}

const uint8_t *fm_stream_extradata(int i) {
  if (!M || !M->ic || i < 0 || i >= (int)M->ic->nb_streams) return NULL;
  return M->ic->streams[i]->codecpar->extradata;
}

int fm_can_decode(int i) { return fm_stream_info(i, S_DECODABLE) > 0; }
int fm_container_bitrate(void) { return M && M->ic ? (int)M->ic->bit_rate : 0; }

int fm_chapters(void) { return M && M->ic ? (int)M->ic->nb_chapters : 0; }
double fm_chapter(int i, int key) {
  if (!M || !M->ic || i < 0 || i >= (int)M->ic->nb_chapters) return -1;
  AVChapter *c = M->ic->chapters[i];
  int64_t v = key == 1 ? c->start : c->end;
  return (double)to_us(v, c->time_base) / 1000.0 - (double)M->offset_us / 1000.0;
}
const char *fm_chapter_title(int i) {
  if (!M || !M->ic || i < 0 || i >= (int)M->ic->nb_chapters) return "";
  AVDictionaryEntry *e = av_dict_get(M->ic->chapters[i]->metadata, "title", NULL, 0);
  strncpy(M->str, e ? e->value : "", sizeof(M->str) - 1);
  M->str[sizeof(M->str) - 1] = 0;
  return M->str;
}

/* ---- Running ---- */

int fm_start(int video, int audio, int mode, double at_ms, double floor_ms, int flags) {
  FM *m = M;
  if (!m || !m->ic) return AVERROR(EINVAL);
  reset_run(m);
  m->vidx = video;
  m->aidx = audio;
  m->mode = mode;
  m->surround = flags & FLAG_SURROUND;
  m->convert_video = (flags & FLAG_CONVERT_VIDEO) && video >= 0;
#if !FM_VIDEO
  /* This build has no picture decoders: the page asks for the other module. */
  if (m->convert_video) return AVERROR(ENOSYS);
#endif
  m->at_us = at_ms > 0 ? (int64_t)(at_ms * 1000.0) : 0;
  m->floor_us = floor_ms > 0 ? (int64_t)(floor_ms * 1000.0) : 0;
  m->reseeks = 0;
  m->seek_failed = 0;
  /* Tracks that aren't played are never read out of the container's packets. */
  for (unsigned i = 0; i < m->ic->nb_streams; i++) m->ic->streams[i]->discard = (int)i == video || (int)i == audio ? AVDISCARD_DEFAULT : AVDISCARD_ALL;
  if (m->at_us > 50000) {
    /* A transport or program stream is entered by time, not at a key frame: aim a few seconds early, so the first key frame
       is usually at or before the time asked for. (The run goes back further if it isn't.) */
    const char *name = m->ic->iformat ? m->ic->iformat->name : "";
    int64_t lead = (!strcmp(name, "mpegts") || !strcmp(name, "mpeg")) && video >= 0 ? 3000000 : 0;
    int64_t aim = m->at_us > lead ? m->at_us - lead : 0;
    if (seek_to(m, aim) < 0) rewind_input(m);
  } else if (m->consumed) {
    rewind_input(m);
  }
  m->consumed = 0;
  return 0;
}

int fm_step(int max_bytes) {
  FM *m = M;
  if (!m || !m->ic) return AVERROR(EINVAL);
  if (m->eof) return 1;
  int64_t from = avio_tell(m->ic->pb);
  int bad = 0;
  m->frames_out = 0;
  for (;;) {
    int r = av_read_frame(m->ic, m->pkt);
    if (r == AVERROR_EOF && m->vidx >= 0 && !m->v_started && m->at_us > 0 && m->reseeks < MAX_RESEEKS) {
      /* The file ended before a key frame came: this run landed after the last one. */
      int64_t back = m->at_us - 5000000LL * (m->reseeks + 1);
      reset_run(m);
      m->reseeks++;
      if (seek_to(m, back < 0 ? 0 : back) < 0) rewind_input(m);
      continue;
    }
    if (r == AVERROR_EOF) return finish(m);
    if (r < 0) {
      if (r == AVERROR(EAGAIN)) continue;
      /* A damaged stretch is skipped, up to a point. */
      if ((r == AVERROR_INVALIDDATA) && ++bad < 500) continue;
      /* A read that failed at the very end (a server that closed early) is the end of the file. */
      if (m->consumed) return finish(m) < 0 ? r : 1;
      return r;
    }
    m->consumed = 1;
    r = route(m, m->pkt);
    av_packet_unref(m->pkt);
    if (r < 0) return r;
    if (avio_tell(m->ic->pb) - from >= max_bytes || m->frames_out >= FRAME_BATCH || m->video_failed) return 0;
  }
}

int fm_out_next(void) {
  FM *m = M;
  if (!m) return 0;
  free(m->cur.ptr);
  m->cur = (Chunk){0};
  if (m->q_head >= m->q_len) return 0;
  m->cur = m->queue[m->q_head++];
  return (int)m->cur.len;
}
const uint8_t *fm_out_ptr(void) { return M ? M->cur.ptr : NULL; }
int fm_out_kind(void) { return M ? M->cur.kind : 0; }

/* What the current piece of output is, when it is a frame (see the notes at the top). */
double fm_out_info(int key) {
  if (!M) return 0;
  const Chunk *c = &M->cur;
  switch (key) {
    case 1: return (double)c->pts;
    case 2: return (double)c->dur;
    case 3: return c->w;
    case 4: return c->h;
    case 5: return c->flags;
    case 6: return c->sar_num;
    case 7: return c->sar_den;
    case 8: return c->matrix;
  }
  return 0;
}

double fm_info(int key) {
  FM *m = M;
  if (!m) return 0;
  switch (key) {
    case INFO_AUDIO_FAILED: return m->audio_failed;
    case INFO_AUDIO_ERRORS: return (double)m->audio_errors;
    case INFO_SEEK_FAILED: return m->seek_failed;
    case INFO_BYTES: return m->ic && m->ic->pb ? (double)avio_tell(m->ic->pb) : 0;
    case INFO_VIDEO_PACKETS: return (double)m->video_packets;
    case INFO_AUDIO_PACKETS: return (double)m->audio_packets;
    case INFO_DISCONTINUITIES: return (double)m->jumps;
    case INFO_START_MS: return m->v_first_us == AV_NOPTS_VALUE ? -1 : (double)m->v_first_us / 1000.0;
    case INFO_OUT_CHANNELS: return m->conv ? m->conv->layout.nb_channels : 0;
    case INFO_BITRATE: return m->ic ? (double)m->ic->bit_rate : 0;
    case INFO_AUDIO_ERROR: return m->audio_error;
    case INFO_AUDIO_START_MS: return m->conv && m->conv->first_pts != INT64_MIN ? (double)m->conv->first_pts * 1000.0 / OUT_RATE : -1;
    case INFO_VIDEO_FRAMES: return m->vconv ? (double)m->vconv->frames : 0;
    case INFO_VIDEO_FAILED: return m->video_failed;
    case INFO_VIDEO_ERRORS: return (double)m->video_errors;
    case INFO_INTERLACED: return (double)m->interlaced;
    case INFO_VIDEO_ERROR: return m->video_error;
    case INFO_VIDEO_DROPPED: return (double)m->dropped;
  }
  return 0;
}

void fm_close(void) {
  FM *m = M;
  if (!m) return;
  reset_run(m);
  free(m->queue);
  free(m->scratch);
  av_packet_free(&m->pkt);
  if (m->ic) {
    if (m->io) {
      av_freep(&m->io->buffer);
      avio_context_free(&m->io);
    }
    m->ic->pb = NULL;
    avformat_close_input(&m->ic);
  }
  free(m);
  M = NULL;
}

/* ---- The converted picture's way back: the page's encoded packets into the muxer ---- */

uint8_t *fm_scratch(int size) {
  FM *m = M;
  if (!m || size < 0) return NULL;
  uint8_t *p = grow(m->scratch, &m->scratch_cap, (size_t)size + AV_INPUT_BUFFER_PADDING_SIZE);
  if (!p) return NULL;
  m->scratch = p;
  return p;
}

#if FM_VIDEO

int fm_video_open(int width, int height, int sar_num, int sar_den, int extradata_len) {
  FM *m = M;
  if (!m || !m->convert_video || extradata_len <= 0 || (size_t)extradata_len > m->scratch_cap) return AVERROR(EINVAL);
  if (m->out[KIND_VIDEO].oc) return 0;
  AVCodecParameters *par = avcodec_parameters_alloc();
  if (!par) return AVERROR(ENOMEM);
  par->codec_type = AVMEDIA_TYPE_VIDEO;
  par->codec_id = AV_CODEC_ID_H264;
  par->format = AV_PIX_FMT_YUV420P;
  par->width = width;
  par->height = height;
  par->extradata = av_mallocz((size_t)extradata_len + AV_INPUT_BUFFER_PADDING_SIZE);
  if (!par->extradata) {
    avcodec_parameters_free(&par);
    return AVERROR(ENOMEM);
  }
  memcpy(par->extradata, m->scratch, (size_t)extradata_len);
  par->extradata_size = extradata_len;
  /* Microseconds, the clock the frames came on: nothing is rounded between the page's times and the file's. */
  int r = out_open(m, KIND_VIDEO, par, (AVRational){1, 1000000}, (AVRational){sar_num, sar_den});
  avcodec_parameters_free(&par);
  return r;
}

int fm_video_packet(int length, double pts_us, double dur_us, int key) {
  FM *m = M;
  Out *o = m ? &m->out[KIND_VIDEO] : NULL;
  if (!o || !o->oc || length <= 0 || (size_t)length > m->scratch_cap) return AVERROR(EINVAL);
  AVPacket *pkt = av_packet_alloc();
  if (!pkt) return AVERROR(ENOMEM);
  int r = av_new_packet(pkt, length);
  if (r >= 0) {
    memcpy(pkt->data, m->scratch, (size_t)length);
    /* The encoder makes no B-frames in real-time mode: the time a picture is shown is the time it is decoded. */
    int64_t dts = (int64_t)pts_us;
    if (o->last_dts != INT64_MIN && dts <= o->last_dts) dts = o->last_dts + 1;
    o->last_dts = dts;
    pkt->dts = pkt->pts = dts;
    pkt->duration = (int64_t)dur_us;
    pkt->flags = key ? AV_PKT_FLAG_KEY : 0;
    pkt->stream_index = 0;
    pkt->pos = -1;
    r = av_write_frame(o->oc, pkt);
    out_flush(m, KIND_VIDEO);
  }
  av_packet_free(&pkt);
  return r;
}

int fm_video_end(void) {
  FM *m = M;
  if (!m) return AVERROR(EINVAL);
  Out *o = &m->out[KIND_VIDEO];
  if (!o->oc) return 0;
  /* With delay_moov the first flush may only write the moov, so ask twice. */
  av_write_frame(o->oc, NULL);
  out_flush(m, KIND_VIDEO);
  av_write_frame(o->oc, NULL);
  out_flush(m, KIND_VIDEO);
  return 0;
}

void fm_video_tune(int bits) {
  FM *m = M;
  if (!m) return;
  m->tune = bits;
  vconv_tune(m);
}

#else

int fm_video_open(int width, int height, int sar_num, int sar_den, int extradata_len) {
  (void)width; (void)height; (void)sar_num; (void)sar_den; (void)extradata_len;
  return AVERROR(ENOSYS);
}
int fm_video_packet(int length, double pts_us, double dur_us, int key) {
  (void)length; (void)pts_us; (void)dur_us; (void)key;
  return AVERROR(ENOSYS);
}
int fm_video_end(void) { return AVERROR(ENOSYS); }
void fm_video_tune(int bits) { (void)bits; }

#endif /* FM_VIDEO */

/* ---- Parts of FFmpeg replaced at link time ----

   libavutil pulls in some code a decoder never needs, and each piece brings libc calls that become
   imports of the module (reading files, formatting to stderr, the environment). Defining these
   functions here means the linker never takes FFmpeg's own versions, so none of that comes along.
   They keep FFmpeg's signatures, so a mismatch is a compile error. */

/* Only "random" colour names ask for this; the real one reads the clock, /dev/urandom and files. */
uint32_t av_get_random_seed(void) { return 0x9e3779b9u; }

/* The transform code builds every kind of FFT in three number formats, and the decoders here only
   ever ask for float. Empty lists for the other two keep about 150 KB of code and tables out. */
const void *const ff_tx_codelet_list_double_c[] = {NULL};
const void *const ff_tx_codelet_list_int32_c[] = {NULL};

/* Only av_parse_time("now") reads the clock, and nothing here parses times. */
int64_t av_gettime(void) { return 0; }
int64_t av_gettime_relative(void) { return 0; }
int av_gettime_relative_is_monotonic(void) { return 0; }
int av_usleep(unsigned usec) { (void)usec; return 0; }

/* The linker asks for this when the module has no start-up code; the real one would pull in libc's
   exit path, with its stdio flushing and three more host calls, for nothing. */
void __wasm_call_dtors(void) {}

/* libc's stdin, stdout and stderr objects point at these three, which call the host (fd_write,
   fd_seek, fd_close). Nothing here opens or writes a stream: the only stdio left is sscanf and
   snprintf on strings, but the objects are linked in anyway. Defining them as no-ops leaves the module
   with no imports at all. (They are wasi-libc internals, so a different sysroot may need a look.) */
size_t __stdio_write(void *f, const unsigned char *buf, size_t len) { (void)f; (void)buf; (void)len; return 0; }
int64_t __stdio_seek(void *f, int64_t off, int whence) { (void)f; (void)off; (void)whence; return -1; }
int __stdio_close(void *f) { (void)f; return 0; }

/* Logging. Nothing may reach stdio, so every message is dropped before it is formatted. */
void av_log(void *avcl, int level, const char *fmt, ...) { (void)avcl; (void)level; (void)fmt; }
void av_vlog(void *avcl, int level, const char *fmt, va_list vl) { (void)avcl; (void)level; (void)fmt; (void)vl; }
void av_log_once(void *avcl, int initial, int subsequent, int *state, const char *fmt, ...) {
  (void)avcl; (void)initial; (void)subsequent; (void)state; (void)fmt;
}
int av_log_get_level(void) { return AV_LOG_QUIET; }
void av_log_set_level(int level) { (void)level; }
void av_log_set_flags(int arg) { (void)arg; }
int av_log_get_flags(void) { return 0; }
void av_log_set_callback(void (*callback)(void *, int, const char *, va_list)) { (void)callback; }
void av_log_default_callback(void *avcl, int level, const char *fmt, va_list vl) {
  (void)avcl; (void)level; (void)fmt; (void)vl;
}
void av_log_format_line(void *ptr, int level, const char *fmt, va_list vl, char *line, int line_size, int *print_prefix) {
  (void)ptr; (void)level; (void)fmt; (void)vl; (void)print_prefix;
  if (line_size > 0) line[0] = 0;
}
int av_log_format_line2(void *ptr, int level, const char *fmt, va_list vl, char *line, int line_size, int *print_prefix) {
  av_log_format_line(ptr, level, fmt, vl, line, line_size, print_prefix);
  return 0;
}
const char *av_default_item_name(void *ctx) { (void)ctx; return "flow-media"; }
AVClassCategory av_default_get_category(void *ptr) { (void)ptr; return AV_CLASS_CATEGORY_NA; }
void avpriv_report_missing_feature(void *avc, const char *fmt, ...) { (void)avc; (void)fmt; }
void avpriv_request_sample(void *avc, const char *fmt, ...) { (void)avc; (void)fmt; }
