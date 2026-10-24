import XCTest
@testable import FlowKit

final class SubtitleStyleOptionsTests: XCTestCase {
    func testSizeSnapsToTheNearestStep() {
        XCTAssertEqual(SubtitleStyleOptions.nearestSize(1), 1)
        XCTAssertEqual(SubtitleStyleOptions.nearestSize(1.1), 1)
        XCTAssertEqual(SubtitleStyleOptions.nearestSize(1.2), 1.25)
        XCTAssertEqual(SubtitleStyleOptions.nearestSize(1.8), 2)
        // The slider on iPhone goes from 60% to 200%; the ends land on the outer steps.
        XCTAssertEqual(SubtitleStyleOptions.nearestSize(0.6), 0.75)
        XCTAssertEqual(SubtitleStyleOptions.nearestSize(2.4), 2)
    }

    func testHalfwayBetweenTwoStepsTakesTheSmaller() {
        XCTAssertEqual(SubtitleStyleOptions.nearest(1.5, in: [1, 2]), 1)
        XCTAssertEqual(SubtitleStyleOptions.nearestPosition(0.05), 0)
    }

    func testPositionSnapsToTheNearestStep() {
        XCTAssertEqual(SubtitleStyleOptions.nearestPosition(0), 0)
        XCTAssertEqual(SubtitleStyleOptions.nearestPosition(0.02), 0)
        XCTAssertEqual(SubtitleStyleOptions.nearestPosition(0.16), 0.1)
        XCTAssertEqual(SubtitleStyleOptions.nearestPosition(0.2), 0.25)
        XCTAssertEqual(SubtitleStyleOptions.nearestPosition(0.4), 0.25)
    }

    func testSteppingHoldsAtTheEnds() {
        XCTAssertEqual(SubtitleStyleOptions.sizeStep(from: 1, by: 1), 1.25)
        XCTAssertEqual(SubtitleStyleOptions.sizeStep(from: 1, by: -1), 0.75)
        XCTAssertEqual(SubtitleStyleOptions.sizeStep(from: 0.75, by: -1), 0.75)
        XCTAssertEqual(SubtitleStyleOptions.sizeStep(from: 2, by: 3), 2)
        // From between two steps, counting starts at the nearest.
        XCTAssertEqual(SubtitleStyleOptions.sizeStep(from: 1.4, by: 1), 2)
    }

    func testLabels() {
        XCTAssertEqual(SubtitleStyleOptions.sizeLabel(0.75), "75%")
        XCTAssertEqual(SubtitleStyleOptions.sizeLabel(1.25), "125%")
        XCTAssertEqual(SubtitleStyleOptions.sizeLabel(2), "200%")
        XCTAssertEqual(SubtitleStyleOptions.positionLabel(0), "Default")
        XCTAssertEqual(SubtitleStyleOptions.positionLabel(0.1), "Raised")
        XCTAssertEqual(SubtitleStyleOptions.positionLabel(0.25), "High")
        XCTAssertEqual(SubtitleStyleOptions.positionLabel(0.3), "High")
    }

    func testNextWrapsAndRecoversFromAnUnknownValue() {
        XCTAssertEqual(SubtitleStyleOptions.next(after: SubtitleColor.white, in: SubtitleColor.allCases), .yellow)
        XCTAssertEqual(SubtitleStyleOptions.next(after: SubtitleColor.green, in: SubtitleColor.allCases), .white)
        XCTAssertEqual(SubtitleStyleOptions.next(after: 7, in: [1, 2, 3]), 1)
        XCTAssertNil(SubtitleStyleOptions.next(after: 1, in: [Int]()))
    }

    func testResetAppearanceKeepsWhichSubtitlesLoad() {
        var s = SubtitleSettings()
        s.preferredLanguages = ["fr", "en"]
        s.defaultOffsetSeconds = 1.5
        s.autoSync = true
        s.fontScale = 2
        s.font = .serif
        s.weight = .heavy
        s.color = .cyan
        s.edgeStyle = .outline
        s.background = .solid
        s.backgroundOpacity = 0.9
        s.verticalPosition = 0.25
        s.keepASSStyling = true
        s.resetAppearance()
        let defaults = SubtitleSettings()
        XCTAssertEqual(s.fontScale, defaults.fontScale)
        XCTAssertEqual(s.font, defaults.font)
        XCTAssertEqual(s.weight, defaults.weight)
        XCTAssertEqual(s.color, defaults.color)
        XCTAssertEqual(s.edgeStyle, defaults.edgeStyle)
        XCTAssertEqual(s.background, defaults.background)
        XCTAssertEqual(s.backgroundOpacity, defaults.backgroundOpacity)
        XCTAssertEqual(s.verticalPosition, defaults.verticalPosition)
        XCTAssertEqual(s.keepASSStyling, defaults.keepASSStyling)
        XCTAssertEqual(s.preferredLanguages, ["fr", "en"])
        XCTAssertEqual(s.defaultOffsetSeconds, 1.5)
        XCTAssertTrue(s.autoSync)
    }
}
