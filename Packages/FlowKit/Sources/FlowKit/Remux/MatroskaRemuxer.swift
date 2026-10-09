import Foundation

/// Turns a Matroska file into HLS that AVPlayer plays natively, without re-encoding:
/// video and each playable audio track become fragmented-MP4 renditions, text subtitles
/// become WebVTT. Segments are cut at the file's own keyframe index (Cues) and built on
/// demand from HTTP range reads, so seeking anywhere costs one segment's worth of data.
public actor MatroskaRemuxer {
    public struct OutputTrack: Sendable, Identifiable {
        public enum Role: Sendable { case video, audio, subtitle }
        public let role: Role
        public let source: MatroskaTrack
        public let codecString: String
        public let timescale: UInt32
        public let label: String
        let sampleEntry: [UInt8]
        /// PCM samples per frame for fixed-frame audio codecs.
        let frameSamples: Int
        let codec: Codec

        public var id: Int { source.number }
        public var language: String { source.language }
    }

    enum Codec: Sendable { case h264, hevc, av1, aac, mp3, ac3, eac3, flac, text, ass }

    public struct Skipped: Sendable, Hashable {
        public let track: MatroskaTrack
        public let reason: String
    }

    public struct Segment: Sendable, Hashable {
        public let index: Int
        /// Nanoseconds.
        public let start: Int64
        public let end: Int64
        let byteStart: Int64
        let byteEnd: Int64
        public var duration: Double { Double(end - start) / 1e9 }
    }

    public nonisolated let header: MatroskaHeader
    public nonisolated let video: OutputTrack?
    public nonisolated let audio: [OutputTrack]
    public nonisolated let subtitles: [OutputTrack]
    public nonisolated let skipped: [Skipped]
    public nonisolated let segments: [Segment]
    public nonisolated let duration: Double
    /// Added to every track's timestamps so B-frame reordering never needs a negative
    /// composition offset (nanoseconds). Zero when the video has no B-frames.
    public nonisolated let presentationDelay: Int64

    private let source: ByteSource
    private var cache: [Int: [MatroskaBlock]] = [:]
    private var cacheOrder: [Int] = []
    private var inflight: [Int: Task<[MatroskaBlock], Error>] = [:]

    /// Reads the header and enough of the first clusters to configure Dolby audio, then plans segments.
    public static func open(_ source: ByteSource, targetSegment: Double = 6) async throws -> MatroskaRemuxer {
        let header = try await MatroskaReader.readHeader(source)
        guard let firstCluster = header.firstClusterPosition else { throw MatroskaError.malformed("no clusters") }

        // AC-3 and E-AC-3 configuration comes from a real frame, so look at the start of the file.
        // The opening clusters give Dolby audio its configuration and show how far B-frames reorder.
        let probe = try await source.read(firstCluster..<(firstCluster + 4 * 1024 * 1024))
        let probeBlocks = (try? MatroskaClusterParser.blocks(probe, timecodeScale: header.timecodeScale, tracks: header.tracks)) ?? []
        var firstFrames: [Int: [UInt8]] = [:]
        for block in probeBlocks where firstFrames[block.track] == nil { firstFrames[block.track] = block.frames.first }

        var video: OutputTrack?
        var audio: [OutputTrack] = []
        var subtitles: [OutputTrack] = []
        var skipped: [Skipped] = []
        for track in header.tracks where track.isEnabled {
            switch Self.output(for: track, firstFrame: firstFrames[track.number]) {
            case .success(let out):
                switch out.role {
                case .video where video == nil: video = out
                case .video: skipped.append(Skipped(track: track, reason: "Extra video track"))
                case .audio: audio.append(out)
                case .subtitle: subtitles.append(out)
                }
            case .failure(let reason):
                skipped.append(Skipped(track: track, reason: reason.message))
            }
        }

        if let unsupportedVideo = skipped.first(where: { $0.track.kind == .video }), video == nil {
            throw MatroskaError.unsupported(unsupportedVideo.reason)
        }
        if video == nil && audio.isEmpty {
            throw MatroskaError.unsupported(skipped.first?.reason ?? "no playable tracks")
        }
        // The default audio first, so it's what plays when nothing else is chosen.
        audio.sort { ($0.source.isDefault ? 0 : 1, $0.source.number) < ($1.source.isDefault ? 0 : 1, $1.source.number) }

        let duration = Double(header.duration ?? 0) / 1e9
        let segments = try Self.plan(header: header, anchorTrack: video?.source.number ?? audio.first!.source.number, target: targetSegment)
        let delay = video.map { Self.reorderDelay(probeBlocks.filter { $0.track == video!.id }, frame: $0.source.defaultDuration) } ?? 0
        return MatroskaRemuxer(source: source, header: header, video: video, audio: audio, subtitles: subtitles,
                               skipped: skipped, segments: segments, duration: duration, presentationDelay: delay)
    }

    /// How far presentation runs ahead of decode order in the opening frames, with headroom.
    static func reorderDelay(_ blocks: [MatroskaBlock], frame: Int64?) -> Int64 {
        let pts = blocks.map(\.time)
        let sorted = pts.sorted()
        let reorder = zip(sorted, pts).map { $0 - $1 }.max() ?? 0
        guard reorder > 0 else { return 0 }
        let frameDuration = frame ?? 41_708_333
        return min(1_000_000_000, max(reorder * 2, frameDuration * 3))
    }

    private init(source: ByteSource, header: MatroskaHeader, video: OutputTrack?, audio: [OutputTrack], subtitles: [OutputTrack],
                 skipped: [Skipped], segments: [Segment], duration: Double, presentationDelay: Int64) {
        self.presentationDelay = presentationDelay
        self.source = source
        self.header = header
        self.video = video
        self.audio = audio
        self.subtitles = subtitles
        self.skipped = skipped
        self.segments = segments
        self.duration = duration
    }

    // MARK: Planning

    static func plan(header: MatroskaHeader, anchorTrack: Int, target: Double) throws -> [Segment] {
        var cues = header.cues.filter { $0.track == anchorTrack }
        if cues.isEmpty { cues = header.cues }
        guard !cues.isEmpty else { throw MatroskaError.unsupported("this file has no seek index (Cues)") }
        let base = header.segmentDataStart
        let end = header.segmentEnd ?? Int64.max
        let total = header.duration ?? (cues.last!.time + Int64(target * 1e9))
        let clusterStarts = Array(Set(header.cues.map(\.clusterPosition))).sorted()

        // Boundaries every `target` seconds or so, always on a cue (keyframe).
        var boundaries: [MatroskaCue] = [cues[0]]
        for cue in cues.dropFirst() where Double(cue.time - boundaries.last!.time) / 1e9 >= target * 0.9 {
            boundaries.append(cue)
        }

        func rangeEnd(after boundary: MatroskaCue) -> Int64 {
            // If the keyframe opens its cluster, the previous segment ends where that cluster starts.
            if let relative = boundary.relativePosition, relative <= 16 { return base + boundary.clusterPosition }
            let next = clusterStarts.first { $0 > boundary.clusterPosition }
            return next.map { base + $0 } ?? end
        }

        var segments: [Segment] = []
        for (i, boundary) in boundaries.enumerated() {
            let next = i + 1 < boundaries.count ? boundaries[i + 1] : nil
            let start = i == 0 ? 0 : boundary.time
            let segmentEnd = next?.time ?? max(total, boundary.time + 1_000_000)
            let byteEnd = next.map(rangeEnd(after:)) ?? end
            let byteStart = i == 0 ? (header.firstClusterPosition ?? base + boundary.clusterPosition) : base + boundary.clusterPosition
            segments.append(Segment(index: i, start: start, end: segmentEnd,
                                    byteStart: byteStart, byteEnd: max(byteEnd, byteStart + 1)))
        }
        return segments
    }

    // MARK: Track support

    struct Unsupported: Error { let message: String }

    static func output(for t: MatroskaTrack, firstFrame: [UInt8]?) -> Result<OutputTrack, Unsupported> {
        if t.isEncrypted { return .failure(Unsupported(message: "Encrypted track")) }
        if t.isCompressedUnsupported { return .failure(Unsupported(message: "Compressed track (zlib)")) }
        let label = trackLabel(t)
        switch t.kind {
        case .video:
            return videoOutput(t, label: label)
        case .audio:
            return audioOutput(t, firstFrame: firstFrame, label: label)
        case .subtitle:
            switch t.codecID {
            case "S_TEXT/UTF8", "S_TEXT/WEBVTT":
                return .success(OutputTrack(role: .subtitle, source: t, codecString: "wvtt", timescale: 1000, label: label, sampleEntry: [], frameSamples: 0, codec: .text))
            case "S_TEXT/ASS", "S_TEXT/SSA", "S_ASS", "S_SSA":
                return .success(OutputTrack(role: .subtitle, source: t, codecString: "wvtt", timescale: 1000, label: label, sampleEntry: [], frameSamples: 0, codec: .ass))
            case "S_HDMV/PGS": return .failure(Unsupported(message: "Picture-based subtitles (PGS)"))
            case "S_VOBSUB": return .failure(Unsupported(message: "Picture-based subtitles (VobSub)"))
            default: return .failure(Unsupported(message: "Subtitle format \(t.codecID)"))
            }
        default:
            return .failure(Unsupported(message: "Track type"))
        }
    }

    private static func videoOutput(_ t: MatroskaTrack, label: String) -> Result<OutputTrack, Unsupported> {
        var children: [UInt8] = []
        var type: String
        var codecString: String
        let codec: Codec
        switch t.codecID {
        case "V_MPEG4/ISO/AVC":
            guard t.codecPrivate.count >= 4 else { return .failure(Unsupported(message: "H.264 without configuration")) }
            type = "avc1"
            codec = .h264
            children = MP4.box("avcC", t.codecPrivate)
            codecString = String(format: "avc1.%02X%02X%02X", t.codecPrivate[1], t.codecPrivate[2], t.codecPrivate[3])
        case "V_MPEGH/ISO/HEVC":
            guard t.codecPrivate.count >= 23 else { return .failure(Unsupported(message: "HEVC without configuration")) }
            type = "hvc1"
            codec = .hevc
            children = MP4.box("hvcC", t.codecPrivate)
            codecString = hevcCodecString(t.codecPrivate)
        case "V_AV1":
            guard t.codecPrivate.count >= 4 else { return .failure(Unsupported(message: "AV1 without configuration")) }
            type = "av01"
            codec = .av1
            children = MP4.box("av1C", t.codecPrivate)
            codecString = av1CodecString(t.codecPrivate, colour: t.colour)
        case "V_MPEG2": return .failure(Unsupported(message: "MPEG-2 video"))
        case "V_MS/VFW/FOURCC": return .failure(Unsupported(message: "Legacy video (VC-1, DivX or Xvid)"))
        case "V_VP8", "V_VP9": return .failure(Unsupported(message: t.codecID == "V_VP9" ? "VP9 video" : "VP8 video"))
        default: return .failure(Unsupported(message: "Video format \(t.codecID)"))
        }

        if let colour = t.colour, colour.primaries != nil || colour.transfer != nil {
            children += MP4.colr(colour)
            if let mastering = colour.mastering { children += MP4.mdcv(mastering) }
            if colour.maxCLL != nil || colour.maxFALL != nil { children += MP4.clli(maxCLL: colour.maxCLL ?? 0, maxFALL: colour.maxFALL ?? 0) }
        }
        if let dv = t.dolbyVision, let boxType = t.dolbyVisionBoxType, dv.count >= 4, codec == .hevc {
            let profile = Int(dv[2] >> 1)
            let level = Int((dv[2] & 1) << 5 | dv[3] >> 3)
            children += MP4.box(boxType, dv)
            if profile == 5 {
                // Profile 5 has no HDR10 base layer: it must be signalled as Dolby Vision.
                type = "dvh1"
                codecString = String(format: "dvh1.%02d.%02d", profile, level)
            }
        }
        if let dw = t.displayWidth, let dh = t.displayHeight, dw > 0, dh > 0, t.width > 0, t.height > 0, dw * t.height != dh * t.width {
            children += MP4.pasp(h: dw * t.height, v: dh * t.width)
        }
        let entry = MP4.visualSampleEntry(type, width: t.width, height: t.height, children: children)
        return .success(OutputTrack(role: .video, source: t, codecString: codecString, timescale: 90000, label: label, sampleEntry: entry, frameSamples: 0, codec: codec))
    }

    private static func audioOutput(_ t: MatroskaTrack, firstFrame: [UInt8]?, label: String) -> Result<OutputTrack, Unsupported> {
        let rate = Int(t.sampleRate)
        switch t.codecID {
        case let id where id.hasPrefix("A_AAC"):
            let asc = t.codecPrivate.isEmpty ? AAC.audioSpecificConfig(codecID: id, sampleRate: t.sampleRate, channels: t.channels) : t.codecPrivate
            let entry = MP4.audioSampleEntry("mp4a", channels: t.channels, sampleRate: rate, children: MP4.esds(objectType: 0x40, decoderSpecificInfo: asc, bitrate: 0))
            return .success(OutputTrack(role: .audio, source: t, codecString: "mp4a.40.\(AAC.objectType(asc))", timescale: UInt32(rate), label: label, sampleEntry: entry, frameSamples: 1024, codec: .aac))
        case "A_MPEG/L3":
            let entry = MP4.audioSampleEntry("mp4a", channels: t.channels, sampleRate: rate, children: MP4.esds(objectType: 0x6B, decoderSpecificInfo: [], bitrate: 0))
            return .success(OutputTrack(role: .audio, source: t, codecString: "mp4a.40.34", timescale: UInt32(rate), label: label, sampleEntry: entry,
                                        frameSamples: firstFrame.map(MP3.samplesPerFrame) ?? 1152, codec: .mp3))
        case "A_AC3":
            guard let frame = firstFrame, let h = AC3.parse(frame) else { return .failure(Unsupported(message: "AC-3 stream without a readable frame")) }
            let entry = MP4.audioSampleEntry("ac-3", channels: h.channels, sampleRate: h.sampleRate, children: MP4.box("dac3", AC3.dac3(h)))
            return .success(OutputTrack(role: .audio, source: t, codecString: "ac-3", timescale: UInt32(h.sampleRate), label: label, sampleEntry: entry, frameSamples: 1536, codec: .ac3))
        case "A_EAC3":
            guard let frame = firstFrame, let dec3 = EAC3.dec3(frame), let first = EAC3.parse(frame) else {
                return .failure(Unsupported(message: "E-AC-3 stream without a readable frame"))
            }
            let entry = MP4.audioSampleEntry("ec-3", channels: EAC3.channels(frame), sampleRate: first.sampleRate, children: MP4.box("dec3", dec3))
            return .success(OutputTrack(role: .audio, source: t, codecString: "ec-3", timescale: UInt32(first.sampleRate), label: label, sampleEntry: entry,
                                        frameSamples: EAC3.samples(in: frame), codec: .eac3))
        case "A_FLAC":
            guard let dfLa = FLAC.dfLa(t.codecPrivate) else { return .failure(Unsupported(message: "FLAC without stream info")) }
            let entry = MP4.audioSampleEntry("fLaC", channels: t.channels, sampleRate: rate, children: MP4.fullBox("dfLa") { w in w.append(dfLa) })
            return .success(OutputTrack(role: .audio, source: t, codecString: "fLaC", timescale: UInt32(rate), label: label, sampleEntry: entry,
                                        frameSamples: firstFrame.flatMap(FLAC.blockSize) ?? 4096, codec: .flac))
        case "A_DTS": return .failure(Unsupported(message: "DTS audio"))
        case "A_TRUEHD", "A_MLP": return .failure(Unsupported(message: "Dolby TrueHD audio"))
        case "A_OPUS": return .failure(Unsupported(message: "Opus audio"))
        case "A_VORBIS": return .failure(Unsupported(message: "Vorbis audio"))
        case let id where id.hasPrefix("A_PCM"): return .failure(Unsupported(message: "Uncompressed PCM audio"))
        default: return .failure(Unsupported(message: "Audio format \(t.codecID)"))
        }
    }

    static func hevcCodecString(_ c: [UInt8]) -> String {
        let space = Int(c[1] >> 6)
        let tier = (c[1] >> 5) & 1
        let profile = Int(c[1] & 0x1F)
        var compat = UInt32(c[2]) << 24 | UInt32(c[3]) << 16 | UInt32(c[4]) << 8 | UInt32(c[5])
        var reversed: UInt32 = 0
        for _ in 0..<32 { reversed = reversed << 1 | (compat & 1); compat >>= 1 }
        var constraints = Array(c[6..<12])
        while constraints.last == 0 { constraints.removeLast() }
        let level = Int(c[12])
        var parts = ["hvc1", ["", "A", "B", "C"][space] + String(profile), String(reversed, radix: 16, uppercase: true), (tier == 1 ? "H" : "L") + String(level)]
        parts += constraints.map { String(format: "%02X", $0) }
        return parts.joined(separator: ".")
    }

    static func av1CodecString(_ c: [UInt8], colour: MatroskaColour?) -> String {
        let profile = Int(c[1] >> 5)
        let level = Int(c[1] & 0x1F)
        let tier = (c[2] >> 7) & 1
        let highBitDepth = (c[2] >> 6) & 1
        let twelveBit = (c[2] >> 5) & 1
        let depth = highBitDepth == 1 ? (twelveBit == 1 ? 12 : 10) : 8
        return "av01.\(profile)." + String(format: "%02d", level) + (tier == 1 ? "H" : "M") + "." + String(format: "%02d", depth)
    }

    static func trackLabel(_ t: MatroskaTrack) -> String {
        let language = LanguageName.display(t.language)
        if let name = t.name?.trimmingCharacters(in: .whitespaces), !name.isEmpty, name.lowercased() != language.lowercased() {
            return name.localizedCaseInsensitiveContains(language) ? name : "\(language) – \(name)"
        }
        guard t.kind == .audio else { return language }
        let codec: String
        switch t.codecID {
        case "A_AC3": codec = "Dolby Digital"
        case "A_EAC3": codec = "Dolby Digital Plus"
        case "A_FLAC": codec = "FLAC"
        case "A_MPEG/L3": codec = "MP3"
        default: codec = t.codecID.hasPrefix("A_AAC") ? "AAC" : t.codecID
        }
        let layout = t.channels >= 8 ? "7.1" : (t.channels >= 6 ? "5.1" : (t.channels == 2 ? "Stereo" : (t.channels == 1 ? "Mono" : "\(t.channels)ch")))
        return "\(language) (\(codec) \(layout))"
    }

    // MARK: Playlists

    public func masterPlaylist() -> String {
        var lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]
        for (i, a) in audio.enumerated() {
            var attrs = ["TYPE=AUDIO", "GROUP-ID=\"audio\"", "NAME=\"\(Self.quoted(a.label))\"", "LANGUAGE=\"\(LanguageName.bcp47(a.language))\"",
                         "DEFAULT=\(i == 0 ? "YES" : "NO")", "AUTOSELECT=YES", "CHANNELS=\"\(a.source.channels)\""]
            if video == nil { attrs.removeAll { $0.hasPrefix("DEFAULT") }; attrs.append("DEFAULT=YES") }
            attrs.append("URI=\"\(a.id).m3u8\"")
            lines.append("#EXT-X-MEDIA:" + attrs.joined(separator: ","))
        }
        for s in subtitles {
            var attrs = ["TYPE=SUBTITLES", "GROUP-ID=\"subs\"", "NAME=\"\(Self.quoted(s.label + (s.source.isForced ? " (Forced)" : "")))\"",
                         "LANGUAGE=\"\(LanguageName.bcp47(s.language))\"", "DEFAULT=NO", "AUTOSELECT=YES", "FORCED=\(s.source.isForced ? "YES" : "NO")"]
            if s.source.isHearingImpaired {
                attrs.append("CHARACTERISTICS=\"public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound\"")
            }
            attrs.append("URI=\"\(s.id).m3u8\"")
            lines.append("#EXT-X-MEDIA:" + attrs.joined(separator: ","))
        }
        let codecs = ([video?.codecString] + Array(Set(audio.map(\.codecString))).sorted()).compactMap { $0 }
        var inf = ["BANDWIDTH=\(peakBandwidth)", "AVERAGE-BANDWIDTH=\(averageBandwidth)", "CODECS=\"\(codecs.joined(separator: ","))\""]
        if let v = video {
            inf.append("RESOLUTION=\(v.source.width)x\(v.source.height)")
            if let frame = v.source.defaultDuration, frame > 0 { inf.append(String(format: "FRAME-RATE=%.3f", 1e9 / Double(frame))) }
            inf.append("VIDEO-RANGE=\(videoRange)")
        }
        if !audio.isEmpty && video != nil { inf.append("AUDIO=\"audio\"") }
        if !subtitles.isEmpty { inf.append("SUBTITLES=\"subs\"") }
        lines.append("#EXT-X-STREAM-INF:" + inf.joined(separator: ","))
        lines.append(video.map { "\($0.id).m3u8" } ?? "\(audio[0].id).m3u8")
        return lines.joined(separator: "\n") + "\n"
    }

    public func mediaPlaylist(track: Int) -> String? {
        let isSubtitle = subtitles.contains { $0.id == track }
        guard isSubtitle || video?.id == track || audio.contains(where: { $0.id == track }) else { return nil }
        let target = Int((segments.map(\.duration).max() ?? 6).rounded(.up))
        var lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:\(max(1, target))", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-INDEPENDENT-SEGMENTS"]
        if !isSubtitle { lines.append("#EXT-X-MAP:URI=\"\(track)/init.mp4\"") }
        for s in segments {
            lines.append(String(format: "#EXTINF:%.5f,", s.duration))
            lines.append("\(track)/\(s.index).\(isSubtitle ? "vtt" : "m4s")")
        }
        lines.append("#EXT-X-ENDLIST")
        return lines.joined(separator: "\n") + "\n"
    }

    private var videoRange: String {
        guard let v = video?.source else { return "SDR" }
        if v.dolbyVision != nil || v.colour?.isPQ == true { return "PQ" }
        if v.colour?.isHLG == true { return "HLG" }
        return "SDR"
    }

    private var peakBandwidth: Int {
        let peak = segments.map { Double($0.byteEnd - $0.byteStart) * 8 / max($0.duration, 0.5) }.max() ?? 5_000_000
        return max(64_000, Int(peak * 1.1))
    }

    private var averageBandwidth: Int {
        guard let last = segments.last, let first = segments.first, duration > 0 else { return peakBandwidth }
        return max(64_000, Int(Double(last.byteEnd - first.byteStart) * 8 / duration))
    }

    private static func quoted(_ s: String) -> String { s.replacingOccurrences(of: "\"", with: "'") }

    // MARK: Segments

    public func initSegment(track: Int) -> [UInt8]? {
        guard let t = output(track), t.role != .subtitle else { return nil }
        var info = MP4.TrackInfo(isVideo: t.role == .video, timescale: t.timescale, language: t.language, sampleEntry: t.sampleEntry)
        info.width = t.source.width
        info.height = t.source.height
        if let dw = t.source.displayWidth, let dh = t.source.displayHeight, dw > 0, dh > 0 {
            info.displayWidth = t.source.height * dw / dh
            info.displayHeight = t.source.height
        }
        return MP4.initSegment(info)
    }

    public func mediaSegment(track: Int, index: Int) async throws -> [UInt8]? {
        guard let t = output(track), t.role != .subtitle, segments.indices.contains(index) else { return nil }
        let segment = segments[index]
        let blocks = try await blocks(for: index).filter { $0.track == track }
        let samples: [MP4.Sample]
        let base: UInt64
        if t.role == .video {
            (samples, base) = videoSamples(blocks, segment: segment, track: t)
        } else {
            (samples, base) = audioSamples(blocks, segment: segment, track: t)
        }
        return MP4.fragment(sequence: UInt32(index + 1), baseDecodeTime: base, samples: samples, isVideo: t.role == .video)
    }

    public func subtitleSegment(track: Int, index: Int) async throws -> String? {
        guard let t = subtitles.first(where: { $0.id == track }), segments.indices.contains(index) else { return nil }
        let segment = segments[index]
        let isLast = index == segments.count - 1
        let blocks = try await blocks(for: index).filter { $0.track == track && (index == 0 || $0.time >= segment.start) && (isLast || $0.time < segment.end) }
        var out = "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:\(presentationDelay * 9 / 100_000),LOCAL:00:00:00.000\n\n"
        for block in blocks {
            guard let frame = block.frames.first else { continue }
            let raw = String(decoding: frame, as: UTF8.self)
            let text = t.codec == .ass ? SubtitleText.fromASSEvent(raw) : SubtitleText.cleanSRT(raw)
            guard !text.isEmpty else { continue }
            let end = block.time + (block.duration ?? 3_000_000_000)
            out += "\(SubtitleText.vttTime(block.time)) --> \(SubtitleText.vttTime(end))\n\(text)\n\n"
        }
        return out
    }

    public func chapters() -> [MatroskaChapter] { header.chapters }

    private func output(_ track: Int) -> OutputTrack? {
        if video?.id == track { return video }
        return audio.first { $0.id == track } ?? subtitles.first { $0.id == track }
    }

    private func videoSamples(_ blocks: [MatroskaBlock], segment: Segment, track: OutputTrack) -> ([MP4.Sample], UInt64) {
        let tolerance: Int64 = 2_000_000
        let isLast = segment.index == segments.count - 1
        let startIndex = blocks.firstIndex { $0.isKeyframe && $0.time >= segment.start - tolerance } ?? 0
        var endIndex = blocks.count
        if !isLast, let next = blocks[(startIndex + 1)...].firstIndex(where: { $0.isKeyframe && $0.time >= segment.end - tolerance }) {
            endIndex = next
        }
        let chosen = startIndex < endIndex ? Array(blocks[startIndex..<endIndex]) : []
        guard !chosen.isEmpty else { return ([], UInt64(max(0, segment.start) * 9 / 100_000)) }

        let frame = track.source.defaultDuration
        func snap(_ t: Int64) -> Int64 {
            guard let frame, frame > 0 else { return t }
            return Int64((Double(t) / Double(frame)).rounded()) * frame
        }
        let presentation = chosen.map { snap(max(0, $0.time)) }
        let dts = presentation.sorted().map { $0 * 9 / 100_000 }
        let pts = presentation.map { ($0 + presentationDelay) * 9 / 100_000 }
        let fallback = Int64(frame.map { $0 * 9 / 100_000 } ?? 3750)
        var samples: [MP4.Sample] = []
        samples.reserveCapacity(chosen.count)
        for (i, block) in chosen.enumerated() {
            let duration = i + 1 < dts.count ? dts[i + 1] - dts[i] : fallback
            samples.append(MP4.Sample(data: block.frames.count == 1 ? block.frames[0] : block.frames.flatMap { $0 },
                                      duration: UInt32(clamping: max(1, duration)),
                                      compositionOffset: Int32(clamping: max(0, pts[i] - dts[i])),
                                      isSync: block.isKeyframe))
        }
        return (samples, UInt64(max(0, dts[0])))
    }

    private func audioSamples(_ blocks: [MatroskaBlock], segment: Segment, track: OutputTrack) -> ([MP4.Sample], UInt64) {
        let isLast = segment.index == segments.count - 1
        let isFirst = segment.index == 0
        let chosen = blocks.filter { (isFirst || $0.time >= segment.start) && (isLast || $0.time < segment.end) }
        let rate = Int64(track.timescale)
        guard let first = chosen.first else { return ([], UInt64((max(0, segment.start) + presentationDelay) * rate / 1_000_000_000)) }
        var samples: [MP4.Sample] = []
        for block in chosen {
            let frames: [[UInt8]] = track.codec == .ac3 ? block.frames.flatMap(AC3.frames) : block.frames
            for frame in frames {
                let duration: Int
                switch track.codec {
                case .eac3: duration = EAC3.samples(in: frame)
                case .flac: duration = FLAC.blockSize(frame) ?? track.frameSamples
                case .mp3: duration = MP3.samplesPerFrame(frame)
                default: duration = track.frameSamples
                }
                samples.append(MP4.Sample(data: frame, duration: UInt32(duration), isSync: true))
            }
        }
        return (samples, UInt64((max(0, first.time) + presentationDelay) * rate / 1_000_000_000))
    }

    /// Demuxed blocks for a segment, shared by every rendition that asks for it.
    private func blocks(for index: Int) async throws -> [MatroskaBlock] {
        if let cached = cache[index] {
            cacheOrder.removeAll { $0 == index }
            cacheOrder.append(index)
            return cached
        }
        if let task = inflight[index] { return try await task.value }
        let segment = segments[index]
        let source = self.source
        let scale = header.timecodeScale
        let tracks = header.tracks
        let task = Task { () throws -> [MatroskaBlock] in
            let bytes = try await source.read(segment.byteStart..<segment.byteEnd)
            return try MatroskaClusterParser.blocks(bytes, timecodeScale: scale, tracks: tracks)
        }
        inflight[index] = task
        defer { inflight[index] = nil }
        let blocks = try await task.value
        cache[index] = blocks
        cacheOrder.append(index)
        while cacheOrder.count > 3 { cache[cacheOrder.removeFirst()] = nil }
        return blocks
    }

    // MARK: Routing

    public enum Response: Sendable {
        case playlist(String)
        case media([UInt8])
        case text(String)
    }

    /// Answers the HLS client's requests: master.m3u8, <track>.m3u8, <track>/init.mp4, <track>/<n>.m4s, <track>/<n>.vtt.
    public func respond(to path: String) async throws -> Response? {
        let parts = path.split(separator: "/").map(String.init)
        guard let last = parts.last else { return nil }
        if parts.count == 1 {
            if last == "master.m3u8" { return .playlist(masterPlaylist()) }
            guard last.hasSuffix(".m3u8"), let track = Int(last.dropLast(5)) else { return nil }
            return mediaPlaylist(track: track).map(Response.playlist)
        }
        guard parts.count == 2, let track = Int(parts[0]) else { return nil }
        if last == "init.mp4" { return initSegment(track: track).map(Response.media) }
        if last.hasSuffix(".m4s"), let index = Int(last.dropLast(4)) {
            return try await mediaSegment(track: track, index: index).map(Response.media)
        }
        if last.hasSuffix(".vtt"), let index = Int(last.dropLast(4)) {
            return try await subtitleSegment(track: track, index: index).map(Response.text)
        }
        return nil
    }
}

// MARK: - Subtitle text

enum SubtitleText {
    static func vttTime(_ ns: Int64) -> String {
        let ms = max(0, ns / 1_000_000)
        return String(format: "%02d:%02d:%02d.%03d", ms / 3_600_000, (ms / 60_000) % 60, (ms / 1000) % 60, ms % 1000)
    }

    /// SRT text keeps <i>, <b>, <u>; anything else (font tags) is dropped.
    static func cleanSRT(_ s: String) -> String {
        var out = s.replacingOccurrences(of: "\r\n", with: "\n")
        out = out.replacingOccurrences(of: #"</?font[^>]*>"#, with: "", options: .regularExpression)
        out = out.replacingOccurrences(of: #"\{\\[^}]*\}"#, with: "", options: .regularExpression)
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Matroska ASS events are "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text".
    static func fromASSEvent(_ s: String) -> String {
        let fields = s.split(separator: ",", maxSplits: 8, omittingEmptySubsequences: false)
        let text = fields.count == 9 ? String(fields[8]) : s
        var out = text.replacingOccurrences(of: #"\{[^}]*\}"#, with: "", options: .regularExpression)
        out = out.replacingOccurrences(of: "\\N", with: "\n").replacingOccurrences(of: "\\n", with: "\n").replacingOccurrences(of: "\\h", with: " ")
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Languages

public enum LanguageName {
    private static let codes: [String: (String, String)] = [
        "eng": ("en", "English"), "spa": ("es", "Spanish"), "fre": ("fr", "French"), "fra": ("fr", "French"), "ger": ("de", "German"),
        "deu": ("de", "German"), "ita": ("it", "Italian"), "por": ("pt", "Portuguese"), "jpn": ("ja", "Japanese"), "kor": ("ko", "Korean"),
        "chi": ("zh", "Chinese"), "zho": ("zh", "Chinese"), "rus": ("ru", "Russian"), "ara": ("ar", "Arabic"), "hin": ("hi", "Hindi"),
        "tam": ("ta", "Tamil"), "tel": ("te", "Telugu"), "dut": ("nl", "Dutch"), "nld": ("nl", "Dutch"), "swe": ("sv", "Swedish"),
        "nor": ("no", "Norwegian"), "dan": ("da", "Danish"), "fin": ("fi", "Finnish"), "pol": ("pl", "Polish"), "tur": ("tr", "Turkish"),
        "gre": ("el", "Greek"), "ell": ("el", "Greek"), "heb": ("he", "Hebrew"), "tha": ("th", "Thai"), "vie": ("vi", "Vietnamese"),
        "ind": ("id", "Indonesian"), "may": ("ms", "Malay"), "msa": ("ms", "Malay"), "cze": ("cs", "Czech"), "ces": ("cs", "Czech"),
        "hun": ("hu", "Hungarian"), "rum": ("ro", "Romanian"), "ron": ("ro", "Romanian"), "ukr": ("uk", "Ukrainian"), "per": ("fa", "Persian"),
        "fas": ("fa", "Persian"), "ben": ("bn", "Bengali"), "mal": ("ml", "Malayalam"), "kan": ("kn", "Kannada"), "mar": ("mr", "Marathi"),
        "urd": ("ur", "Urdu"), "fil": ("fil", "Filipino"), "tgl": ("tl", "Tagalog"), "bul": ("bg", "Bulgarian"), "hrv": ("hr", "Croatian"),
        "srp": ("sr", "Serbian"), "slv": ("sl", "Slovenian"), "slo": ("sk", "Slovak"), "slk": ("sk", "Slovak"), "lit": ("lt", "Lithuanian"),
        "lav": ("lv", "Latvian"), "est": ("et", "Estonian"), "ice": ("is", "Icelandic"), "isl": ("is", "Icelandic"), "cat": ("ca", "Catalan"),
        "baq": ("eu", "Basque"), "eus": ("eu", "Basque"), "glg": ("gl", "Galician"), "und": ("und", "Unknown"),
    ]

    public static func bcp47(_ code: String) -> String {
        let lower = code.lowercased()
        if let match = codes[lower] { return match.0 }
        return lower.isEmpty ? "und" : lower
    }

    public static func display(_ code: String) -> String {
        let lower = code.lowercased()
        if let match = codes[lower] { return match.1 }
        if let name = Locale(identifier: "en").localizedString(forLanguageCode: lower) { return name }
        return code.isEmpty ? "Unknown" : code
    }
}
