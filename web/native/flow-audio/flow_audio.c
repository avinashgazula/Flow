/* Flow's in-browser audio converter: FFmpeg's AC-3, E-AC-3, DTS and Dolby TrueHD decoders behind a
   small C ABI, built to one WebAssembly module (web/scripts/build-audio-decoders.sh).

   Browsers can't decode these four formats, so the player decodes them here and plays the result
   through Web Audio. The output is always stereo, interleaved float32, at the rate the caller asks
   for, because that is all a browser's output needs and it keeps the JS side trivial.

   Calling convention (the TypeScript wrapper in src/lib/audio/decoder.ts is the only caller):

     h = fa_open(codec, 48000)         codec: 1 AC-3, 2 E-AC-3, 3 DTS, 4 TrueHD; 0 when it fails
     p = fa_input(h, n)                a buffer of at least n bytes; JS writes compressed bytes there
     frames = fa_decode(h, n)          decodes those n bytes; < 0 is a hard error (-1 bad handle or
                                       size, -2 out of memory), anything else is the number of stereo
                                       sample pairs this call produced
     out = fa_output(h)                the float32 pairs, valid until the next fa_decode or fa_close
     fa_flush(h)                       after a seek
     frames = fa_finish(h)             at the end of the stream: what the parser, decoder and resampler
                                       were still holding; the stream is then as after fa_flush
     fa_info(h, key)                   1 source channels, 2 source sample rate, 3 source sample frames
                                       decoded so far, 4 errors so far
     fa_close(h)

   Input is any slice of the elementary stream: a Matroska block can hold several frames or only part
   of one, so the bytes go through FFmpeg's own stream parser, which finds the frame boundaries and
   keeps a partial frame for the next call. Frames that fail to decode are skipped and counted.

   Nothing here touches stdio: FFmpeg's logging is replaced by functions that drop every message. */

#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <libavutil/frame.h>
#include <libavutil/log.h>
#include <libavutil/opt.h>
#include <libavutil/samplefmt.h>

enum { CODEC_AC3 = 1, CODEC_EAC3 = 2, CODEC_DTS = 3, CODEC_TRUEHD = 4 };
enum { INFO_CHANNELS = 1, INFO_RATE = 2, INFO_FRAMES = 3, INFO_ERRORS = 4 };

/* Resampler shape. Eight zero crossings on each side of a Blackman-Harris windowed sinc keeps
   aliasing below about -90 dB, which is far under what anyone hears, and 512 phases with linear
   interpolation between them is exact enough that a steady tone stays clean across a long file. */
#define RS_ZERO_CROSSINGS 8
#define RS_PHASES 512
#define RS_CUTOFF 0.94
#define RS_MAX_TAPS 160

typedef struct {
  int active;
  double step;  /* input samples per output sample */
  int hw;       /* taps on each side of the centre */
  float *table; /* (RS_PHASES + 1) rows of 2 * hw taps */
  float *buf;   /* stereo pairs: history, then input not yet used up */
  int len, cap;
  double pos;   /* where the next output sample falls in buf, in input samples */
} Resampler;

typedef struct {
  int codec;
  int out_rate;
  AVCodecContext *dec;
  AVCodecContext *pctx; /* the parser writes stream facts here, so the decoder's own context stays untouched */
  AVCodecParserContext *parser;
  AVPacket *pkt;
  AVFrame *frame;
  uint8_t *in;
  size_t in_cap;
  float *out;
  size_t out_cap; /* in stereo pairs */
  size_t out_len;
  float *stage; /* one frame's worth of stereo before resampling */
  size_t stage_cap;
  float *chan;  /* one channel converted to float */
  size_t chan_cap;
  float *rsout; /* the resampler's output for one frame */
  size_t rsout_cap;
  Resampler rs;
  int rs_rate; /* the input rate the resampler is built for */
  int keep_layout; /* see fa_open */
  int src_channels;
  int src_rate;
  int64_t frames;
  int errors;
} FA;

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
const char *av_default_item_name(void *ctx) { (void)ctx; return "flow-audio"; }
AVClassCategory av_default_get_category(void *ptr) { (void)ptr; return AV_CLASS_CATEGORY_NA; }
void avpriv_report_missing_feature(void *avc, const char *fmt, ...) { (void)avc; (void)fmt; }
void avpriv_request_sample(void *avc, const char *fmt, ...) { (void)avc; (void)fmt; }

static void *grow(void *p, size_t *cap, size_t need, size_t elem) {
  if (need <= *cap) return p;
  size_t n = *cap ? *cap : 4096;
  while (n < need) n *= 2;
  void *q = realloc(p, n * elem);
  if (!q) return NULL;
  *cap = n;
  return q;
}

/* ---- Source facts the decoders don't report once they've been asked for stereo ---- */

typedef struct { const uint8_t *p; size_t n, pos; } Bits;
static uint32_t bits_read(Bits *b, int count) {
  uint32_t v = 0;
  while (count--) {
    size_t byte = b->pos >> 3;
    v = (v << 1) | (byte < b->n ? (b->p[byte] >> (7 - (b->pos & 7))) & 1 : 0);
    b->pos++;
  }
  return v;
}

static const uint8_t ACMOD_CHANNELS[8] = {2, 1, 2, 3, 3, 4, 4, 5};
static const uint8_t DCA_AMODE_CHANNELS[16] = {1, 2, 2, 2, 2, 3, 3, 4, 4, 5, 6, 6, 6, 7, 8, 8};

/* The channel count a frame's own header declares, or 0 when it can't be read. For E-AC-3 that is
   the independent stream (a 7.1 mix reports 5.1) and for DTS the core (the lossless extension may
   carry more); both are only used for display, since the decoders do the real work. */
static int peek_channels(int codec, const uint8_t *p, size_t n) {
  Bits b = {p, n, 0};
  if (n < 12) return 0;
  if ((codec == CODEC_AC3 || codec == CODEC_EAC3) && p[0] == 0x0b && p[1] == 0x77) {
    bits_read(&b, 16);
    if ((p[5] >> 3) > 10) { /* bsid: E-AC-3 */
      bits_read(&b, 2 + 3 + 11 + 2 + 2);
      int acmod = bits_read(&b, 3), lfe = bits_read(&b, 1);
      return ACMOD_CHANNELS[acmod] + lfe;
    }
    bits_read(&b, 16 + 2 + 6 + 5 + 3);
    int acmod = bits_read(&b, 3);
    if ((acmod & 1) && acmod != 1) bits_read(&b, 2);
    if (acmod & 4) bits_read(&b, 2);
    if (acmod == 2) bits_read(&b, 2);
    return ACMOD_CHANNELS[acmod] + bits_read(&b, 1);
  }
  if (codec == CODEC_DTS && p[0] == 0x7f && p[1] == 0xfe && p[2] == 0x80 && p[3] == 0x01) {
    bits_read(&b, 32 + 1 + 5 + 1 + 7 + 14);
    int amode = bits_read(&b, 6);
    bits_read(&b, 4 + 5 + 1 + 1 + 1 + 1 + 1 + 3 + 1 + 1);
    int lff = bits_read(&b, 2);
    return amode < 16 ? DCA_AMODE_CHANNELS[amode] + (lff ? 1 : 0) : 0;
  }
  return 0;
}

/* ---- Sample conversion and downmix ---- */

static void load_channel(const AVFrame *f, int ch, float *dst) {
  int n = f->nb_samples, fmt = f->format;
  int planar = av_sample_fmt_is_planar(fmt);
  enum AVSampleFormat packed = av_get_packed_sample_fmt(fmt);
  int nch = f->ch_layout.nb_channels;
  int size = av_get_bytes_per_sample(fmt);
  const uint8_t *base = planar ? f->extended_data[ch] : f->extended_data[0] + (size_t)ch * size;
  size_t stride = planar ? (size_t)size : (size_t)size * nch;
  for (int i = 0; i < n; i++) {
    const uint8_t *s = base + stride * i;
    float v;
    switch (packed) {
      case AV_SAMPLE_FMT_FLT: v = *(const float *)s; break;
      case AV_SAMPLE_FMT_DBL: v = (float)*(const double *)s; break;
      case AV_SAMPLE_FMT_S16: v = *(const int16_t *)s * (1.0f / 32768.0f); break;
      case AV_SAMPLE_FMT_S32: v = *(const int32_t *)s * (1.0f / 2147483648.0f); break;
      case AV_SAMPLE_FMT_U8: v = (*s - 128) * (1.0f / 128.0f); break;
      default: v = 0; break;
    }
    dst[i] = v;
  }
}

/* How much of one channel goes to the left and right ears: ITU-style, with the centre and the
   surrounds 3 dB down and the LFE dropped (a stereo pair has nowhere sensible to put it). */
static void channel_gain(int id, float *l, float *r) {
  const float s = 0.70710678f;
  *l = *r = 0;
  switch (id) {
    case AV_CHAN_FRONT_LEFT: case AV_CHAN_STEREO_LEFT: *l = 1; break;
    case AV_CHAN_FRONT_RIGHT: case AV_CHAN_STEREO_RIGHT: *r = 1; break;
    case AV_CHAN_FRONT_CENTER: *l = *r = s; break;
    case AV_CHAN_FRONT_LEFT_OF_CENTER: case AV_CHAN_WIDE_LEFT: case AV_CHAN_TOP_FRONT_LEFT: *l = s; break;
    case AV_CHAN_FRONT_RIGHT_OF_CENTER: case AV_CHAN_WIDE_RIGHT: case AV_CHAN_TOP_FRONT_RIGHT: *r = s; break;
    case AV_CHAN_BACK_LEFT: case AV_CHAN_SIDE_LEFT: case AV_CHAN_SURROUND_DIRECT_LEFT:
    case AV_CHAN_TOP_BACK_LEFT: case AV_CHAN_TOP_SIDE_LEFT: *l = s; break;
    case AV_CHAN_BACK_RIGHT: case AV_CHAN_SIDE_RIGHT: case AV_CHAN_SURROUND_DIRECT_RIGHT:
    case AV_CHAN_TOP_BACK_RIGHT: case AV_CHAN_TOP_SIDE_RIGHT: *r = s; break;
    case AV_CHAN_BACK_CENTER: case AV_CHAN_TOP_CENTER: case AV_CHAN_TOP_FRONT_CENTER:
    case AV_CHAN_TOP_BACK_CENTER: *l = *r = s * s; break;
    default: break; /* LFE and anything unknown */
  }
}

/* Turns a decoded frame into stereo pairs in fa->stage; returns the pair count or -1 when out of memory. */
static int to_stereo(FA *fa, const AVFrame *f) {
  int n = f->nb_samples, nch = f->ch_layout.nb_channels;
  float *st = grow(fa->stage, &fa->stage_cap, (size_t)n * 2, sizeof(float));
  if (!st) return -1;
  fa->stage = st;
  float *ch = grow(fa->chan, &fa->chan_cap, (size_t)n, sizeof(float));
  if (!ch) return -1;
  fa->chan = ch;
  if (nch <= 0 || nch > 32) return 0;

  if (nch == 2) {
    /* Usual case: the decoder already downmixed. */
    load_channel(f, 0, ch);
    for (int i = 0; i < n; i++) st[2 * i] = ch[i];
    load_channel(f, 1, ch);
    for (int i = 0; i < n; i++) st[2 * i + 1] = ch[i];
    return n;
  }
  if (nch == 1) {
    load_channel(f, 0, ch);
    for (int i = 0; i < n; i++) st[2 * i] = st[2 * i + 1] = ch[i];
    return n;
  }

  /* More than two channels still arrived (a decoder that couldn't or wouldn't downmix): mix here.
     Dividing by the loudest sum of gains means even all channels at full scale can't clip. */
  AVChannelLayout layout = {0};
  if (f->ch_layout.order == AV_CHANNEL_ORDER_UNSPEC) av_channel_layout_default(&layout, nch);
  else av_channel_layout_copy(&layout, &f->ch_layout);
  float gl[32], gr[32], sum_l = 0, sum_r = 0;
  for (int c = 0; c < nch; c++) {
    channel_gain((int)av_channel_layout_channel_from_index(&layout, c), &gl[c], &gr[c]);
    sum_l += gl[c];
    sum_r += gr[c];
  }
  av_channel_layout_uninit(&layout);
  float norm = 1.0f / fmaxf(1.0f, fmaxf(sum_l, sum_r));
  memset(st, 0, (size_t)n * 2 * sizeof(float));
  for (int c = 0; c < nch; c++) {
    if (gl[c] == 0 && gr[c] == 0) continue;
    load_channel(f, c, ch);
    float a = gl[c] * norm, b = gr[c] * norm;
    for (int i = 0; i < n; i++) {
      st[2 * i] += ch[i] * a;
      st[2 * i + 1] += ch[i] * b;
    }
  }
  return n;
}

/* ---- Resampler ---- */

static double window(double x) {
  /* Blackman-Harris over x in [-1, 1]. */
  const double pi = 3.14159265358979323846;
  double t = (x + 1.0) * 0.5;
  return 0.35875 - 0.48829 * cos(2 * pi * t) + 0.14128 * cos(4 * pi * t) - 0.01168 * cos(6 * pi * t);
}

static void rs_free(Resampler *r) {
  free(r->table);
  free(r->buf);
  memset(r, 0, sizeof *r);
}

/* Restarts the stream: a zero history so the first output sees silence before the signal. */
static void rs_reset(Resampler *r) {
  r->len = r->hw;
  if (r->buf) memset(r->buf, 0, (size_t)r->hw * 2 * sizeof(float));
  r->pos = r->hw;
}

static int rs_setup(Resampler *r, int in_rate, int out_rate) {
  rs_free(r);
  if (in_rate == out_rate || in_rate <= 0) return 0;
  const double pi = 3.14159265358979323846;
  double c = RS_CUTOFF * fmin(1.0, (double)out_rate / in_rate); /* cutoff as a fraction of the input's Nyquist */
  int hw = (int)ceil(RS_ZERO_CROSSINGS / c);
  if (hw * 2 > RS_MAX_TAPS) hw = RS_MAX_TAPS / 2;
  int taps = hw * 2;
  r->table = malloc((size_t)(RS_PHASES + 1) * taps * sizeof(float));
  if (!r->table) return -1;
  for (int p = 0; p <= RS_PHASES; p++) {
    double frac = (double)p / RS_PHASES, sum = 0;
    float *row = r->table + (size_t)p * taps;
    for (int j = 0; j < taps; j++) {
      double x = frac + hw - 1 - j; /* distance from the output point to this input sample */
      double px = pi * c * x;
      double v = (fabs(x) < 1e-9 ? c : c * sin(px) / px) * window(x / hw);
      row[j] = (float)v;
      sum += v;
    }
    for (int j = 0; j < taps; j++) row[j] = (float)(row[j] / sum); /* unity gain at DC in every phase */
  }
  r->hw = hw;
  r->step = (double)in_rate / out_rate;
  r->cap = 4096;
  r->buf = malloc((size_t)r->cap * 2 * sizeof(float));
  if (!r->buf) { rs_free(r); return -1; }
  r->active = 1;
  rs_reset(r);
  return 0;
}

/* Appends n input pairs and writes every output pair that now has all its taps (and falls before
   `limit`, a position in the buffer; at the end of a stream that is where the real signal stops, so the
   zero padding that completes the last taps doesn't add a tail). Returns the count. */
static int rs_run(Resampler *r, const float *in, int n, float *out, int max_out, double limit) {
  size_t cap = (size_t)r->cap;
  float *b = grow(r->buf, &cap, (size_t)r->len + n, 2 * sizeof(float));
  if (!b) return -1;
  r->buf = b;
  r->cap = (int)cap;
  memcpy(r->buf + (size_t)r->len * 2, in, (size_t)n * 2 * sizeof(float));
  r->len += n;

  int taps = r->hw * 2, produced = 0;
  while (produced < max_out) {
    int ipos = (int)r->pos;
    if (ipos + r->hw >= r->len || r->pos >= limit) break;
    double frac = r->pos - ipos;
    double fp = frac * RS_PHASES;
    int p = (int)fp;
    float w = (float)(fp - p);
    const float *a = r->table + (size_t)p * taps, *c = a + taps;
    const float *src = r->buf + (size_t)(ipos - r->hw + 1) * 2;
    float l = 0, rr = 0;
    for (int j = 0; j < taps; j++) {
      float k = a[j] + (c[j] - a[j]) * w;
      l += src[2 * j] * k;
      rr += src[2 * j + 1] * k;
    }
    out[2 * produced] = l;
    out[2 * produced + 1] = rr;
    produced++;
    r->pos += r->step;
  }
  int base = (int)r->pos - r->hw + 1; /* what the next output still needs starts here */
  if (base > 0) {
    memmove(r->buf, r->buf + (size_t)base * 2, (size_t)(r->len - base) * 2 * sizeof(float));
    r->len -= base;
    r->pos -= base;
  }
  return produced;
}

/* ---- Decoding ---- */

static int emit(FA *fa, const float *pairs, int n) {
  float *o = grow(fa->out, &fa->out_cap, fa->out_len + n, 2 * sizeof(float));
  if (!o) return -1;
  fa->out = o;
  float *d = fa->out + fa->out_len * 2;
  for (int i = 0; i < n * 2; i++) {
    float v = pairs[i];
    d[i] = v > 1.0f ? 1.0f : (v < -1.0f ? -1.0f : v); /* a resampler's overshoot must not wrap a 16-bit output */
  }
  fa->out_len += n;
  return 0;
}

static int handle_frame(FA *fa, const AVFrame *f) {
  if (f->sample_rate != fa->src_rate || fa->rs_rate != f->sample_rate) {
    fa->src_rate = f->sample_rate;
    fa->rs_rate = f->sample_rate;
    if (rs_setup(&fa->rs, f->sample_rate, fa->out_rate) < 0) return -1;
  }
  if (f->ch_layout.nb_channels > fa->src_channels) fa->src_channels = f->ch_layout.nb_channels;
  fa->frames += f->nb_samples;

  int n = to_stereo(fa, f);
  if (n < 0) return -1;
  if (n == 0) return 0;
  if (!fa->rs.active) return emit(fa, fa->stage, n);

  int max_out = (int)((double)(n + 2) / fa->rs.step) + 4;
  float *tmp = grow(fa->rsout, &fa->rsout_cap, (size_t)max_out * 2, sizeof(float));
  if (!tmp) return -1;
  fa->rsout = tmp;
  int m = rs_run(&fa->rs, fa->stage, n, tmp, max_out, 1e300);
  return m < 0 ? -1 : (m > 0 ? emit(fa, tmp, m) : 0);
}

/* The resampler holds back the last few input samples until it has the neighbours it needs. At the end
   of a stream, pad with silence to get them out, but stop where the real signal stops. */
static int rs_finish(FA *fa) {
  Resampler *r = &fa->rs;
  if (!r->active) return 0;
  double end = r->len;
  int pad = r->hw;
  float *zeros = calloc((size_t)pad * 2, sizeof(float));
  int max_out = (int)((end - r->pos) / r->step) + 4;
  float *tmp = grow(fa->rsout, &fa->rsout_cap, (size_t)(max_out > 0 ? max_out : 4) * 2, sizeof(float));
  int ret = -1;
  if (zeros && tmp) {
    fa->rsout = tmp;
    int m = rs_run(r, zeros, pad, tmp, max_out, end);
    ret = m < 0 ? -1 : (m > 0 ? emit(fa, tmp, m) : 0);
  }
  free(zeros);
  return ret;
}

static int drain(FA *fa) {
  for (;;) {
    int r = avcodec_receive_frame(fa->dec, fa->frame);
    if (r == AVERROR(EAGAIN) || r == AVERROR_EOF) return 0;
    if (r < 0) { fa->errors++; return 0; }
    int h = handle_frame(fa, fa->frame);
    av_frame_unref(fa->frame);
    if (h < 0) return -2;
  }
}

static int open_parser(FA *fa) {
  enum AVCodecID id = fa->codec == CODEC_AC3 ? AV_CODEC_ID_AC3 : fa->codec == CODEC_EAC3 ? AV_CODEC_ID_EAC3
                    : fa->codec == CODEC_DTS ? AV_CODEC_ID_DTS : AV_CODEC_ID_TRUEHD;
  if (fa->parser) av_parser_close(fa->parser);
  fa->pctx->codec_id = id; /* the AC-3 parser rewrites this to E-AC-3 when it sees one */
  fa->parser = av_parser_init(id);
  return fa->parser ? 0 : -1;
}

static void destroy(FA *fa) {
  if (!fa) return;
  if (fa->parser) av_parser_close(fa->parser);
  avcodec_free_context(&fa->pctx);
  avcodec_free_context(&fa->dec);
  av_packet_free(&fa->pkt);
  av_frame_free(&fa->frame);
  rs_free(&fa->rs);
  free(fa->in);
  free(fa->out);
  free(fa->stage);
  free(fa->chan);
  free(fa->rsout);
  free(fa);
}

static int open_decoder(FA *fa) {
  const char *name = fa->codec == CODEC_AC3 ? "ac3" : fa->codec == CODEC_EAC3 ? "eac3"
                   : fa->codec == CODEC_DTS ? "dca" : "truehd";
  const AVCodec *c = avcodec_find_decoder_by_name(name);
  if (!c) return -1;
  avcodec_free_context(&fa->dec);
  fa->dec = avcodec_alloc_context3(c);
  if (!fa->dec) return -1;
  if (!fa->keep_layout) {
    /* Ask the decoder for stereo: it uses the stream's own downmix coefficients, and for TrueHD it
       then decodes only the two-channel substream, which is several times cheaper than 7.1. */
    AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
    av_opt_set_chlayout(fa->dec->priv_data, "downmix", &stereo, 0);
  }
  /* DTS-HD Master Audio carries a lossy core plus a lossless extension. Stereo doesn't need the
     extension, and skipping it saves most of the decoding work. */
  if (fa->codec == CODEC_DTS) av_opt_set_int(fa->dec->priv_data, "core_only", 1, 0);
  return avcodec_open2(fa->dec, c, NULL) < 0 ? -1 : 0;
}

int fa_open(int codec, int out_rate) {
  /* Bit 8 of codec keeps the decoder's own channel layout, so the wrapper's downmix does the mixing. Only the
     tests use it: every decoder can downmix by itself, so without this nothing would exercise the wrapper's mix. */
  int keep_layout = (codec & 0x100) != 0;
  codec &= 0xff;
  if (codec < CODEC_AC3 || codec > CODEC_TRUEHD || out_rate < 8000 || out_rate > 384000) return 0;
  FA *fa = calloc(1, sizeof *fa);
  if (!fa) return 0;
  fa->codec = codec;
  fa->keep_layout = keep_layout;
  fa->out_rate = out_rate;
  fa->pctx = avcodec_alloc_context3(NULL);
  fa->pkt = av_packet_alloc();
  fa->frame = av_frame_alloc();
  if (!fa->pctx || !fa->pkt || !fa->frame || open_parser(fa) < 0 || open_decoder(fa) < 0) { destroy(fa); return 0; }
  return (int)(intptr_t)fa;
}

uint8_t *fa_input(int handle, int size) {
  FA *fa = (FA *)(intptr_t)handle;
  if (!fa || size < 0) return NULL;
  uint8_t *p = grow(fa->in, &fa->in_cap, (size_t)size + AV_INPUT_BUFFER_PADDING_SIZE, 1);
  if (!p) return NULL;
  fa->in = p;
  return p;
}

/* Decodes one packet's worth of bytes from the parser; returns 0, or -2 when out of memory. */
static int run_packet(FA *fa, uint8_t *data, int dsize) {
  if (!fa->dec) return -2; /* a failed re-open after a seek left no decoder */
  if (!fa->src_channels) {
    int ch = peek_channels(fa->codec, data, (size_t)dsize);
    if (ch == 0 && fa->codec == CODEC_TRUEHD) ch = fa->pctx->ch_layout.nb_channels;
    if (ch > 0) fa->src_channels = ch;
  }
  fa->pkt->data = data;
  fa->pkt->size = dsize;
  int r = avcodec_send_packet(fa->dec, fa->pkt);
  if (r < 0 && r != AVERROR(EAGAIN)) { fa->errors++; return 0; }
  return drain(fa);
}

int fa_decode(int handle, int size) {
  FA *fa = (FA *)(intptr_t)handle;
  if (!fa || size < 0 || (size_t)size + AV_INPUT_BUFFER_PADDING_SIZE > fa->in_cap) return -1;
  fa->out_len = 0;
  if (size == 0) return 0;
  memset(fa->in + size, 0, AV_INPUT_BUFFER_PADDING_SIZE);

  int pos = 0, stalled = 0;
  while (pos < size) {
    uint8_t *data = NULL;
    int dsize = 0;
    int used = av_parser_parse2(fa->parser, fa->pctx, &data, &dsize, fa->in + pos, size - pos,
                                AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
    if (used < 0) { fa->errors++; break; }
    pos += used;
    if (dsize <= 0) {
      /* The TrueHD parser can find a frame start without using a byte (it only changes state), so a
         call that took nothing isn't an error. Two in a row is: stop before looping forever. */
      if (used == 0 && ++stalled > 2) break;
      if (used > 0) stalled = 0;
      continue;
    }
    stalled = 0;
    int r = run_packet(fa, data, dsize);
    if (r < 0) return r;
  }
  return (int)fa->out_len;
}

float *fa_output(int handle) {
  FA *fa = (FA *)(intptr_t)handle;
  return fa ? fa->out : NULL;
}

/* Back to the state of a freshly opened stream, keeping the counters and the output. */
static void reset_stream(FA *fa) {
  /* A parser has no reset, and a fresh one is the only way to forget half a frame from before the seek. */
  open_parser(fa);
  if (fa->codec == CODEC_AC3 || fa->codec == CODEC_EAC3) {
    /* FFmpeg's Dolby Digital decoders have no flush: avcodec_flush_buffers leaves the half-block they overlap
       into the next one, so the first sound after a seek would carry a ghost of the old position. A fresh
       decoder is cheap (its tables are built once per process) and has no such state. */
    if (open_decoder(fa) < 0) fa->errors++;
  } else {
    avcodec_flush_buffers(fa->dec);
  }
  if (fa->rs.active) rs_reset(&fa->rs);
}

void fa_flush(int handle) {
  FA *fa = (FA *)(intptr_t)handle;
  if (!fa) return;
  reset_stream(fa);
  fa->out_len = 0;
}

/* The end of the stream: the parser only knows a frame is complete when the next one starts, and the
   decoders and resampler keep a little back, so this hands over what is still waiting. The stream is
   left as after fa_flush, ready for a new position. Returns like fa_decode. */
int fa_finish(int handle) {
  FA *fa = (FA *)(intptr_t)handle;
  if (!fa) return -1;
  fa->out_len = 0;
  uint8_t *data = NULL;
  int dsize = 0;
  av_parser_parse2(fa->parser, fa->pctx, &data, &dsize, NULL, 0, AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
  int r = dsize > 0 ? run_packet(fa, data, dsize) : 0;
  if (r == 0 && avcodec_send_packet(fa->dec, NULL) >= 0) r = drain(fa);
  if (r == 0) r = rs_finish(fa);
  reset_stream(fa);
  return r < 0 ? r : (int)fa->out_len;
}

int fa_info(int handle, int key) {
  FA *fa = (FA *)(intptr_t)handle;
  if (!fa) return 0;
  switch (key) {
    case INFO_CHANNELS: return fa->src_channels;
    case INFO_RATE: return fa->src_rate;
    case INFO_FRAMES: return fa->frames > INT32_MAX ? INT32_MAX : (int)fa->frames;
    case INFO_ERRORS: return fa->errors;
    default: return 0;
  }
}

void fa_close(int handle) { destroy((FA *)(intptr_t)handle); }
