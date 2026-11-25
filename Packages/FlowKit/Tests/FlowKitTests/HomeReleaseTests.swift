import XCTest
@testable import FlowKit

final class HomeReleaseTests: XCTestCase {
    private func day(_ text: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.date(from: text)!
    }

    private func release(_ country: String, _ type: MovieReleaseType, _ date: String) -> MovieRelease {
        MovieRelease(country: country, type: type, date: day(date), certification: nil)
    }

    func testNoDataIsUnknown() {
        XCTAssertEqual(HomeRelease.status(releases: [], region: "US", now: day("2026-11-25")), .unknown)
    }

    func testPastDigitalReleaseIsAvailable() {
        let releases = [release("US", .theatrical, "2026-09-01"), release("US", .digital, "2026-10-20")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")), .available)
    }

    func testDigitalReleaseInAnotherCountryCountsAsAvailable() {
        let releases = [release("US", .theatrical, "2026-09-01"), release("GB", .physical, "2026-10-20")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")), .available)
    }

    func testCinemaOnlyFilmIsInCinemas() {
        let releases = [release("US", .theatrical, "2026-10-16")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")),
                       .inCinemas(since: day("2026-10-16"), digitalOn: nil))
    }

    func testFutureDigitalDateIsNamed() {
        let releases = [release("US", .theatrical, "2026-10-16"), release("US", .digital, "2026-12-18"), release("US", .physical, "2027-01-20")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")),
                       .inCinemas(since: day("2026-10-16"), digitalOn: day("2026-12-18")))
    }

    func testPhysicalDateIsUsedWhenNoDigitalOneIsKnown() {
        let releases = [release("US", .theatrical, "2026-10-16"), release("US", .physical, "2027-01-20")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")),
                       .inCinemas(since: day("2026-10-16"), digitalOn: day("2027-01-20")))
    }

    func testRegionsOwnDatesAreNamedFirst() {
        let releases = [release("GB", .theatrical, "2026-10-09"), release("US", .theatrical, "2026-10-16"),
                        release("GB", .digital, "2026-12-01"), release("US", .digital, "2026-12-18")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")),
                       .inCinemas(since: day("2026-10-16"), digitalOn: day("2026-12-18")))
        XCTAssertEqual(HomeRelease.status(releases: releases, region: nil, now: day("2026-11-25")),
                       .inCinemas(since: day("2026-10-09"), digitalOn: day("2026-12-01")))
    }

    func testFallsBackToAnotherCountryWhenTheRegionHasNoDates() {
        let releases = [release("GB", .theatrical, "2026-10-09"), release("GB", .digital, "2026-12-01")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")),
                       .inCinemas(since: day("2026-10-09"), digitalOn: day("2026-12-01")))
    }

    func testRegionsFutureCinemaDateDoesNotHideAnEarlierOneElsewhere() {
        let releases = [release("GB", .theatrical, "2026-10-09"), release("US", .theatrical, "2026-12-03")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")),
                       .inCinemas(since: day("2026-10-09"), digitalOn: nil))
    }

    func testNothingOutYetIsUpcoming() {
        let releases = [release("GB", .theatrical, "2026-12-10"), release("US", .theatrical, "2026-12-03"), release("US", .digital, "2027-02-01")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")), .upcoming(on: day("2026-12-03")))
        XCTAssertEqual(HomeRelease.status(releases: releases, region: nil, now: day("2026-11-25")), .upcoming(on: day("2026-12-03")))
    }

    func testUpcomingWithoutACinemaDateIsOpenEnded() {
        let releases = [release("US", .digital, "2027-02-01")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")), .upcoming(on: nil))
    }

    func testReleaseDayCountsFromItsFirstMoment() {
        let releases = [release("US", .theatrical, "2026-10-16"), release("US", .digital, "2026-11-25")]
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-25")), .available)
        XCTAssertEqual(HomeRelease.status(releases: releases, region: "US", now: day("2026-11-24").addingTimeInterval(86399)),
                       .inCinemas(since: day("2026-10-16"), digitalOn: day("2026-11-25")))
        let opening = [release("US", .theatrical, "2026-11-25")]
        XCTAssertEqual(HomeRelease.status(releases: opening, region: "US", now: day("2026-11-25")), .inCinemas(since: day("2026-11-25"), digitalOn: nil))
        XCTAssertEqual(HomeRelease.status(releases: opening, region: "US", now: day("2026-11-24")), .upcoming(on: day("2026-11-25")))
    }
}
