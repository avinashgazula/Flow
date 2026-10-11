import XCTest
@testable import FlowKit

final class ServerHomeRowTests: XCTestCase {
    private func settings(rowsOn: Bool) -> MediaServerSettings {
        var s = MediaServerSettings()
        s.servers = [
            MediaServerConfig(id: "a", kind: .jellyfin, name: "Jellyfin", baseURL: URL(string: "http://a")!),
            MediaServerConfig(id: "b", kind: .plex, name: "Plex", baseURL: URL(string: "http://b")!),
        ]
        s.serverHomeRows = rowsOn
        return s
    }

    func testOldSwitchBecomesEveryServer() {
        var s = settings(rowsOn: true)
        s.migrateHomeRows()
        XCTAssertEqual(s.serverHomeRowIDs, ["a", "b"])
        XCTAssertFalse(s.serverHomeRows)
        s.setHomeRow(false, for: "a")
        s.migrateHomeRows()
        XCTAssertEqual(s.homeRowServers.map(\.name), ["Plex"], "turning one off sticks")
    }

    func testMigrationKeepsAnExistingListAndWaitsForServers() {
        var chosen = settings(rowsOn: true)
        chosen.serverHomeRowIDs = ["b"]
        chosen.migrateHomeRows()
        XCTAssertEqual(chosen.serverHomeRowIDs, ["b"])

        var noServers = MediaServerSettings()
        noServers.serverHomeRows = true
        noServers.migrateHomeRows()
        XCTAssertTrue(noServers.serverHomeRows, "kept until servers arrive, e.g. from iCloud")
    }

    func testOldStoredJSONDecodes() throws {
        let json = Data("{\"mediaServers\":{\"serverHomeRows\":true}}".utf8)
        let decoded = try SettingsCodec.decode(AppSettings.self, from: json, defaults: AppSettings())
        XCTAssertTrue(decoded.mediaServers.serverHomeRows)
        XCTAssertEqual(decoded.mediaServers.serverHomeRowIDs, [])
    }
}
