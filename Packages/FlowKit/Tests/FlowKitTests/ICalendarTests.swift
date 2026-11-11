import XCTest
@testable import FlowKit

final class ICalendarTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    func testAllDayEventEndsTheNextDay() {
        let text = ICalendar.build([ICalendarEvent(uid: "a@flow-app", title: "Show — S1E2 · Pilot", day: "2026-12-31")], now: now)
        XCTAssertTrue(text.contains("DTSTART;VALUE=DATE:20261231\r\n"))
        XCTAssertTrue(text.contains("DTEND;VALUE=DATE:20270101\r\n"))
        XCTAssertTrue(text.contains("UID:a@flow-app\r\n"))
        XCTAssertTrue(text.hasPrefix("BEGIN:VCALENDAR\r\n"))
        XCTAssertTrue(text.hasSuffix("END:VCALENDAR\r\n"))
    }

    func testTimedEventDefaultsToAnHour() {
        let start = Date(timeIntervalSince1970: 1_790_001_000)
        let text = ICalendar.build([ICalendarEvent(uid: "b", title: "T", start: start)], now: now)
        XCTAssertTrue(text.contains("DTSTART:\(ICalendar.utcStamp(start))"))
        XCTAssertTrue(text.contains("DTEND:\(ICalendar.utcStamp(start.addingTimeInterval(3600)))"))
    }

    func testEventsWithoutADateAreLeftOut() {
        let text = ICalendar.build([ICalendarEvent(uid: "c", title: "None"), ICalendarEvent(uid: "d", title: "Bad", day: "soon")], now: now)
        XCTAssertFalse(text.contains("BEGIN:VEVENT"))
    }

    func testEscapingAndFolding() {
        XCTAssertEqual(ICalendar.escape("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne")
        let folded = ICalendar.fold(String(repeating: "é", count: 60))
        for line in folded.components(separatedBy: "\r\n") {
            XCTAssertLessThanOrEqual(line.utf8.count, 75)
        }
        XCTAssertEqual(folded.replacingOccurrences(of: "\r\n ", with: ""), String(repeating: "é", count: 60))
    }

    func testUIDIsStableAndPlain() {
        XCTAssertEqual(ICalendar.uid(for: "1396:3:7"), "1396-3-7@flow-app")
        XCTAssertEqual(ICalendar.uid(for: "movie:693134"), "movie-693134@flow-app")
    }

    func testBareDayOnlyForMidnightUTC() {
        XCTAssertEqual(ICalendar.bareDay(Date(timeIntervalSince1970: 1_789_948_800)), "2026-09-21")
        XCTAssertNil(ICalendar.bareDay(Date(timeIntervalSince1970: 1_790_000_000)))
    }

    func testDayArithmeticAcrossMonthsAndLeapYears() {
        XCTAssertEqual(ICalendar.nextDay("2028-02-28"), "20280229")
        XCTAssertEqual(ICalendar.nextDay("2026-03-29"), "20260330")
        XCTAssertNil(ICalendar.nextDay("nope"))
    }
}
