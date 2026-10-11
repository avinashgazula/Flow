import XCTest
@testable import FlowKit

final class CloudSyncStatusTests: XCTestCase {
    private func library(progress count: Int) -> LocalLibrary {
        var library = LocalLibrary()
        library.progress = (0..<count).map { PlaybackProgress(key: MediaKey(type: .movie, tmdbID: $0 + 1), percent: 10) }
        return library
    }

    func testPushedStateAgrees() throws {
        let cloud = CloudSync(store: InMemoryKeyValueStore())
        let settings = AppSettings()
        let local = library(progress: 2)
        try cloud.push(settings: settings, library: local, includeLibrary: false)
        let status = cloud.syncStatus(settings: settings, library: local)
        XCTAssertEqual(status.rows.map(\.domain), CloudDomain.visible)
        XCTAssertTrue(status.rows.allSatisfy { $0.health == .synced })
        XCTAssertEqual(status.rows.first { $0.domain == .playbackProgress }?.localCount, 2)
        XCTAssertEqual(status.rows.first { $0.domain == .playbackProgress }?.cloudCount, 2)
        XCTAssertEqual(status.health, .synced)
    }

    func testDisagreementWarnsAndWriteFailureTurnsItRed() throws {
        let cloud = CloudSync(store: InMemoryKeyValueStore())
        let settings = AppSettings()
        try cloud.push(settings: settings, library: library(progress: 1), includeLibrary: false)
        let local = library(progress: 3)
        let warning = cloud.syncStatus(settings: settings, library: local)
        XCTAssertEqual(warning.rows.first { $0.domain == .playbackProgress }?.health, .warning)
        XCTAssertEqual(warning.rows.first { $0.domain == .rewatches }?.health, .synced)
        let failed = cloud.syncStatus(settings: settings, library: local, writeFailed: true)
        XCTAssertEqual(failed.rows.first { $0.domain == .playbackProgress }?.health, .failed)
        XCTAssertEqual(failed.health, .failed)
    }

    func testNothingInCloudAndNothingLocalAgree() {
        var empty = AppSettings()
        empty.shelves = []
        let cloud = CloudSync(store: InMemoryKeyValueStore())
        let status = cloud.syncStatus(settings: empty, library: LocalLibrary())
        XCTAssertTrue(status.rows.allSatisfy { $0.health == .synced })
        XCTAssertTrue(status.rows.allSatisfy { $0.cloudCount == nil })
        // Shelves that were never uploaded do disagree.
        XCTAssertEqual(cloud.syncStatus(settings: AppSettings(), library: LocalLibrary()).rows.first { $0.domain == .shelves }?.health, .warning)
    }

    func testLongProgressListIsComparedAtTheUploadLimit() throws {
        let cloud = CloudSync(store: InMemoryKeyValueStore())
        let local = library(progress: CloudSync.progressLimit + 20)
        try cloud.push(settings: AppSettings(), library: local, includeLibrary: false)
        let status = cloud.syncStatus(settings: AppSettings(), library: local)
        XCTAssertEqual(status.rows.first { $0.domain == .playbackProgress }?.health, .synced)
    }

    func testStorageCountsEveryKeyAndWarnsPastEightyPercent() {
        let store = InMemoryKeyValueStore()
        let cloud = CloudSync(store: store)
        store.set(Data(count: 1000), forKey: "other.key")
        XCTAssertEqual(cloud.storeBytes, 1000 + "other.key".utf8.count)
        XCTAssertEqual(cloud.syncStatus(settings: AppSettings(), library: LocalLibrary()).storageHealth, .synced)

        store.set(Data(count: Int(Double(CloudSync.quotaBytes) * 0.85)), forKey: "big")
        let warn = cloud.syncStatus(settings: AppSettings(), library: LocalLibrary())
        XCTAssertEqual(warn.storageHealth, .warning)
        XCTAssertEqual(warn.health, .warning)

        store.set(Data(count: CloudSync.quotaBytes), forKey: "big")
        XCTAssertEqual(cloud.syncStatus(settings: AppSettings(), library: LocalLibrary()).storageHealth, .failed)
    }
}
