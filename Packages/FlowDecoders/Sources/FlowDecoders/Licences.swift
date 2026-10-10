import Foundation

/// What Flow must show about the FFmpeg it ships (LGPL 2.1).
public enum FFmpegLicence {
    public static let notice = """
    Flow uses FFmpeg 7.1.1 (https://ffmpeg.org) to decode DTS and Dolby TrueHD audio. \
    It is licensed under the GNU Lesser General Public License, version 2.1, and was built from the \
    unmodified release with only its DTS and TrueHD/MLP decoders. Flow's source, including the script that \
    builds FFmpeg (scripts/build-ffmpeg-decoders.sh), is public, so it can be rebuilt against a modified FFmpeg.
    """

    /// The full LGPL 2.1 text.
    public static var text: String {
        Bundle.module.url(forResource: "COPYING.LGPLv2", withExtension: "1")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
    }
}
