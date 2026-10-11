import XCTest
@testable import FlowKit

final class XRayTests: XCTestCase {
    private let cast = [
        CastMember(id: 1, name: "Bryan Cranston", role: "Walter White", order: 0),
        CastMember(id: 2, name: "Anna Gunn", role: "Skyler White", order: 1),
        CastMember(id: 3, name: "Aaron Paul", role: "Jesse Pinkman", order: 2),
        CastMember(id: 4, name: "Dean Norris", role: "Hank Schrader", order: 3),
        CastMember(id: 5, name: "Jonathan Banks", role: "Mike Ehrmantraut", order: 4),
        CastMember(id: 6, name: "Extra", role: "Police Officer #2", order: 5),
        CastMember(id: 7, name: "Someone", role: "Himself", order: 6),
    ]

    func testFirstNamesAndPossessivesMatch() {
        let found = XRay.mentioned(in: ["Jesse, get in the car.", "Hank's on his way."], cast: cast)
        XCTAssertEqual(Set(found.map(\.id)), [3, 4])
    }

    func testSharedSurnameAloneMatchesNobody() {
        XCTAssertTrue(XRay.mentioned(in: ["Mr. White, yo!"], cast: cast).isEmpty)
    }

    func testFullNameDisambiguates() {
        let found = XRay.mentioned(in: ["My name is Walter White."], cast: cast)
        XCTAssertEqual(found.map(\.id), [1])
    }

    func testSpeakerLabelsInCapitals() {
        let found = XRay.mentioned(in: ["MIKE: No more half measures."], cast: cast)
        XCTAssertEqual(found.map(\.id), [5])
    }

    func testMostMentionedFirst() {
        let found = XRay.mentioned(in: ["Hank?", "Jesse, Jesse, listen.", "Jesse!"], cast: cast)
        XCTAssertEqual(found.map(\.id), [3, 4])
    }

    func testLowercaseWordsAndGenericCreditsIgnored() {
        // "police" in dialogue, a generic "Police Officer" credit, and "himself" never match.
        XCTAssertTrue(XRay.mentioned(in: ["Call the police, the officer said so himself."], cast: cast).isEmpty)
    }

    func testEverydayWordNamesNeedMidSentenceCapital() {
        let strangerThings = [CastMember(id: 10, name: "Noah Schnapp", role: "Will Byers", order: 0)]
        XCTAssertTrue(XRay.mentioned(in: ["Will you stop that?"], cast: strangerThings).isEmpty)
        XCTAssertEqual(XRay.mentioned(in: ["Where is Will?"], cast: strangerThings).map(\.id), [10])
    }

    func testAliasesAndVoiceNotes() {
        let members = [CastMember(id: 20, name: "Bryan Cranston", role: "Walter White / Heisenberg (voice)", order: 0)]
        XCTAssertEqual(XRay.mentioned(in: ["They call him Heisenberg."], cast: members).map(\.id), [20])
    }

    func testLinesInWindowRespectOffset() {
        let doc = SubtitleDocument(cues: [
            SubtitleCue(index: 0, start: 10, end: 12, text: "a"),
            SubtitleCue(index: 1, start: 50, end: 52, text: "b"),
            SubtitleCue(index: 2, start: 100, end: 102, text: "c"),
        ])
        XCTAssertEqual(doc.lines(from: 40, to: 100), ["b", "c"])
        // Subtitles delayed by 5 s: playback time 55 shows the cue that starts at 50.
        XCTAssertEqual(doc.lines(from: 0, to: 54, offset: 5), ["a"])
        XCTAssertEqual(doc.lines(from: 0, to: 55, offset: 5), ["a", "b"])
    }
}
