import Foundation

/// Decodes audio Apple's player can't play (DTS, Dolby TrueHD, Opus, Vorbis and more). The app supplies
/// one backed by FFmpeg; the remuxer re-encodes what it returns as lossless FLAC, which AVPlayer plays.
public protocol AudioDecoding: AnyObject {
    /// Decodes one Matroska frame. Returns interleaved samples in WAVE channel order
    /// (L R C LFE BL BR SL SR), exactly `channels` per sample frame, as signed 24-bit values.
    /// Empty when the frame produced no output yet (e.g. TrueHD before its first major sync). Opus's lead-in
    /// and seek warm-up are not the decoder's concern: the remuxer discards them (see `AudioDecoderSetup`).
    func decode(_ frame: [UInt8]) -> [Int32]
    /// Forgets all state, before decoding from a new position.
    func reset()
}

public protocol AudioDecoderProvider: Sendable {
    /// A decoder for a Matroska audio codec ID from `AudioDecoderSetup.codecIDs` ("A_DTS", "A_OPUS", "A_VORBIS",
    /// "A_MS/ACM"…), or nil when unsupported. Uncompressed PCM never comes here: FlowKit decodes it itself.
    func makeDecoder(codecID: String, codecPrivate: [UInt8], sampleRate: Int, channels: Int) -> AudioDecoding?
}

extension MatroskaRemuxer {
    /// Set by the app at launch. Without it, tracks Apple's player can't play (DTS, TrueHD, Opus, Vorbis, PCM…) are skipped.
    nonisolated(unsafe) public static var audioDecoders: AudioDecoderProvider?

    /// Codecs the remuxer decodes and re-encodes when `audioDecoders` is set.
    static let decodedCodecIDs = AudioDecoderSetup.codecIDs

    /// A decoder for `track`: FlowKit's own for PCM, the app's for everything else. nil while decoding is
    /// turned off, so the setting that stops DTS and TrueHD decoding stops this too.
    static func makeDecoder(for track: MatroskaTrack, setup: AudioDecoderSetup) -> AudioDecoding? {
        guard let provider = audioDecoders else { return nil }
        if let pcm = setup.pcm { return PCMDecoder(format: pcm) }
        return provider.makeDecoder(codecID: track.codecID, codecPrivate: track.codecPrivate, sampleRate: setup.sampleRate, channels: setup.channels)
    }
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
    /// Decoded samples per channel still to discard from the start (Opus's lead-in).
    var skip = 0
    /// The last block fed to the decoder. A segment's bytes can run on into the next segment's first cluster
    /// (when a keyframe sits mid-cluster), so the next one starts with blocks this one already decoded.
    var lastBlockTime: Int64?

    init(decoder: AudioDecoding, sampleRate: Int, channels: Int) {
        self.decoder = decoder
        self.channels = channels
        self.encoder = FLACEncoder(sampleRate: sampleRate, channels: channels, bitsPerSample: 24)
    }
}
