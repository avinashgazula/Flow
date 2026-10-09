import Foundation

/// What Flow shares with its widgets and the Apple TV Top Shelf: a small, self-contained list
/// of titles with artwork URLs and deep links. Written by the app, read by the extensions.
struct FlowSnapshot: Codable {
    struct Item: Codable, Hashable, Identifiable {
        var id: String
        var title: String
        var subtitle: String
        /// 0...1 for something in progress; nil for Up Next or watchlist titles.
        var progress: Double?
        /// Landscape artwork (backdrop or episode still).
        var imageURL: URL?
        var posterURL: URL?
        /// Opens the title's page.
        var link: URL
        /// Starts playback straight away.
        var playLink: URL?
    }

    var continueWatching: [Item]
    var watchlist: [Item]
    var updatedAt: Date

    /// `group.<bundle id>`, set in each target's Info.plist so the app and extensions agree.
    static var appGroup: String? { Bundle.main.object(forInfoDictionaryKey: "FlowAppGroup") as? String }

    static var fileURL: URL? {
        guard let group = appGroup, !group.isEmpty,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
        return container.appendingPathComponent("snapshot.json")
    }

    static func load() -> FlowSnapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(FlowSnapshot.self, from: data)
    }

    func save() {
        guard let url = Self.fileURL else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try? encoder.encode(self).write(to: url, options: .atomic)
    }
}
