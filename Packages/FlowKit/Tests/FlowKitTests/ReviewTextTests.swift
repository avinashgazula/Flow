import XCTest
@testable import FlowKit

final class ReviewTextTests: XCTestCase {
    func testEntities() {
        XCTAssertEqual(ReviewText.clean("plot &amp; save the world"), "plot & save the world")
        XCTAssertEqual(ReviewText.clean("&quot;Wow&quot; &#39;yes&#39; &#x2014; it&rsquo;s"), "\"Wow\" 'yes' — it’s")
        XCTAssertEqual(ReviewText.clean("Tom & Jerry &unknown; &"), "Tom & Jerry &unknown; &")
    }

    func testTagsAndBreaks() {
        XCTAssertEqual(ReviewText.clean("<em>Great</em> film.<br/>Second line<br><br><br><br>Last"),
                       "Great film.\nSecond line\n\nLast")
    }

    func testMarkdown() {
        XCTAssertEqual(ReviewText.clean("**Bold** and _quiet_ and *soft*"), "Bold and quiet and soft")
        XCTAssertEqual(ReviewText.clean("Read [my blog](https://example.com/post) now"), "Read my blog now")
    }

    func testLeavesOrdinaryTextAlone() {
        XCTAssertEqual(ReviewText.clean("snake_case_names, 2 * 3 * 4, a < b"), "snake_case_names, 2 * 3 * 4, a < b")
        XCTAssertEqual(ReviewText.clean("[spoiler]He dies[/spoiler]"), "[spoiler]He dies[/spoiler]")
    }
}
