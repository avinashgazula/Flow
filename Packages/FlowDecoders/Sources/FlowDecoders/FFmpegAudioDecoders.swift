import Foundation
import FlowKit
import CFFmpegDecoders

/// DTS (including DTS-HD Master Audio) and Dolby TrueHD decoding with FFmpeg's libavcodec, for
/// the MKV remuxer, which re-encodes the output as lossless FLAC for Apple's player.
public struct FFmpegAudioDecoders: AudioDecoderProvider {
    public init() {}

    public func makeDecoder(codecID: String, codecPrivate: [UInt8], sampleRate: Int, channels: Int) -> AudioDecoding? {
        let id: AVCodecID
        switch codecID {
        case "A_DTS": id = AV_CODEC_ID_DTS
        case "A_TRUEHD": id = AV_CODEC_ID_TRUEHD
        case "A_MLP": id = AV_CODEC_ID_MLP
        default: return nil
        }
        return FFmpegAudioDecoder(codec: id, channels: channels, extradata: codecPrivate)
    }
}

final class FFmpegAudioDecoder: AudioDecoding {
    private let codec: UnsafePointer<AVCodec>
    private var context: UnsafeMutablePointer<AVCodecContext>?
    private var packet: UnsafeMutablePointer<AVPacket>?
    private var frame: UnsafeMutablePointer<AVFrame>?
    /// Channels the remuxer expects per sample frame (from the track header).
    private let channels: Int
    private let extradata: [UInt8]

    init?(codec id: AVCodecID, channels: Int, extradata: [UInt8]) {
        guard let codec = avcodec_find_decoder(id) else { return nil }
        self.codec = codec
        self.channels = channels
        self.extradata = extradata
        packet = av_packet_alloc()
        frame = av_frame_alloc()
        guard packet != nil, frame != nil, open() else { return nil }
    }

    deinit {
        avcodec_free_context(&context)
        av_packet_free(&packet)
        av_frame_free(&frame)
    }

    private func open() -> Bool {
        guard let ctx = avcodec_alloc_context3(codec) else { return false }
        if !extradata.isEmpty, let buffer = av_mallocz(extradata.count + Int(AV_INPUT_BUFFER_PADDING_SIZE)) {
            let bytes = buffer.assumingMemoryBound(to: UInt8.self)
            extradata.withUnsafeBufferPointer { bytes.update(from: $0.baseAddress!, count: extradata.count) }
            ctx.pointee.extradata = bytes
            ctx.pointee.extradata_size = Int32(extradata.count)
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

    /// Converts a decoded frame to interleaved 24-bit samples in WAVE order, exactly `channels` wide.
    /// FFmpeg's native channel order (by AV_CH_* bit) is the WAVE order FLAC expects.
    private func append(_ frame: UnsafeMutablePointer<AVFrame>, to out: inout [Int32]) {
        let count = Int(frame.pointee.nb_samples)
        let decodedChannels = Int(frame.pointee.ch_layout.nb_channels)
        guard count > 0, decodedChannels > 0, let planes = frame.pointee.extended_data else { return }
        let format = AVSampleFormat(rawValue: frame.pointee.format)
        let planar = av_sample_fmt_is_planar(format) != 0
        let start = out.count
        out.append(contentsOf: repeatElement(0, count: count * channels))
        let used = min(channels, decodedChannels)

        func sample(_ c: Int, _ i: Int) -> Int32 {
            let plane = planar ? planes[c]! : planes[0]!
            let index = planar ? i : i * decodedChannels + c
            switch format {
            case AV_SAMPLE_FMT_S16, AV_SAMPLE_FMT_S16P:
                return Int32(plane.withMemoryRebound(to: Int16.self, capacity: index + 1) { $0[index] }) << 8
            case AV_SAMPLE_FMT_S32, AV_SAMPLE_FMT_S32P:
                return plane.withMemoryRebound(to: Int32.self, capacity: index + 1) { $0[index] } >> 8
            case AV_SAMPLE_FMT_FLT, AV_SAMPLE_FMT_FLTP:
                let v = plane.withMemoryRebound(to: Float.self, capacity: index + 1) { $0[index] }
                return Int32(max(-8_388_608, min(8_388_607, (Double(v) * 8_388_607).rounded())))
            case AV_SAMPLE_FMT_DBL, AV_SAMPLE_FMT_DBLP:
                let v = plane.withMemoryRebound(to: Double.self, capacity: index + 1) { $0[index] }
                return Int32(max(-8_388_608, min(8_388_607, (v * 8_388_607).rounded())))
            case AV_SAMPLE_FMT_U8, AV_SAMPLE_FMT_U8P:
                return (Int32(plane[index]) - 128) << 16
            default:
                return 0
            }
        }

        out.withUnsafeMutableBufferPointer { buffer in
            for i in 0..<count {
                for c in 0..<used { buffer[start + i * channels + c] = sample(c, i) }
            }
        }
    }
}
