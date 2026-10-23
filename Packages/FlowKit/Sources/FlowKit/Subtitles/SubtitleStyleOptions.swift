import Foundation

/// The steps the Apple TV and Mac players, and Settings, offer for how subtitles look, in one place so
/// every screen lists the same choices. The iPhone's sliders can leave a value between two steps, so
/// anything that shows a step first snaps the stored value to the nearest one.
public enum SubtitleStyleOptions {
    /// Text size as a multiple of the usual size.
    public static let sizeSteps: [Double] = [0.75, 1, 1.25, 1.5, 2]
    /// How far Flow's own subtitles are raised, as a fraction of the picture height.
    public static let positionSteps: [Double] = [0, 0.1, 0.25]

    /// The step closest to `value`; halfway between two, the smaller one.
    public static func nearest(_ value: Double, in steps: [Double]) -> Double {
        steps.min { abs($0 - value) < abs($1 - value) } ?? value
    }

    public static func nearestSize(_ value: Double) -> Double { nearest(value, in: sizeSteps) }
    public static func nearestPosition(_ value: Double) -> Double { nearest(value, in: positionSteps) }

    /// The step `count` places from the one nearest `value`, held at either end rather than wrapping.
    public static func sizeStep(from value: Double, by count: Int) -> Double {
        let index = sizeSteps.firstIndex(of: nearestSize(value)) ?? 0
        return sizeSteps[min(max(index + count, 0), sizeSteps.count - 1)]
    }

    /// "125%".
    public static func sizeLabel(_ value: Double) -> String { "\(Int((value * 100).rounded()))%" }

    /// "Default", "Raised" or "High", for the step nearest `value`.
    public static func positionLabel(_ value: Double) -> String {
        let step = nearestPosition(value)
        if step <= 0 { return "Default" }
        return step < 0.2 ? "Raised" : "High"
    }

    /// The choice after `current`, wrapping to the first; the first when `current` isn't in the list.
    public static func next<T: Equatable>(after current: T, in choices: [T]) -> T? {
        guard let first = choices.first else { return nil }
        guard let index = choices.firstIndex(of: current) else { return first }
        return choices[(index + 1) % choices.count]
    }
}

extension SubtitleSettings {
    /// Puts how subtitles look back to the defaults. Which ones load and when, and the sync offset, stay.
    public mutating func resetAppearance() {
        let defaults = SubtitleSettings()
        font = defaults.font
        fontScale = defaults.fontScale
        weight = defaults.weight
        color = defaults.color
        edgeStyle = defaults.edgeStyle
        background = defaults.background
        backgroundOpacity = defaults.backgroundOpacity
        verticalPosition = defaults.verticalPosition
        keepASSStyling = defaults.keepASSStyling
    }
}
