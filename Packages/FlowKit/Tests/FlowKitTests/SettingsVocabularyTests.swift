import XCTest
@testable import FlowKit

/// Every choice the Settings screens list has words to show and an identifier that is its own.
/// A new case added without a title would show a blank row; this catches it.
final class SettingsVocabularyTests: XCTestCase {
    private func check<T: CaseIterable & Identifiable & RawRepresentable>(_ type: T.Type, _ title: KeyPath<T, String>, file: StaticString = #filePath, line: UInt = #line) where T.ID: Hashable {
        let all = Array(T.allCases)
        XCTAssertFalse(all.isEmpty, "\(T.self) has cases", file: file, line: line)
        XCTAssertEqual(Set(all.map(\.id)).count, all.count, "\(T.self): identifiers are unique", file: file, line: line)
        for c in all {
            let text = c[keyPath: title]
            XCTAssertFalse(text.trimmingCharacters(in: .whitespaces).isEmpty, "\(T.self).\(c) has a title", file: file, line: line)
        }
        XCTAssertEqual(Set(all.map { $0[keyPath: title] }).count, all.count, "\(T.self): two choices can't read the same", file: file, line: line)
    }

    func testEveryChoiceHasAUniqueTitle() {
        check(AppTab.self, \.title)
        check(HeroSource.self, \.title)
        check(HeroStyle.self, \.title)
        check(AppearanceChoice.self, \.title)
        check(AppIconChoice.self, \.title)
        check(FilmDateKind.self, \.title)
        check(DetailTextSize.self, \.title)
        check(TrackerKind.self, \.displayName)
        check(ListDestination.self, \.displayName)
        check(SyncInterval.self, \.title)
        check(DiscoverSort.self, \.title)
        check(MediaServerKind.self, \.displayName)
        check(IPTVProviderKind.self, \.displayName)
        check(SourceSortKey.self, \.title)
        check(SourceTitleDisplay.self, \.title)
        check(SkipBehaviour.self, \.title)
        check(ExternalPlayer.self, \.title)
        check(MatroskaPlayback.self, \.title)
        check(PlayerEngine.self, \.title)
        check(SubtitleFont.self, \.title)
        check(SubtitleWeight.self, \.title)
        check(SubtitleEdgeStyle.self, \.title)
        check(AutoSubtitleMode.self, \.title)
        check(SubtitleTypePreference.self, \.title)
        check(AnimeAudio.self, \.title)
        check(EpisodeSource.self, \.title)
        check(PrimaryMetadataSource.self, \.title)
        check(RatingSource.self, \.title)
        check(PosterEnhancement.self, \.title)
        check(DownloadLocation.self, \.title)
    }

    func testTabsAndTrackersHaveSymbolsAndBlurbs() {
        for tab in AppTab.allCases { XCTAssertFalse(tab.systemImage.isEmpty, "\(tab)") }
        for tracker in TrackerKind.allCases { XCTAssertTrue(tracker.blurb.hasSuffix("."), "\(tracker) blurb is a sentence") }
    }

    func testSyncIntervalsAreOrderedByLength() {
        let raw = SyncInterval.allCases.map(\.rawValue)
        XCTAssertEqual(raw, raw.sorted(), "the picker lists shortest first")
    }
}
