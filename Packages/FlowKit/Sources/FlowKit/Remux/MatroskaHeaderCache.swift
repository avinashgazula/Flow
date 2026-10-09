import Foundation

/// Remembers parsed Matroska headers (tracks, seek index, chapters) by file identity, so reopening
/// a file skips downloading its index. Debrid links change on every request, so the key is the
/// file itself: its length and a hash of its first bytes.
public actor MatroskaHeaderCache {
    public static let shared = MatroskaHeaderCache(directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("FlowMatroskaHeaders", isDirectory: true))

    private let directory: URL
    private let limit: Int
    private var memory: [String: MatroskaHeader] = [:]

    public init(directory: URL, limit: Int = 150) {
        self.directory = directory
        self.limit = limit
    }

    /// FNV-1a over the first 64 KB, plus the length.
    public static func key(head: [UInt8], length: Int64?) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in head.prefix(64 * 1024) {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        return String(hash, radix: 16) + "-" + String(length ?? 0)
    }

    public func header(for key: String) -> MatroskaHeader? {
        if let hit = memory[key] { return hit }
        let url = directory.appendingPathComponent(key + ".json")
        guard let data = try? Data(contentsOf: url), let header = try? JSONDecoder().decode(MatroskaHeader.self, from: data) else { return nil }
        memory[key] = header
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return header
    }

    public func store(_ header: MatroskaHeader, for key: String) {
        memory[key] = header
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(header) else { return }
        try? data.write(to: directory.appendingPathComponent(key + ".json"), options: .atomic)
        prune()
    }

    /// Keeps the most recently used files.
    private func prune() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]),
              files.count > limit else { return }
        let dated = files.map { ($0, (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
        for (url, _) in dated.sorted(by: { $0.1 > $1.1 }).dropFirst(limit) { try? FileManager.default.removeItem(at: url) }
    }
}
