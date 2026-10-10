import Foundation

/// Decodes audio Apple's player can't (DTS, Dolby TrueHD). The app supplies one backed by FFmpeg;
/// the remuxer re-encodes what it returns as lossless FLAC, which AVPlayer plays.
public protocol AudioDecoding: AnyObject {
    /// Decodes one Matroska frame. Returns interleaved samples in WAVE channel order
    /// (L R C LFE BL BR SL SR), exactly `channels` per sample frame, as signed 24-bit values.
    /// Empty when the frame produced no output yet (e.g. TrueHD before its first major sync).
    func decode(_ frame: [UInt8]) -> [Int32]
    /// Forgets all state, before decoding from a new position.
    func reset()
}

public protocol AudioDecoderProvider: Sendable {
    /// A decoder for a Matroska audio codec ID ("A_DTS", "A_TRUEHD", "A_MLP"), or nil when unsupported.
    func makeDecoder(codecID: String, codecPrivate: [UInt8], sampleRate: Int, channels: Int) -> AudioDecoding?
}

extension MatroskaRemuxer {
    /// Set by the app at launch. Without it, DTS and TrueHD tracks are skipped as unplayable.
    nonisolated(unsafe) public static var audioDecoders: AudioDecoderProvider?

    /// Codecs the remuxer decodes and re-encodes when `audioDecoders` is set.
    static let decodedCodecIDs: Set<String> = ["A_DTS", "A_TRUEHD", "A_MLP"]
}

/// One decoded track's running state, so consecutive segments join without gaps.
final class AudioTranscoder {
    let decoder: AudioDecoding
    var encoder: FLACEncoder
    let channels: Int
    var pending: [Int32] = []
    var lastSegment: Int?
    /// The next output sample's time in the track's timescale, once known.
    var nextSample: Int64?

    init(decoder: AudioDecoding, sampleRate: Int, channels: Int) {
        self.decoder = decoder
        self.channels = channels
        self.encoder = FLACEncoder(sampleRate: sampleRate, channels: channels, bitsPerSample: 24)
    }
}
