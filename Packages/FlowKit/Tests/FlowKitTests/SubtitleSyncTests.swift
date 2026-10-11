import XCTest
@testable import FlowKit

final class SubtitleSyncTests: XCTestCase {
    /// Small deterministic generator, so a failing run can be repeated.
    struct Generator: RandomNumberGenerator {
        var state: UInt64
        mutating func next() -> UInt64 {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return state ^ (state >> 29)
        }
    }

    /// Cues of 1.5 to 4 s with 0.5 to 5 s between them, across `length` seconds.
    private func makeCues(length: Double, seed: UInt64) -> SubtitleDocument {
        var rng = Generator(state: seed)
        var cues: [SubtitleCue] = []
        var t = 2.0
        while t < length {
            let duration = Double.random(in: 1.5...4, using: &rng)
            cues.append(SubtitleCue(index: cues.count, start: t, end: t + duration, text: "line \(cues.count)"))
            t += duration + Double.random(in: 0.5...5, using: &rng)
        }
        return SubtitleDocument(cues: cues)
    }

    /// Dialogue that sits `delay` seconds after the cues, with a few frames flipped the way a real detector errs.
    private func speech(for doc: SubtitleDocument, delay: Double, length: Double, flips: Double, seed: UInt64) -> [Bool] {
        var rng = Generator(state: seed)
        let shifted = SubtitleDocument(cues: doc.cues.map { SubtitleCue(index: $0.index, start: $0.start + delay, end: $0.end + delay, text: $0.text) })
        return SubtitleSync.cueActivity(shifted, from: 0, to: length, frame: 0.1).map { Double.random(in: 0..<1, using: &rng) < flips ? !$0 : $0 }
    }

    func testLongCueStaysUpUnderLaterShortOnes() {
        // A sign that stays up for a minute, then a dozen lines of dialogue starting after it.
        var cues = [SubtitleCue(index: 0, start: 10, end: 70, text: "sign")]
        for i in 0..<12 { cues.append(SubtitleCue(index: i + 1, start: 20 + Double(i) * 3, end: 22 + Double(i) * 3, text: "line \(i)")) }
        let doc = SubtitleDocument(cues: cues)
        XCTAssertEqual(doc.cues(at: 60).map(\.text), ["sign"])
        XCTAssertEqual(doc.cues(at: 21).map(\.text), ["sign", "line 0"])
        XCTAssertEqual(doc.text(at: 62, offset: 5), "sign")
        XCTAssertNil(doc.text(at: 71))
        XCTAssertNil(doc.text(at: 9))
        // A delay moves the cue later, as `offset` documents.
        XCTAssertEqual(doc.text(at: 22.5, offset: 2), "sign\nline 0")
        XCTAssertEqual(doc.cues(at: 20.5, offset: 2).map(\.text), ["sign"])
    }

    func testCueActivityMarksFramesUnderCues() {
        let doc = SubtitleDocument(cues: [SubtitleCue(index: 0, start: 1.0, end: 2.0, text: "a")])
        let frames = SubtitleSync.cueActivity(doc, from: 0, to: 3, frame: 0.1)
        XCTAssertEqual(frames.count, 30)
        XCTAssertEqual(frames.filter { $0 }.count, 10)
        XCTAssertFalse(frames[9])
        XCTAssertTrue(frames[10])
        XCTAssertTrue(frames[19])
        XCTAssertFalse(frames[20])
    }

    func testRecoversKnownShifts() throws {
        let length = 180.0
        let doc = makeCues(length: length + 60, seed: 7)
        for delay in [-7.3, -2.4, 0, 0.8, 3.7, 12.0] {
            let signal = speech(for: doc, delay: delay, length: length, flips: 0.1, seed: 99)
            let result = try XCTUnwrap(SubtitleSync.bestOffset(speech: signal, cues: doc), "no match for \(delay)")
            XCTAssertEqual(result.offset, delay, accuracy: 0.2)
            XCTAssertGreaterThan(result.confidence, 0.3)
        }
    }

    func testWindowAwayFromTheStartOfTheFilm() throws {
        let doc = makeCues(length: 2000, seed: 21)
        let window = speech(for: doc, delay: 1.9, length: 1200, flips: 0.1, seed: 5)
        let signal = Array(window[6000..<7800])
        let result = try XCTUnwrap(SubtitleSync.bestOffset(speech: signal, start: 600, cues: doc))
        XCTAssertEqual(result.offset, 1.9, accuracy: 0.2)
    }

    func testNoiseGivesNoMatch() {
        let doc = makeCues(length: 240, seed: 3)
        for seed in UInt64(1)...5 {
            var rng = Generator(state: seed)
            let noise = (0..<1800).map { _ in Bool.random(using: &rng) }
            XCTAssertNil(SubtitleSync.bestOffset(speech: noise, cues: doc), "seed \(seed)")
        }
    }

    func testNothingToCompareGivesNoMatch() {
        let doc = makeCues(length: 240, seed: 3)
        XCTAssertNil(SubtitleSync.bestOffset(speech: Array(repeating: false, count: 1800), cues: doc))
        XCTAssertNil(SubtitleSync.bestOffset(speech: Array(repeating: true, count: 1800), cues: doc))
        XCTAssertNil(SubtitleSync.bestOffset(speech: [], cues: doc))
    }

    /// Tone bursts in a hiss: the detector follows the bursts, including when the audio arrives in odd-sized pieces.
    func testSpeechActivityFollowsBursts() {
        let rate = 16_000
        var rng = Generator(state: 11)
        var samples = [Float]()
        for second in 0..<30 {
            let talking = second % 3 != 2
            for n in 0..<rate {
                let hiss = Float.random(in: -0.01...0.01, using: &rng)
                let t = Float(n) / Float(rate)
                let voice: Float = talking ? 0.3 * sin(2 * .pi * 300 * t) * (0.6 + 0.4 * sin(2 * .pi * 4 * t)) : 0
                samples.append(hiss + voice)
            }
        }
        let whole = SubtitleSync.speechActivity(samples: samples, sampleRate: rate)
        XCTAssertEqual(whole.count, 300)
        for (i, on) in whole.enumerated() {
            // Leave the edges either way: only frames well inside a burst or a pause are judged.
            let phase = (Double(i) * 0.1).truncatingRemainder(dividingBy: 3)
            if phase > 0.3, phase < 1.7 { XCTAssertTrue(on, "frame \(i)") }
            if phase > 2.3, phase < 2.7 { XCTAssertFalse(on, "frame \(i)") }
        }
        var analyzer = SubtitleSync.SpeechAnalyzer(sampleRate: rate)
        var start = 0
        for size in [777, 4096, 1, 15_000, 99_999] where start < samples.count {
            let end = min(samples.count, start + size)
            analyzer.append(Array(samples[start..<end]))
            start = end
        }
        analyzer.append(Array(samples[start...]))
        XCTAssertEqual(analyzer.finish(), whole)
    }

    func testRumbleAndSilenceAreNotSpeech() {
        let rate = 16_000
        let rumble = (0..<(rate * 20)).map { 0.5 * sin(2 * .pi * 40 * Float($0) / Float(rate)) }
        XCTAssertFalse(SubtitleSync.speechActivity(samples: rumble, sampleRate: rate).contains(true))
        XCTAssertFalse(SubtitleSync.speechActivity(samples: Array(repeating: 0, count: rate * 20), sampleRate: rate).contains(true))
    }
}
