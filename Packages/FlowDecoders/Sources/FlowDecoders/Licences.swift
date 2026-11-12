import Foundation

/// What Flow must show about the FFmpeg it ships (LGPL 2.1).
public enum FFmpegLicence {
    public static let notice = """
    Marquee uses FFmpeg 7.1.1 (https://ffmpeg.org) to decode audio that Apple's player can't play: DTS, \
    Dolby TrueHD, Opus, Vorbis, MPEG audio layers 1 and 2, ALAC, WavPack, TTA, Windows Media Audio, ADPCM, \
    A-law, mu-law and, inside odd files, AC-3 and E-AC-3. It is licensed under the GNU Lesser General Public \
    License, version 2.1, and was built from the unmodified release with only those audio decoders (libavcodec, \
    libavutil and libswresample). Marquee's source, including the script that builds FFmpeg \
    (scripts/build-ffmpeg-decoders.sh), is public, so it can be rebuilt against a modified FFmpeg.
    """

    /// The full LGPL 2.1 text.
    public static var text: String {
        Bundle.module.url(forResource: "COPYING.LGPLv2", withExtension: "1")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
    }
}
