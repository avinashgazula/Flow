import Foundation

/// Times in the payload: ISO 8601 in UTC to the second, as docs/SYNC.md shows them. Whole seconds keep
/// them sortable as text on the website; reading accepts fractions too.
public enum FlowSyncTime {
    private static let lock = NSLock()
    nonisolated(unsafe) private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    public static func string(_ date: Date) -> String {
        lock.lock(); defer { lock.unlock() }
        return formatter.string(from: date)
    }

    public static func date(_ text: String) -> Date? { FlowDate.parse(text) }
}

/// One section of the payload: `{"updatedAt", "device", "data"}`, plus whatever else a newer app put there.
/// The fields are kept as received so a section this app didn't change goes back up untouched.
public struct FlowSyncSection: Equatable, Sendable {
    public var fields: [String: JSONValue]

    public init(fields: [String: JSONValue]) { self.fields = fields }

    public init(updatedAt: Date, device: String?, data: JSONValue) {
        fields = ["updatedAt": .string(FlowSyncTime.string(updatedAt)), "data": data]
        if let device { fields["device"] = .string(device) }
    }

    public var updatedAtText: String? { fields["updatedAt"]?.string }
    /// A section with no readable time counts as the oldest there is, so any real change replaces it.
    public var updatedAt: Date { updatedAtText.flatMap(FlowSyncTime.date) ?? .distantPast }
    public var device: String? { fields["device"]?.string }
    public var data: JSONValue {
        get { fields["data"] ?? .null }
        set { fields["data"] = newValue }
    }
}

/// The decrypted blob: `{"v": 1, "sections": {...}}`. Sections and fields this version doesn't know are kept.
public struct FlowSyncPayload: Equatable, Sendable {
    public var version: Int
    public var sections: [String: FlowSyncSection]
    /// Top-level keys other than `v` and `sections`.
    public var extra: [String: JSONValue]

    public init(version: Int = 1, sections: [String: FlowSyncSection] = [:], extra: [String: JSONValue] = [:]) {
        self.version = version
        self.sections = sections
        self.extra = extra
    }

    public init(json: JSONValue) throws {
        guard case .object(var object) = json else { throw FlowSyncError.unreadable }
        version = object.removeValue(forKey: "v")?.int ?? 1
        var sections: [String: FlowSyncSection] = [:]
        if case .object(let raw)? = object.removeValue(forKey: "sections") {
            for (name, value) in raw {
                if case .object(let fields) = value { sections[name] = FlowSyncSection(fields: fields) }
            }
        }
        self.sections = sections
        extra = object
    }

    public var json: JSONValue {
        var object = extra
        object["v"] = .number(Double(version))
        object["sections"] = .object(sections.mapValues { .object($0.fields) })
        return .object(object)
    }

    public init(plaintext: Data) throws {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: plaintext) else { throw FlowSyncError.unreadable }
        try self.init(json: value)
    }

    /// The plaintext that gets encrypted: sorted keys, so the same payload always has the same bytes (and hash).
    public func plaintext() throws -> Data { try FlowSyncJSON.canonical(json) }
}

public enum FlowSyncJSON {
    public static func canonical(_ value: JSONValue) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    public static func hash(_ value: JSONValue) -> String {
        guard let data = try? canonical(value) else { return "" }
        return FlowSyncKDF.sha256Hex(data)
    }

    public static func object(_ pairs: KeyValuePairs<String, JSONValue>) -> JSONValue {
        var out: [String: JSONValue] = [:]
        for (key, value) in pairs { out[key] = value }
        return .object(out)
    }

    public static func optional(_ string: String?) -> JSONValue {
        guard let string, !string.isEmpty else { return .null }
        return .string(string)
    }
}
