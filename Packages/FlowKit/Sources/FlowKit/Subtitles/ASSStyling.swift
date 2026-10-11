import Foundation

/// How an ASS/SSA author styled a line. Every property is optional: whatever a subtitle leaves
/// unspecified falls back to the viewer's own subtitle settings.
public struct SubtitleCueStyle: Hashable, Sendable {
    /// 0xRRGGBB.
    public var colour: UInt32?
    public var bold: Bool?
    public var italic: Bool?
    /// Font size as a fraction of the script's PlayResY, which is the picture height.
    public var scale: Double?
    /// Numpad layout: 1-3 bottom, 4-6 middle, 7-9 top, each left, centre, right.
    public var alignment: Int?
    /// Margins as fractions of the picture's height (vertical) and width (left, right).
    public var marginV: Double?
    public var marginL: Double?
    public var marginR: Double?

    public init(colour: UInt32? = nil, bold: Bool? = nil, italic: Bool? = nil, scale: Double? = nil, alignment: Int? = nil,
                marginV: Double? = nil, marginL: Double? = nil, marginR: Double? = nil) {
        self.colour = colour
        self.bold = bold
        self.italic = italic
        self.scale = scale
        self.alignment = alignment
        self.marginV = marginV
        self.marginL = marginL
        self.marginR = marginR
    }

    public var red: Double { Double((colour ?? 0xFFFFFF) >> 16 & 0xFF) / 255 }
    public var green: Double { Double((colour ?? 0xFFFFFF) >> 8 & 0xFF) / 255 }
    public var blue: Double { Double((colour ?? 0xFFFFFF) & 0xFF) / 255 }

    public enum Vertical: Sendable { case top, middle, bottom }
    public enum Horizontal: Sendable { case left, centre, right }

    /// The alignment split into rows and columns; nil when the author didn't say (or gave nonsense).
    public var placement: (vertical: Vertical, horizontal: Horizontal)? {
        guard let a = alignment, (1...9).contains(a) else { return nil }
        let vertical: Vertical = a <= 3 ? .bottom : a <= 6 ? .middle : .top
        let horizontal: Horizontal = a % 3 == 1 ? .left : a % 3 == 2 ? .centre : .right
        return (vertical, horizontal)
    }
}

/// Reads ASS/SSA scripts (the `.ass` / `.ssa` files subtitle sites hand out) into cues that carry the
/// author's styling. Karaoke, animation, clipping and vector drawings are ignored; mid-line colour,
/// weight and size changes aren't drawn, so only overrides before the first word apply.
public enum ASSParser {
    /// A script is ASS/SSA if it has the sections no SRT or WebVTT file does.
    public static func isASS(_ text: String) -> Bool {
        text.contains("[Script Info]") || text.contains("[V4+ Styles]") || text.contains("[V4 Styles]") || text.contains("[Events]")
    }

    public static func parse(_ text: String) -> SubtitleDocument {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var section = ""
        var playResX: Double?
        var playResY: Double = 288
        var styleFormat: [String] = []
        var eventFormat: [String] = []
        var isSSA = false
        // Sizes and margins are in script pixels; they become fractions once PlayRes is known.
        var styles: [String: (style: SubtitleCueStyle, size: Double?, l: Double, r: Double, v: Double)] = [:]
        var events: [[String: String]] = []

        for rawLine in normalized.components(separatedBy: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("[") && line.hasSuffix("]") {
                section = line.lowercased()
                isSSA = section == "[v4 styles]"
                continue
            }
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            switch section {
            case "[script info]":
                if key == "playresy", let n = Double(value), n > 0 { playResY = n }
                if key == "playresx", let n = Double(value), n > 0 { playResX = n }
            case "[v4+ styles]", "[v4 styles]":
                if key == "format" {
                    styleFormat = value.split(separator: ",", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                } else if key == "style", !styleFormat.isEmpty {
                    let fields = value.split(separator: ",", maxSplits: styleFormat.count - 1, omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
                    guard fields.count == styleFormat.count else { continue }
                    var f: [String: String] = [:]
                    for (name, field) in zip(styleFormat, fields) { f[name] = field }
                    guard let name = f["name"] else { continue }
                    var style = SubtitleCueStyle()
                    style.colour = f["primarycolour"].flatMap(colour)
                    style.bold = f["bold"].flatMap(Int.init).map { $0 != 0 }
                    style.italic = f["italic"].flatMap(Int.init).map { $0 != 0 }
                    style.alignment = f["alignment"].flatMap(Int.init).flatMap { isSSA ? ssaAlignment($0) : (1...9).contains($0) ? $0 : nil }
                    styles[name] = (style, f["fontsize"].flatMap(Double.init),
                                    f["marginl"].flatMap(Double.init) ?? 0, f["marginr"].flatMap(Double.init) ?? 0, f["marginv"].flatMap(Double.init) ?? 0)
                }
            case "[events]":
                if key == "format" {
                    eventFormat = value.split(separator: ",", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                } else if key == "dialogue", !eventFormat.isEmpty {
                    // Text is last and may itself hold commas.
                    let fields = value.split(separator: ",", maxSplits: eventFormat.count - 1, omittingEmptySubsequences: false).map(String.init)
                    guard fields.count == eventFormat.count else { continue }
                    var f: [String: String] = [:]
                    for (name, field) in zip(eventFormat, fields) { f[name] = field }
                    events.append(f)
                }
            default: break
            }
        }

        // Scripts without PlayResX are 4:3 by convention.
        let resX = playResX ?? playResY * 4 / 3
        var resolved: [String: SubtitleCueStyle] = [:]
        for (name, entry) in styles {
            var style = entry.style
            if let size = entry.size, size > 0 { style.scale = size / playResY }
            style.marginL = entry.l / resX
            style.marginR = entry.r / resX
            style.marginV = entry.v / playResY
            resolved[name] = style
        }

        var cues: [SubtitleCue] = []
        // Scripts often stack the same line on several layers (outline, glow); show it once.
        var seen = Set<String>()
        for event in events {
            guard let start = event["start"].flatMap(timestamp), let end = event["end"].flatMap(timestamp), end > start, let raw = event["text"] else { continue }
            var styleName = (event["style"] ?? "").trimmingCharacters(in: .whitespaces)
            if styleName.hasPrefix("*") { styleName.removeFirst() }
            var style = resolved[styleName] ?? resolved["Default"] ?? SubtitleCueStyle()
            // A nonzero margin on the line itself beats the style's.
            if let v = event["marginv"].flatMap({ Double($0.trimmingCharacters(in: .whitespaces)) }), v > 0 { style.marginV = v / playResY }
            if let l = event["marginl"].flatMap({ Double($0.trimmingCharacters(in: .whitespaces)) }), l > 0 { style.marginL = l / resX }
            if let r = event["marginr"].flatMap({ Double($0.trimmingCharacters(in: .whitespaces)) }), r > 0 { style.marginR = r / resX }
            guard let body = applyOverrides(raw, to: &style, playResY: playResY), !body.isEmpty else { continue }
            guard seen.insert("\(start)|\(end)|\(body)").inserted else { continue }
            cues.append(SubtitleCue(index: cues.count, start: start, end: end, text: body, style: style))
        }
        return SubtitleDocument(cues: cues)
    }

    /// Strips override blocks from a line's text and folds the ones before the first word into
    /// `style`. Nil for vector drawings, which have no text to show.
    static func applyOverrides(_ raw: String, to style: inout SubtitleCueStyle, playResY: Double) -> String? {
        var visible = ""
        var rest = Substring(raw)
        while let brace = rest.firstIndex(of: "{") {
            visible += rest[..<brace]
            guard let close = rest[brace...].firstIndex(of: "}") else { rest = rest[brace...]; break }
            var block = String(rest[rest.index(after: brace)..<close])
            // \t(...) animates; what's inside isn't the line's resting style.
            block = block.replacingOccurrences(of: #"\\t\((?:[^()]|\([^()]*\))*\)"#, with: "", options: .regularExpression)
            let leading = visible.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            for tag in block.split(separator: "\\") {
                let t = tag.trimmingCharacters(in: .whitespaces)
                if t.range(of: #"^p[1-9]"#, options: .regularExpression) != nil { return nil }
                // Placement covers the whole line wherever it appears.
                if let n = number(t, prefix: "an") { if (1...9).contains(n) { style.alignment = n }; continue }
                if t.range(of: #"^a\d+$"#, options: .regularExpression) != nil, let n = Int(t.dropFirst()) {
                    if let mapped = ssaAlignment(n) { style.alignment = mapped }
                    continue
                }
                guard leading else { continue }
                if let n = number(t, prefix: "b") { style.bold = n != 0; continue }
                if let n = number(t, prefix: "i") { style.italic = n != 0; continue }
                if t.range(of: #"^fs\d+(\.\d+)?$"#, options: .regularExpression) != nil, let size = Double(t.dropFirst(2)), size > 0 {
                    style.scale = size / playResY
                    continue
                }
                if t.hasPrefix("1c") || (t.hasPrefix("c") && !t.hasPrefix("clip")), let c = colour(String(t.drop(while: { $0 != "&" }))) {
                    style.colour = c
                }
            }
            rest = rest[rest.index(after: close)...]
        }
        visible += rest
        return visible
            .replacingOccurrences(of: "\\N", with: "\n").replacingOccurrences(of: "\\n", with: "\n").replacingOccurrences(of: "\\h", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// "b1", "i0", "an8": the whole number after a tag name, nil when anything else follows.
    private static func number(_ tag: String, prefix: String) -> Int? {
        guard tag.hasPrefix(prefix) else { return nil }
        return Int(tag.dropFirst(prefix.count))
    }

    /// "&H00FFFFFF", "&HFF&", "&H0000FF" or SSA's decimal "16777215", as 0xRRGGBB (alpha dropped).
    /// ASS stores blue first: `&HBBGGRR`.
    static func colour(_ raw: String) -> UInt32? {
        let s = raw.trimmingCharacters(in: .whitespaces).uppercased()
        let value: UInt32?
        if s.hasPrefix("&") {
            value = UInt32(s.replacingOccurrences(of: "&H", with: "").replacingOccurrences(of: "&", with: ""), radix: 16)
        } else {
            value = UInt32(s)
        }
        guard let v = value else { return nil }
        let r = v & 0xFF, g = (v >> 8) & 0xFF, b = (v >> 16) & 0xFF
        return r << 16 | g << 8 | b
    }

    /// SSA's alignment (1-3 bottom, 5-7 top, 9-11 middle; left, centre, right) as the numpad layout.
    static func ssaAlignment(_ a: Int) -> Int? {
        switch a {
        case 1...3: return a
        case 5...7: return a + 2
        case 9...11: return a - 5
        default: return nil
        }
    }

    /// "0:01:02.34" (centiseconds).
    static func timestamp(_ raw: String) -> Double? {
        let parts = raw.trimmingCharacters(in: .whitespaces).split(separator: ":")
        guard parts.count == 3, let h = Double(parts[0]), let m = Double(parts[1]), let s = Double(parts[2]) else { return nil }
        return h * 3600 + m * 60 + s
    }
}
