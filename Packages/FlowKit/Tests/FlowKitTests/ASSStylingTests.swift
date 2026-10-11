import XCTest
@testable import FlowKit

final class ASSStylingTests: XCTestCase {
    private let script = #"""
    [Script Info]
    ScriptType: v4.00+
    PlayResX: 1280
    PlayResY: 720

    [V4+ Styles]
    Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
    Style: Default,Arial,54,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,1,2,64,64,36,1
    Style: Sign,Arial,36,&H00FF0000,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,2,1,8,10,10,20,1

    [Events]
    Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello, world
    Dialogue: 0,0:00:04.00,0:00:06.00,Sign,,0,0,0,,{\an7\i0\b1\c&H0000FF&\fs72}Top left\Nsecond line
    Dialogue: 0,0:00:07.00,0:00:08.00,Default,,0,0,90,,Margin override
    Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,{\t(0,100,\c&H00FF00&)\k20}Animated {\c&H00FF00&}later
    Dialogue: 0,0:00:11.00,0:00:12.00,Default,,0,0,0,,{\p1}m 0 0 l 100 0 100 100 0 100{\p0}
    Dialogue: 0,0:00:13.00,0:00:14.00,Default,,0,0,0,,{\1c&HFF0000&}Blue
    Dialogue: 1,0:00:13.00,0:00:14.00,Default,,0,0,0,,{\1c&HFF0000&}Blue
    Comment: 0,0:00:15.00,0:00:16.00,Default,,0,0,0,,not shown
    """#

    private func cue(_ doc: SubtitleDocument, containing text: String) throws -> SubtitleCue {
        try XCTUnwrap(doc.cues.first { $0.text.contains(text) })
    }

    func testStyleSectionSetsCueDefaults() throws {
        let doc = SubtitleParser.parse(script)
        let hello = try cue(doc, containing: "Hello, world")
        let style = try XCTUnwrap(hello.style)
        XCTAssertEqual(style.colour, 0xFFFF00)
        XCTAssertEqual(style.bold, true)
        XCTAssertEqual(style.italic, false)
        XCTAssertEqual(try XCTUnwrap(style.scale), 54.0 / 720, accuracy: 1e-9)
        XCTAssertEqual(style.alignment, 2)
        XCTAssertEqual(try XCTUnwrap(style.marginV), 36.0 / 720, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(style.marginL), 64.0 / 1280, accuracy: 1e-9)
        XCTAssertEqual(hello.start, 1, accuracy: 1e-9)
        XCTAssertEqual(hello.end, 3.5, accuracy: 1e-9)
    }

    func testInlineOverridesBeatTheStyle() throws {
        let doc = SubtitleParser.parse(script)
        let sign = try cue(doc, containing: "Top left")
        XCTAssertEqual(sign.text, "Top left\nsecond line")
        let style = try XCTUnwrap(sign.style)
        XCTAssertEqual(style.alignment, 7)
        XCTAssertEqual(style.placement?.vertical, .top)
        XCTAssertEqual(style.placement?.horizontal, .left)
        XCTAssertEqual(style.bold, true)
        XCTAssertEqual(style.italic, false)
        XCTAssertEqual(style.colour, 0xFF0000)
        XCTAssertEqual(try XCTUnwrap(style.scale), 72.0 / 720, accuracy: 1e-9)
    }

    func testUnoverriddenStyleSurvivesOnOtherStyles() throws {
        let doc = SubtitleParser.parse(script)
        let blue = try cue(doc, containing: "Blue")
        XCTAssertEqual(blue.style?.colour, 0x0000FF)
        XCTAssertEqual(blue.style?.bold, true)
    }

    func testEventMarginBeatsStyleMargin() throws {
        let margin = try cue(SubtitleParser.parse(script), containing: "Margin override")
        XCTAssertEqual(try XCTUnwrap(margin.style?.marginV), 90.0 / 720, accuracy: 1e-9)
    }

    func testAnimationsAndMidLineChangesAreIgnored() throws {
        let animated = try cue(SubtitleParser.parse(script), containing: "Animated")
        XCTAssertEqual(animated.text, "Animated later")
        XCTAssertEqual(animated.style?.colour, 0xFFFF00)
    }

    func testDrawingsCommentsAndDuplicateLayersAreDropped() {
        let doc = SubtitleParser.parse(script)
        XCTAssertEqual(doc.cues.count, 5)
        XCTAssertEqual(doc.cues.filter { $0.text == "Blue" }.count, 1)
        XCTAssertNil(doc.cues.first { $0.text.contains("not shown") })
    }

    func testColourForms() {
        XCTAssertEqual(ASSParser.colour("&H00FFFFFF"), 0xFFFFFF)
        XCTAssertEqual(ASSParser.colour("&H0000FF&"), 0xFF0000)
        XCTAssertEqual(ASSParser.colour("&HFF&"), 0xFF0000)
        XCTAssertEqual(ASSParser.colour("&H00FF00&"), 0x00FF00)
        // SSA writes colours as decimal BBGGRR.
        XCTAssertEqual(ASSParser.colour("16711680"), 0x0000FF)
        XCTAssertNil(ASSParser.colour(""))
    }

    func testSSAAlignmentMapsToNumpad() {
        XCTAssertEqual(ASSParser.ssaAlignment(2), 2)
        XCTAssertEqual(ASSParser.ssaAlignment(6), 8)
        XCTAssertEqual(ASSParser.ssaAlignment(5), 7)
        XCTAssertEqual(ASSParser.ssaAlignment(10), 5)
        XCTAssertNil(ASSParser.ssaAlignment(4))
        var style = SubtitleCueStyle()
        _ = ASSParser.applyOverrides(#"{\a6}Up"#, to: &style, playResY: 288)
        XCTAssertEqual(style.alignment, 8)
    }

    func testSSAStylesSectionUsesLegacyAlignment() throws {
        let ssa = #"""
        [Script Info]
        PlayResY: 480

        [V4 Styles]
        Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
        Style: Default,Arial,24,16777215,0,0,0,0,0,1,2,0,6,10,10,10,0,0

        [Events]
        Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        Dialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0000,0000,0000,,Top centre
        """#
        let cue = try XCTUnwrap(SubtitleParser.parse(ssa).cues.first)
        XCTAssertEqual(cue.style?.alignment, 8)
        XCTAssertEqual(cue.style?.colour, 0xFFFFFF)
        XCTAssertEqual(cue.style?.bold, false)
    }

    func testMissingStyleFallsBackToDefaultThenNothing() throws {
        let script = #"""
        [V4+ Styles]
        Format: Name, Fontsize, PrimaryColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV
        Style: Default,40,&H00FFFFFF,0,0,2,10,10,10

        [Events]
        Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        Dialogue: 0,0:00:01.00,0:00:02.00,Missing,,0,0,0,,Uses default
        """#
        let cue = try XCTUnwrap(SubtitleParser.parse(script).cues.first)
        XCTAssertEqual(cue.style?.alignment, 2)
        XCTAssertEqual(cue.text, "Uses default")
    }

    func testDocumentReturnsStyledCuesAtATime() {
        let doc = SubtitleParser.parse(script)
        XCTAssertEqual(doc.cues(at: 2).count, 1)
        XCTAssertEqual(doc.text(at: 2), "Hello, world")
        // A positive offset delays the subtitle.
        XCTAssertTrue(doc.cues(at: 2, offset: 2).isEmpty)
        XCTAssertEqual(doc.cues(at: 3, offset: 2).count, 1)
    }

    func testPlainSubtitlesCarryNoStyle() {
        let doc = SubtitleParser.parse("1\n00:00:01,000 --> 00:00:02,000\n<i>Plain</i>\n")
        XCTAssertEqual(doc.cues.first?.text, "Plain")
        XCTAssertNil(doc.cues.first?.style)
    }

    func testTitles() {
        XCTAssertEqual(SubtitleBackground.translucent.title, "Translucent Box")
        XCTAssertTrue(SubtitleBackground.solid.drawsBox)
        XCTAssertFalse(SubtitleBackground.shadow.drawsBox)
        XCTAssertEqual(SubtitleColor.cyan.title, "Cyan")
    }
}
