import XCTest
@testable import FlowKit

final class AirDateFormattingTests: XCTestCase {
    private func utc(_ string: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: string)!
    }

    func testBareDaysAreRecognised() {
        XCTAssertTrue(AirDateFormatting.isBareDay(utc("2026-10-21T00:00:00Z")))
        XCTAssertFalse(AirDateFormatting.isBareDay(utc("2026-10-21T01:00:00Z")))
        XCTAssertFalse(AirDateFormatting.isBareDay(utc("2026-10-21T00:00:30Z")))
    }

    func testABareDayKeepsItsDayInTheViewersZone() {
        // In New York midnight UTC is the evening before; the label must still say the 21st.
        let original = NSTimeZone.default
        NSTimeZone.default = TimeZone(identifier: "America/New_York")!
        defer { NSTimeZone.default = original }
        let label = AirDateFormatting.string(for: utc("2026-10-21T00:00:00Z"), localTimeZone: true)
        XCTAssertTrue(label.contains("21"), label)
    }

    func testARealAirTimeFollowsTheViewersZone() {
        let original = NSTimeZone.default
        NSTimeZone.default = TimeZone(identifier: "America/New_York")!
        defer { NSTimeZone.default = original }
        // 01:00 UTC on the 22nd is 9 pm on the 21st in New York.
        let local = AirDateFormatting.string(for: utc("2026-10-22T01:00:00Z"), localTimeZone: true)
        XCTAssertTrue(local.contains("21"), local)
        let source = AirDateFormatting.string(for: utc("2026-10-22T01:00:00Z"), localTimeZone: false)
        XCTAssertTrue(source.contains("22"), source)
    }

    func testLocalDayFromABareDay() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let day = AirDateFormatting.localDay(fromBareDay: utc("2026-10-21T00:00:00Z"), in: calendar)
        XCTAssertEqual(day.map { calendar.dateComponents([.year, .month, .day, .hour], from: $0) },
                       DateComponents(year: 2026, month: 10, day: 21, hour: 0))
        XCTAssertNil(AirDateFormatting.localDay(fromBareDay: utc("2026-10-21T20:00:00Z"), in: calendar))
    }
}
