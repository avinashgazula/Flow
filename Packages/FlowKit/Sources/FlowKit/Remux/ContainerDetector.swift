import Foundation

/// Decides whether a stream needs Flow's remuxer before AVPlayer can play it.
public enum ContainerDetector {
    public enum Container: Equatable, Sendable {
        /// AVPlayer opens these directly (MP4, MOV, HLS, MPEG-TS, plain audio).
        case native
        /// Matroska/WebM: remux to HLS.
        case matroska
        /// Containers neither Apple's player nor the remuxer opens (AVI, WMV, FLV, RealMedia, DVD and
        /// Ogg): Flow's built-in decoder plays these. The name is for the notice and the details panel.
        case unsupported(String)
        /// Unknown from the name; look at the first bytes.
        case unknown
    }

    static let nativeExtensions: Set<String> = ["mp4", "m4v", "mov", "m3u8", "m3u", "ts", "m2ts", "mts", "mp3", "m4a", "aac", "ac3", "eac3", "flac", "wav", "caf", "3gp"]
    static let matroskaExtensions: Set<String> = ["mkv", "mk3d", "mka", "webm"]
    static let unsupportedExtensions: [String: String] = ["avi": "AVI", "divx": "AVI", "xvid": "AVI", "wmv": "Windows Media", "asf": "Windows Media", "wm": "Windows Media",
                                                          "wtv": "Windows Media", "dvr-ms": "Windows Media", "flv": "Flash Video", "f4v": "Flash Video",
                                                          "rmvb": "RealMedia", "rm": "RealMedia", "vob": "DVD VOB", "mpg": "MPEG-PS", "mpeg": "MPEG-PS", "mpe": "MPEG-PS",
                                                          "m2v": "MPEG-PS", "ogv": "Ogg", "ogm": "Ogg", "ogg": "Ogg", "ogx": "Ogg"]

    /// From the URL path and the file name an add-on or server reported.
    public static func container(url: URL, filename: String?) -> Container {
        let candidates = [url.pathExtension, filename.map { ($0 as NSString).pathExtension } ?? ""].map { $0.lowercased() }.filter { !$0.isEmpty }
        for ext in candidates {
            if matroskaExtensions.contains(ext) { return .matroska }
            if nativeExtensions.contains(ext) { return .native }
            if let name = unsupportedExtensions[ext] { return .unsupported(name) }
        }
        let query = url.query?.lowercased() ?? ""
        if query.contains(".mkv") { return .matroska }
        if query.contains(".m3u8") || query.contains(".mp4") { return .native }
        return .unknown
    }

    /// From a stream's first bytes.
    public static func sniff(_ bytes: [UInt8]) -> Container {
        if bytes.starts(with: [0x1A, 0x45, 0xDF, 0xA3]) { return .matroska }
        if bytes.count >= 8, Array(bytes[4..<8]) == Array("ftyp".utf8) || Array(bytes[4..<8]) == Array("moov".utf8) { return .native }
        if bytes.starts(with: Array("#EXTM3U".utf8)) || bytes.first == 0x47 { return .native }
        if bytes.starts(with: Array("RIFF".utf8)), bytes.count >= 12, Array(bytes[8..<11]) == Array("AVI".utf8) { return .unsupported("AVI") }
        if bytes.starts(with: [0x30, 0x26, 0xB2, 0x75]) { return .unsupported("Windows Media") }
        if bytes.starts(with: Array("FLV".utf8)) { return .unsupported("Flash Video") }
        if bytes.starts(with: Array("OggS".utf8)) { return .unsupported("Ogg") }
        if bytes.starts(with: Array(".RMF".utf8)) { return .unsupported("RealMedia") }
        // A program stream's pack header (DVD VOB, MPEG-1/2 files); a transport stream starts with 0x47 instead.
        if bytes.starts(with: [0x00, 0x00, 0x01, 0xBA]) { return .unsupported("MPEG-PS") }
        return .native
    }
}
