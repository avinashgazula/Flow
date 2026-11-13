import Foundation

/// What Flow must show about the FFmpeg it ships (LGPL 2.1).
public enum FFmpegLicence {
    public static let notice = """
    Marquee uses FFmpeg n9.0.2 (https://ffmpeg.org), in the build that MPVKit ships, to decode DTS, Dolby TrueHD, Opus, Vorbis, MP2, ALAC \
    and other audio Apple's player can't play for the MKV remuxer and to play files in its built-in decoder. It is licensed under the GNU Lesser General \
    Public License, version 2.1 or later, and built without any GPL or non-free parts. Marquee's source is public, \
    so the app can be relinked against a modified FFmpeg.
    """

    /// The full LGPL 2.1 text.
    public static var text: String {
        Bundle.module.url(forResource: "COPYING.LGPLv2", withExtension: "1")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
    }
}
