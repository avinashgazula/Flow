import Foundation
import FlowKit
import CFFmpegDecoders

/// The audio Apple's player can't play, decoded with FFmpeg's libavcodec: DTS (including DTS-HD Master Audio),
/// Dolby TrueHD, Opus, Vorbis, MPEG audio layers 1 and 2, ALAC, WavPack, TTA, Windows Media Audio, ADPCM and
/// the like. The MKV remuxer re-encodes what comes out as lossless FLAC, which AVPlayer plays. What each
/// Matroska codec needs (headers, wave formats, timing) is worked out in FlowKit's `AudioDecoderSetup`.
public struct FFmpegAudioDecoders: AudioDecoderProvider {
    public init() {
        // Decoding restarts mid-stream after every seek; FFmpeg's complaints until the next sync point are expected.
        av_log_set_level(AV_LOG_QUIET)
    }

    public func makeDecoder(codecID: String, codecPrivate: [UInt8], sampleRate: Int, channels: Int) -> AudioDecoding? {
        guard let setup = AudioDecoderSetup.resolve(codecID: codecID, codecPrivate: codecPrivate, sampleRate: sampleRate, channels: channels),
              setup.pcm == nil, let id = Self.ffmpegID(setup.codec) else { return nil }
        return FFmpegAudioDecoder(codec: id, setup: setup)
    }

    private static func ffmpegID(_ codec: AudioDecoderSetup.Codec) -> AVCodecID? {
        switch codec {
        case .dts: return AV_CODEC_ID_DTS
        case .truehd: return AV_CODEC_ID_TRUEHD
        case .mlp: return AV_CODEC_ID_MLP
        case .opus: return AV_CODEC_ID_OPUS
        case .vorbis: return AV_CODEC_ID_VORBIS
        case .mp1: return AV_CODEC_ID_MP1
        case .mp2: return AV_CODEC_ID_MP2
        case .mp3: return AV_CODEC_ID_MP3
        case .alac: return AV_CODEC_ID_ALAC
        case .wavPack: return AV_CODEC_ID_WAVPACK
        case .tta: return AV_CODEC_ID_TTA
        case .wmaV1: return AV_CODEC_ID_WMAV1
        case .wmaV2: return AV_CODEC_ID_WMAV2
        case .wmaPro: return AV_CODEC_ID_WMAPRO
        case .wmaLossless: return AV_CODEC_ID_WMALOSSLESS
        case .adpcmMS: return AV_CODEC_ID_ADPCM_MS
        case .adpcmIMAWAV: return AV_CODEC_ID_ADPCM_IMA_WAV
        case .alaw: return AV_CODEC_ID_PCM_ALAW
        case .mulaw: return AV_CODEC_ID_PCM_MULAW
        case .ac3: return AV_CODEC_ID_AC3
        case .eac3: return AV_CODEC_ID_EAC3
        case .pcm: return nil
        }
    }
}

final class FFmpegAudioDecoder: AudioDecoding {
    private let codec: UnsafePointer<AVCodec>
    private var context: UnsafeMutablePointer<AVCodecContext>?
    private var packet: UnsafeMutablePointer<AVPacket>?
    private var frame: UnsafeMutablePointer<AVFrame>?
    private let setup: AudioDecoderSetup
    /// Channels the remuxer expects per sample frame (from the track header).
    private var channels: Int { setup.channels }

    init?(codec id: AVCodecID, setup: AudioDecoderSetup) {
        guard let codec = avcodec_find_decoder(id) else { return nil }
        self.codec = codec
        self.setup = setup
        packet = av_packet_alloc()
        frame = av_frame_alloc()
        guard packet != nil, frame != nil, open() else { return nil }
    }

    deinit {
        avcodec_free_context(&context)
        av_packet_free(&packet)
        av_frame_free(&frame)
    }

    /// Codecs whose streams don't say how many channels, how fast or how big a block is: the wave format does.
    private var needsExplicitFormat: Bool {
        switch setup.codec {
        case .wmaV1, .wmaV2, .wmaPro, .wmaLossless, .adpcmMS, .adpcmIMAWAV, .alaw, .mulaw: return true
        default: return false
        }
    }

    private func open() -> Bool {
        guard let ctx = avcodec_alloc_context3(codec) else { return false }
        let extradata = setup.extradata
        if !extradata.isEmpty, let buffer = av_mallocz(extradata.count + Int(AV_INPUT_BUFFER_PADDING_SIZE)) {
            let bytes = buffer.assumingMemoryBound(to: UInt8.self)
            extradata.withUnsafeBufferPointer { bytes.update(from: $0.baseAddress!, count: extradata.count) }
            ctx.pointee.extradata = bytes
            ctx.pointee.extradata_size = Int32(extradata.count)
        }
        if needsExplicitFormat {
            ctx.pointee.sample_rate = Int32(setup.sampleRate)
            av_channel_layout_default(&ctx.pointee.ch_layout, Int32(setup.channels))
            ctx.pointee.block_align = Int32(setup.blockAlign)
            ctx.pointee.bits_per_coded_sample = Int32(setup.bitsPerCodedSample)
            ctx.pointee.bit_rate = Int64(setup.bitRate)
        }
        guard avcodec_open2(ctx, codec, nil) == 0 else {
            var optional: UnsafeMutablePointer<AVCodecContext>? = ctx
            avcodec_free_context(&optional)
            return false
        }
        context = ctx
        return true
    }

    func reset() {
        if let context { avcodec_flush_buffers(context) }
    }

    func decode(_ data: [UInt8]) -> [Int32] {
        guard let context, let packet, let frame, !data.isEmpty, av_new_packet(packet, Int32(data.count)) == 0 else { return [] }
        defer { av_packet_unref(packet) }
        data.withUnsafeBufferPointer { packet.pointee.data.update(from: $0.baseAddress!, count: data.count) }
        guard avcodec_send_packet(context, packet) == 0 else { return [] }
        var out: [Int32] = []
        while avcodec_receive_frame(context, frame) == 0 {
            append(frame, to: &out)
            av_frame_unref(frame)
        }
        return out
    }

    /// Which decoded channel goes in each WAVE slot (L R C LFE BL BR SL SR). Decoders that know their layout
    /// (Opus, Vorbis and the rest of FFmpeg's) already deliver channels in the order of their IDs, which is
    /// WAVE order; a custom order is sorted by ID; a layout left unspecified is taken to be Vorbis's own
    /// order for the codecs that use it.
    private func waveOrder(of frame: UnsafeMutablePointer<AVFrame>, decodedChannels: Int) -> [Int] {
        var layout = frame.pointee.ch_layout
        if layout.order == AV_CHANNEL_ORDER_CUSTOM {
            let ids = (0..<decodedChannels).map { Int(av_channel_layout_channel_from_index(&layout, UInt32($0)).rawValue) }
            return AudioChannelOrder.waveOrder(forChannelIDs: ids)
        }
        if layout.order != AV_CHANNEL_ORDER_NATIVE, setup.codec == .vorbis || setup.codec == .opus, decodedChannels > 2 {
            return AudioChannelOrder.waveFromVorbis(channels: decodedChannels)
        }
        return Array(0..<decodedChannels)
    }

    /// Converts a decoded frame to interleaved 24-bit samples in WAVE order, exactly `channels` wide.
    @_optimize(speed) private func append(_ frame: UnsafeMutablePointer<AVFrame>, to out: inout [Int32]) {
        let count = Int(frame.pointee.nb_samples)
        let decodedChannels = Int(frame.pointee.ch_layout.nb_channels)
        guard count > 0, decodedChannels > 0, let planes = frame.pointee.extended_data else { return }
        let format = AVSampleFormat(rawValue: frame.pointee.format)
        let planar = av_sample_fmt_is_planar(format) != 0
        let channels = self.channels
        let start = out.count
        out.append(contentsOf: repeatElement(0, count: count * channels))
        let order = waveOrder(of: frame, decodedChannels: decodedChannels)

        out.withUnsafeMutableBufferPointer { buffer in
            for c in 0..<min(channels, decodedChannels) {
                let source = order[c]
                guard let plane = planar ? planes[source] : planes[0] else { continue }
                // Planar audio has one plane per channel; interleaved audio steps over the other channels' samples.
                let stride = planar ? 1 : decodedChannels
                let offset = planar ? 0 : source
                func each(_ body: (Int) -> Int32) {
                    for i in 0..<count { buffer[start + i * channels + c] = body(i * stride + offset) }
                }
                switch format {
                case AV_SAMPLE_FMT_S16, AV_SAMPLE_FMT_S16P:
                    plane.withMemoryRebound(to: Int16.self, capacity: count * stride + offset) { p in each { Int32(p[$0]) << 8 } }
                case AV_SAMPLE_FMT_S32, AV_SAMPLE_FMT_S32P:
                    plane.withMemoryRebound(to: Int32.self, capacity: count * stride + offset) { p in each { p[$0] >> 8 } }
                case AV_SAMPLE_FMT_FLT, AV_SAMPLE_FMT_FLTP:
                    plane.withMemoryRebound(to: Float.self, capacity: count * stride + offset) { p in
                        each { Int32(max(-8_388_608, min(8_388_607, (Double(p[$0]) * 8_388_607).rounded()))) }
                    }
                case AV_SAMPLE_FMT_DBL, AV_SAMPLE_FMT_DBLP:
                    plane.withMemoryRebound(to: Double.self, capacity: count * stride + offset) { p in
                        each { Int32(max(-8_388_608, min(8_388_607, (p[$0] * 8_388_607).rounded()))) }
                    }
                case AV_SAMPLE_FMT_U8, AV_SAMPLE_FMT_U8P:
                    each { (Int32(plane[$0]) - 128) << 16 }
                default:
                    break
                }
            }
        }
    }
}
