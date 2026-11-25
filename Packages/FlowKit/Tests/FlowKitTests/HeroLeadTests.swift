import XCTest
@testable import FlowKit

final class HeroLeadTests: XCTestCase {
    func testAPhoneTakesAboutTwoThirdsOfTheWindowAndNeverLessThanTheWordsNeed() {
        XCTAssertEqual(HeroLead.shape(width: 390, isTV: false), .phone)
        XCTAssertEqual(HeroLead.height(shape: .phone, width: 390, viewport: 844), 844 * 0.68, accuracy: 0.001)
        XCTAssertEqual(HeroLead.height(shape: .phone, width: 320, viewport: 300), 320, "a tiny window still has room for the logo and the buttons")
    }

    func testAWidePictureIsSixteenByNineCappedAtThreeQuartersOfTheWindow() {
        XCTAssertEqual(HeroLead.shape(width: 1024, isTV: false), .wide)
        XCTAssertEqual(HeroLead.shape(width: 744, isTV: false), .wide, "an iPad held upright is wide")
        XCTAssertEqual(HeroLead.height(shape: .wide, width: 1440, viewport: 900), 675, accuracy: 0.001)
        XCTAssertEqual(HeroLead.height(shape: .wide, width: 800, viewport: 1200), 450, accuracy: 0.001, "16:9 when the window is tall enough")
        XCTAssertEqual(HeroLead.height(shape: .wide, width: 932, viewport: 430), 322.5, accuracy: 0.001, "a phone on its side")
        XCTAssertEqual(HeroLead.height(shape: .wide, width: 700, viewport: 200), 280)
    }

    func testAppleTVTakesNearlyTheWholeScreen() {
        XCTAssertEqual(HeroLead.shape(width: 1920, isTV: true), .tv)
        XCTAssertEqual(HeroLead.height(shape: .tv, width: 1920, viewport: 1080), 1080 * 0.82, accuracy: 0.001)
    }

    func testSomethingStartedSaysWhereYouAreAndHowLongIsLeft() {
        let facts = HeroLead.facts(kind: .resume, episode: EpisodeRef(season: 3, episode: 7), year: 2008, genres: ["Drama"], certification: "TV-MA", minutesLeft: 18)
        XCTAssertEqual(facts, ["S3 E7", "18m left"])
        XCTAssertEqual(HeroLead.line(facts), "S3 E7 · 18m left")
        XCTAssertEqual(HeroLead.facts(kind: .resume, episode: nil, year: 2024, genres: [], certification: nil, minutesLeft: 105), ["2024", "1h45 left"])
        XCTAssertEqual(HeroLead.facts(kind: .resume, episode: nil, year: nil, genres: [], certification: nil, minutesLeft: nil), [])
    }

    func testTheNextEpisodeSaysSo() {
        XCTAssertEqual(HeroLead.facts(kind: .nextUp, episode: EpisodeRef(season: 2, episode: 4), year: nil, genres: [], certification: nil, minutesLeft: 50), ["S2 E4", "Up next"])
    }

    func testATitleNotStartedSaysWhatItIs() {
        XCTAssertEqual(HeroLead.line(HeroLead.facts(kind: .pick, episode: nil, year: 2008, genres: ["Drama", "Crime"], certification: "TV-MA", minutesLeft: nil)), "Drama · 2008 · TV-MA")
    }

    func testWhatItDoesNotKnowIsLeftOutSoTheLineHasNoGaps() {
        XCTAssertEqual(HeroLead.facts(kind: .pick, episode: nil, year: nil, genres: [], certification: "PG-13", minutesLeft: nil), ["PG-13"])
        XCTAssertEqual(HeroLead.facts(kind: .pick, episode: nil, year: 2024, genres: [""], certification: "", minutesLeft: nil), ["2024"])
        XCTAssertEqual(HeroLead.line([]), "")
    }

    func testStepsGoRoundInBothDirections() {
        XCTAssertEqual(HeroLead.wrapped(0, by: 1, count: 10), 1)
        XCTAssertEqual(HeroLead.wrapped(9, by: 1, count: 10), 0)
        XCTAssertEqual(HeroLead.wrapped(0, by: -1, count: 10), 9)
        XCTAssertEqual(HeroLead.wrapped(3, by: 12, count: 10), 5)
        XCTAssertEqual(HeroLead.wrapped(0, by: 1, count: 0), 0)
    }

    func testALongSwipeTurnsTheNextTitleInFromTheRight() {
        XCTAssertEqual(HeroLead.swipe(translation: -120, velocity: 0, width: 390), 1)
        XCTAssertEqual(HeroLead.swipe(translation: 120, velocity: 0, width: 390), -1)
    }

    func testAShortSlowDragSettlesBack() {
        XCTAssertEqual(HeroLead.swipe(translation: -40, velocity: -100, width: 390), 0)
        XCTAssertEqual(HeroLead.swipe(translation: 0, velocity: 0, width: 390), 0)
        XCTAssertEqual(HeroLead.swipe(translation: -40, velocity: 0, width: 0), 0)
    }

    func testAQuickFlickTurnsButNotOneThatGoesTheOtherWayFromTheDrag() {
        XCTAssertEqual(HeroLead.swipe(translation: -30, velocity: -900, width: 390), 1)
        XCTAssertEqual(HeroLead.swipe(translation: -30, velocity: 900, width: 390), 0)
    }
}

final class LogoToneTests: XCTestCase {
    private func pixels(_ p: [[UInt8]]) -> [UInt8] { p.flatMap { $0 } }

    func testWhiteLetteringIsLightWhateverSurroundsIt() {
        XCTAssertEqual(LogoTone.of(rgba: pixels([[255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 0], [0, 0, 0, 0]])), .light)
    }

    func testBlackLetteringIsDark() {
        XCTAssertEqual(LogoTone.of(rgba: pixels([[10, 10, 10, 255], [0, 0, 0, 255], [255, 255, 255, 0]])), .dark)
    }

    func testAColourInTheMiddleIsNeitherSoItIsLeftAlone() {
        XCTAssertEqual(LogoTone.of(rgba: pixels([[90, 110, 60, 255], [90, 110, 60, 255]])), .mid)
    }

    func testWhiteLetteringOnColouredTilesIsLeftAloneSoTheColoursStay() {
        // Flipped, green tiles came out pale mint behind black letters.
        XCTAssertEqual(LogoTone.of(rgba: pixels([[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [30, 120, 50, 255], [30, 120, 50, 255]])), .mid)
    }

    func testASmallColouredAccentOnWhiteLetteringIsStillLight() {
        let white: [UInt8] = [255, 255, 255, 255]
        XCTAssertEqual(LogoTone.of(rgba: pixels(Array(repeating: white, count: 9) + [[220, 30, 30, 255]])), .light)
    }

    func testAFaintWhiteHaloRoundBlackLetteringDoesNotMakeItLight() {
        XCTAssertEqual(LogoTone.of(rgba: pixels([[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 40]])), .dark)
    }

    func testAnEmptyImageHasNothingToSay() {
        XCTAssertEqual(LogoTone.of(rgba: [255, 255, 255, 0]), .mid)
        XCTAssertEqual(LogoTone.of(rgba: []), .mid)
    }

    func testOnlyALogoThatWouldVanishIsFlipped() {
        XCTAssertTrue(LogoTone.light.flips(onDarkPage: false))
        XCTAssertFalse(LogoTone.light.flips(onDarkPage: true))
        XCTAssertTrue(LogoTone.dark.flips(onDarkPage: true))
        XCTAssertFalse(LogoTone.dark.flips(onDarkPage: false))
        XCTAssertFalse(LogoTone.mid.flips(onDarkPage: false))
        XCTAssertFalse(LogoTone.mid.flips(onDarkPage: true))
    }
}

final class HeroLeadSlidesTests: XCTestCase {
    func testTheLeadIsTheTopPicksAloneWhateverIsInProgress() {
        let slides = HeroLead.slides(picks: [1, 2, 3], key: { MediaKey(type: .movie, tmdbID: $0) },
                                     started: [MediaKey(type: .movie, tmdbID: 99): "elsewhere"])
        XCTAssertEqual(slides.map(\.pick), [1, 2, 3], "a title in progress that is not a pick is not added")
        XCTAssertTrue(slides.allSatisfy { $0.started == nil })
    }

    func testAPickThatWasStartedKeepsItsResumePoint() {
        let slides = HeroLead.slides(picks: [1, 2], key: { MediaKey(type: .show, tmdbID: $0) },
                                     started: [MediaKey(type: .show, tmdbID: 2): "S3 E7"])
        XCTAssertNil(slides[0].started)
        XCTAssertEqual(slides[1].started, "S3 E7")
    }
}
