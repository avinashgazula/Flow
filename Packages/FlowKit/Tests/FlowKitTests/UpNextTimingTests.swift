import XCTest
@testable import FlowKit

final class UpNextTimingTests: XCTestCase {
    private func input(auto: Bool = true, next: Bool = true, sleep: Bool = false, switching: Bool = false, running: Bool = false, duration: Double = 2700,
                       time: Double, credits: Double? = nil, waits: Bool = false, seconds: Int = 10) -> UpNextTiming.CountdownInput {
        .init(autoPlayNext: auto, hasUpNext: next, sleepEndsWithItem: sleep, switchingEpisode: switching, countdownRunning: running,
              duration: duration, currentTime: time, creditsStart: credits, waitsForEnd: waits, countdownSeconds: seconds)
    }

    func testCountdownStartTable() {
        // No credits segment: finish 20 seconds before the end, so it starts countdown + 20 seconds out.
        XCTAssertEqual(UpNextTiming.countdownStart(duration: 2700, creditsStart: nil, waitsForEnd: false, countdownSeconds: 10), 2670)
        XCTAssertEqual(UpNextTiming.countdownStart(duration: 2700, creditsStart: nil, waitsForEnd: false, countdownSeconds: 30), 2650)
        // A credits segment starts it as the credits begin.
        XCTAssertEqual(UpNextTiming.countdownStart(duration: 2700, creditsStart: 2500, waitsForEnd: false, countdownSeconds: 10), 2500)
        // A viewer who would rather see the credits: it ends one second before the episode does, and the segment is ignored.
        XCTAssertEqual(UpNextTiming.countdownStart(duration: 2700, creditsStart: 2500, waitsForEnd: true, countdownSeconds: 10), 2689)
        XCTAssertEqual(UpNextTiming.countdownStart(duration: 2700, creditsStart: nil, waitsForEnd: true, countdownSeconds: 5), 2694)
        XCTAssertEqual(UpNextTiming.countdownStart(duration: 2700, creditsStart: 2500, waitsForEnd: false, countdownSeconds: 0), 2500)
    }

    func testCountdownStartsAtTheThresholdNotBefore() {
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(time: 2669.9)))
        XCTAssertTrue(UpNextTiming.shouldStartCountdown(input(time: 2670)))
        XCTAssertTrue(UpNextTiming.shouldStartCountdown(input(time: 2700)))
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(time: 2499, credits: 2500)))
        XCTAssertTrue(UpNextTiming.shouldStartCountdown(input(time: 2500, credits: 2500)))
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(time: 2600, credits: 2500, waits: true)), "waiting for the end ignores the credits")
        XCTAssertTrue(UpNextTiming.shouldStartCountdown(input(time: 2689, credits: 2500, waits: true)))
    }

    func testCountdownNeedsEveryPrecondition() {
        let time = 2690.0
        XCTAssertTrue(UpNextTiming.shouldStartCountdown(input(time: time)))
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(auto: false, time: time)), "auto-play off")
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(next: false, time: time)), "no next episode")
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(sleep: true, time: time)), "sleep timer ends with this episode")
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(switching: true, time: time)), "already switching")
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(running: true, time: time)), "already counting down")
    }

    func testVeryShortFilesGetNoCountdown() {
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(duration: 60, time: 59)), "exactly a minute is not an episode")
        XCTAssertTrue(UpNextTiming.shouldStartCountdown(input(duration: 61, time: 61)))
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(duration: 0, time: 100)))
    }

    func testAShortEpisodeCountdownStartsImmediately() {
        // A 90-second clip with a 10 s countdown and 20 s tail: threshold 60 s, so it begins at 60 s in.
        XCTAssertFalse(UpNextTiming.shouldStartCountdown(input(duration: 90, time: 59)))
        XCTAssertTrue(UpNextTiming.shouldStartCountdown(input(duration: 90, time: 60)))
        // Pinned: a long countdown on a short file puts the threshold before the start, so it begins on the first tick.
        XCTAssertTrue(UpNextTiming.shouldStartCountdown(input(duration: 70, time: 0, seconds: 60)))
    }

    // MARK: Credits notice

    func testCreditsNoticeTable() {
        func due(shown: Bool = false, notice: Bool = true, duration: Double = 7200, segment: Double? = nil, time: Double) -> Bool {
            UpNextTiming.creditsNoticeIsDue(alreadyShown: shown, hasNotice: notice, duration: duration, creditsSegmentStart: segment, time: time)
        }
        XCTAssertFalse(due(time: 6767), "before 94 percent")
        XCTAssertTrue(due(time: 6768), "94 percent of 7200")
        XCTAssertTrue(due(time: 7189))
        XCTAssertFalse(due(time: 7190), "the last ten seconds are too late to stay")
        XCTAssertFalse(due(shown: true, time: 7000))
        XCTAssertFalse(due(notice: false, time: 7000))
        XCTAssertFalse(due(duration: 1800, time: 1750), "half an hour is not a film")
        XCTAssertTrue(due(duration: 1801, time: 1700))
        XCTAssertFalse(due(segment: 7000, time: 6999))
        XCTAssertTrue(due(segment: 7000, time: 7000), "a credits segment replaces the 94 percent guess")
        XCTAssertTrue(due(segment: 100, time: 200), "a segment early in the film still triggers once time is past it")
    }

    // MARK: Suggestions

    func testSuggestionsTable() {
        func action(has: Bool = true, scene: Bool = false, duration: Double = 7200, playing: Bool = true, segment: Double? = nil, time: Double, offered: Bool = false) -> UpNextTiming.SuggestionsAction {
            UpNextTiming.suggestionsAction(hasSuggestions: has, hasCreditsScene: scene, duration: duration, isPlaying: playing, creditsSegmentStart: segment, time: time, alreadyOffered: offered)
        }
        // Two hours: the later of 96 percent (6912) and three minutes from the end (7020) is when the credits are taken to begin.
        XCTAssertEqual(action(time: 7019), .withdraw)
        XCTAssertEqual(action(time: 7020), .show)
        XCTAssertEqual(action(time: 7194), .show)
        XCTAssertEqual(action(time: 7195), .none, "the last five seconds")
        XCTAssertEqual(action(time: 7100, offered: true), .none, "only offered once")
        XCTAssertEqual(action(time: 100, offered: true), .withdraw, "seeking back withdraws it even when offered")
        XCTAssertEqual(action(time: 100), .withdraw)
        XCTAssertEqual(action(has: false, time: 7100), .none)
        XCTAssertEqual(action(scene: true, time: 7100), .none, "a scene to stay for beats suggestions")
        XCTAssertEqual(action(duration: 1800, time: 1790), .none)
        XCTAssertEqual(action(playing: false, time: 7100), .none, "only while playing")
        XCTAssertEqual(action(segment: 6000, time: 6000), .show)
        XCTAssertEqual(action(segment: 6000, time: 5999), .withdraw)
        // Five hours: 96 percent is 17280 and three minutes from the end is 17820; the later one still wins.
        XCTAssertEqual(action(duration: 18000, time: 17819), .withdraw)
        XCTAssertEqual(action(duration: 18000, time: 17820), .show)
        // A short film (35 minutes, 2100 s): 96 percent is 2016, three minutes from the end is 1920, so 2016 is later.
        XCTAssertEqual(action(duration: 2100, time: 2015), .withdraw)
        XCTAssertEqual(action(duration: 2100, time: 2016), .show)
    }

    // MARK: Skip buttons

    func testSkipBehaviourPerKind() {
        func b(_ kind: SkipSegmentKind, _ intro: SkipBehaviour, _ recap: SkipBehaviour, _ credits: SkipBehaviour, scene: Bool = false) -> SkipBehaviour {
            UpNextTiming.skipBehaviour(kind: kind, intro: intro, recap: recap, credits: credits, creditsHideAScene: scene)
        }
        XCTAssertEqual(b(.intro, .automatic, .off, .button), .automatic)
        XCTAssertEqual(b(.recap, .automatic, .off, .button), .off)
        XCTAssertEqual(b(.credits, .automatic, .off, .button), .button)
        XCTAssertEqual(b(.credits, .off, .off, .automatic), .automatic)
        XCTAssertEqual(b(.credits, .off, .off, .automatic, scene: true), .button, "credits hiding a scene are never skipped by themselves")
        XCTAssertEqual(b(.credits, .off, .off, .off, scene: true), .off)
        XCTAssertEqual(b(.credits, .off, .off, .button, scene: true), .button)
        XCTAssertEqual(b(.preview, .button, .off, .off), .button, "previews follow the intro setting")
        XCTAssertEqual(b(.commercial, .automatic, .off, .off), .automatic, "so do commercials")
    }

    func testSkippingEndCreditsStartsTheNextEpisode() {
        func starts(_ kind: SkipSegmentKind = .credits, next: Bool = true, sleep: Bool = false, end: Double = 2700, duration: Double = 2700) -> Bool {
            UpNextTiming.skipStartsNextEpisode(kind: kind, hasUpNext: next, sleepEndsWithItem: sleep, segmentEnd: end, duration: duration)
        }
        XCTAssertTrue(starts())
        XCTAssertTrue(starts(end: 2695), "within five seconds of the end counts as the end")
        XCTAssertFalse(starts(end: 2694), "mid-episode credits (a post-credit scene follows) just seek")
        XCTAssertFalse(starts(.intro))
        XCTAssertFalse(starts(.recap))
        XCTAssertFalse(starts(next: false))
        XCTAssertFalse(starts(sleep: true))
    }
}
