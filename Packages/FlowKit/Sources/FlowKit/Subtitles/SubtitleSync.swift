import Foundation

/// Finds the delay that lines a subtitle file up with a film's dialogue: where there's speech in the
/// soundtrack, there should be a cue on screen. Both sides are reduced to on/off per 100 ms frame and
/// compared at every shift.
public enum SubtitleSync {
    /// Voice activity from audio that arrives in pieces, so a long window never sits in memory as PCM:
    /// only each frame's energy is kept.
    public struct SpeechAnalyzer: Sendable {
        public let sampleRate: Int
        public let frame: Double
        private let frameSamples: Int
        // One-pole filters keep speech (about 150 Hz to 3.5 kHz) and drop rumble and hiss.
        private let highPass: Float
        private let lowPass: Float
        private var hpIn: Float = 0
        private var hpOut: Float = 0
        private var lp: Float = 0
        private var sum: Double = 0
        private var count = 0
        private var energies: [Double] = []

        public init(sampleRate: Int, frame: Double = 0.1) {
            self.sampleRate = sampleRate
            self.frame = frame
            frameSamples = max(1, Int((Double(sampleRate) * frame).rounded()))
            let dt = 1 / Float(sampleRate)
            let hpRC = 1 / (2 * Float.pi * 150)
            let lpRC = 1 / (2 * Float.pi * 3500)
            highPass = hpRC / (hpRC + dt)
            lowPass = dt / (lpRC + dt)
        }

        /// Feeds consecutive mono samples.
        public mutating func append(_ samples: [Float]) {
            for x in samples {
                hpOut = highPass * (hpOut + x - hpIn)
                hpIn = x
                lp += lowPass * (hpOut - lp)
                sum += Double(lp * lp)
                count += 1
                if count == frameSamples { closeFrame() }
            }
        }

        /// Frames so far, a trailing part-frame of at least half a frame included.
        public var frameCount: Int { energies.count + (count * 2 >= frameSamples ? 1 : 0) }

        /// The estimate for everything fed in: a frame is speech when its energy clears a threshold set
        /// between the quiet floor and the loud end of this window, then gaps between words are bridged
        /// and blips dropped.
        public func finish() -> [Bool] {
            var all = energies
            if count * 2 >= frameSamples { all.append(sum / Double(count)) }
            guard all.count >= 10 else { return Array(repeating: false, count: all.count) }
            let db = all.map { 10 * log10($0 + 1e-12) }
            let sorted = db.sorted()
            let low = sorted[Int(Double(sorted.count - 1) * 0.10)]
            let high = sorted[Int(Double(sorted.count - 1) * 0.90)]
            // A flat window (silence, or a steady tone) has no speech to find.
            guard high - low >= 6 else { return Array(repeating: false, count: all.count) }
            let threshold = low + 0.4 * (high - low)
            return Self.smooth(db.map { $0 > threshold }, bridge: Int((0.4 / frame).rounded()), minimum: Int((0.2 / frame).rounded()))
        }

        private mutating func closeFrame() {
            energies.append(sum / Double(count))
            sum = 0
            count = 0
        }

        /// Closes silences of up to `bridge` frames between speech, then drops speech shorter than `minimum`.
        static func smooth(_ on: [Bool], bridge: Int, minimum: Int) -> [Bool] {
            var out = on
            func runs(_ value: Bool, _ body: (Range<Int>) -> Void) {
                var i = 0
                while i < out.count {
                    guard out[i] == value else { i += 1; continue }
                    var j = i
                    while j < out.count, out[j] == value { j += 1 }
                    body(i..<j)
                    i = j
                }
            }
            var gaps: [Range<Int>] = []
            runs(false) { if $0.lowerBound > 0, $0.upperBound < out.count, $0.count <= bridge { gaps.append($0) } }
            for gap in gaps { for i in gap { out[i] = true } }
            var blips: [Range<Int>] = []
            runs(true) { if $0.count < minimum { blips.append($0) } }
            for blip in blips { for i in blip { out[i] = false } }
            return out
        }
    }

    /// Speech or not for each `frame` seconds of mono audio.
    public static func speechActivity(samples: [Float], sampleRate: Int, frame: Double = 0.1) -> [Bool] {
        var analyzer = SpeechAnalyzer(sampleRate: sampleRate, frame: frame)
        analyzer.append(samples)
        return analyzer.finish()
    }

    /// Whether a cue is on screen at the middle of each `frame`-second frame from `from` up to `to`.
    public static func cueActivity(_ doc: SubtitleDocument, from: Double, to: Double, frame: Double) -> [Bool] {
        let count = max(0, Int(((to - from) / frame).rounded(.up)))
        var out = Array(repeating: false, count: count)
        for cue in doc.cues {
            guard cue.end > from, cue.start < to else { continue }
            // Frame i is centred on from + (i + 0.5) * frame.
            let first = max(0, Int(((cue.start - from) / frame - 0.5).rounded(.up)))
            let last = min(count - 1, Int(((cue.end - from) / frame - 0.5).rounded(.up)) - 1)
            guard first <= last else { continue }
            for i in first...last { out[i] = true }
        }
        return out
    }

    /// The offset (seconds; positive shows subtitles later, as `SubtitleDocument.text(at:offset:)` does)
    /// at which the cues agree best with `speech`, which starts at `start` seconds of the film. Agreement
    /// is the correlation of the two on/off signals. Confidence is how far the best shift stands above the
    /// typical one; nil when nothing stands out.
    public static func bestOffset(speech: [Bool], start: Double = 0, cues doc: SubtitleDocument, frame: Double = 0.1,
                                  range: ClosedRange<Double> = -15...15, step: Double = 0.1,
                                  minimumConfidence: Double = 0.15) -> (offset: Double, confidence: Double)? {
        guard speech.count >= 100, speech.contains(true) else { return nil }
        let reach = Int((max(abs(range.lowerBound), abs(range.upperBound)) / frame).rounded(.up)) + 1
        let cues = cueActivity(doc, from: start - Double(reach) * frame, to: start + Double(speech.count + reach) * frame, frame: frame)
        guard cues.contains(true) else { return nil }

        let stride = max(1, Int((step / frame).rounded()))
        let lowest = Int((range.lowerBound / frame).rounded(.up)), highest = Int((range.upperBound / frame).rounded(.down))
        let n = Double(speech.count)
        let speechOn = Double(speech.reduce(0) { $0 + ($1 ? 1 : 0) })
        let speechVariance = speechOn / n * (1 - speechOn / n)
        guard speechVariance > 0 else { return nil }

        var scored: [(shift: Int, score: Double)] = []
        for shift in Swift.stride(from: lowest, through: highest, by: stride) {
            // Speech frame i lines up with the cue that played `shift` frames earlier.
            var cueOn = 0.0, both = 0.0
            for i in 0..<speech.count {
                let j = i - shift + reach
                guard cues.indices.contains(j), cues[j] else { continue }
                cueOn += 1
                if speech[i] { both += 1 }
            }
            let cueVariance = cueOn / n * (1 - cueOn / n)
            guard cueVariance > 0 else { scored.append((shift, 0)); continue }
            let covariance = both / n - (speechOn / n) * (cueOn / n)
            scored.append((shift, covariance / (speechVariance * cueVariance).squareRoot()))
        }
        guard let best = scored.max(by: { $0.score < $1.score }) else { return nil }
        let middle = scored.map(\.score).sorted()[scored.count / 2]
        let confidence = best.score - middle
        guard best.score > 0, confidence >= minimumConfidence else { return nil }
        return (Double(best.shift) * frame, confidence)
    }
}
