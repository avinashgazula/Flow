#if os(iOS)
import SwiftUI
import AVFoundation
import MediaPlayer

/// The system output volume: read from the audio session, set through the one public route, an `MPVolumeView`'s slider.
@MainActor
@Observable
final class SystemVolume {
    private(set) var level: Float = AVAudioSession.sharedInstance().outputVolume
    @ObservationIgnored private var observation: NSKeyValueObservation?
    @ObservationIgnored fileprivate weak var host: MPVolumeView?

    init() {
        // KVO rather than polling, so the hardware buttons move the slider too.
        observation = AVAudioSession.sharedInstance().observe(\.outputVolume, options: [.new]) { [weak self] _, change in
            guard let value = change.newValue else { return }
            Task { @MainActor in self?.level = value }
        }
    }

    func set(_ value: Float) {
        let clamped = min(1, max(0, value))
        level = clamped
        guard let slider = host?.subviews.compactMap({ $0 as? UISlider }).first else { return }
        slider.setValue(clamped, animated: false)
        slider.sendActions(for: .valueChanged)
    }
}

/// A hidden `MPVolumeView`: iOS only lets an app change the volume by driving this view's slider.
private struct VolumeViewHost: UIViewRepresentable {
    let volume: SystemVolume

    func makeUIView(context: Context) -> MPVolumeView {
        let view = MPVolumeView(frame: .zero)
        view.alpha = 0.01
        volume.host = view
        return view
    }

    func updateUIView(_ view: MPVolumeView, context: Context) {
        volume.host = view
    }
}

/// A glass capsule with the volume as a speaker, a percentage and a slider.
struct VolumePill: View {
    let volume: SystemVolume
    /// Reports when a drag begins and ends, so the player's controls neither hide mid-drag nor linger after.
    var onEditingChanged: (Bool) -> Void = { _ in }

    private var symbol: String {
        switch volume.level {
        case ..<0.01: "speaker.slash.fill"
        case ..<0.34: "speaker.wave.1.fill"
        case ..<0.67: "speaker.wave.2.fill"
        default: "speaker.wave.3.fill"
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 20)
                .contentTransition(.symbolEffect(.replace))
            // Fixed width, so the digits changing length doesn't nudge the slider under the finger.
            Text("\(Int((volume.level * 100).rounded()))%")
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .foregroundStyle(Theme.Palette.textSecondary)
                .frame(width: 40, alignment: .trailing)
            Slider(value: Binding(get: { volume.level }, set: { volume.set($0) }), in: 0...1, onEditingChanged: onEditingChanged)
                .tint(.white)
                .frame(width: 140)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .flowGlass(Capsule())
        .background(VolumeViewHost(volume: volume).frame(width: 0, height: 0))
        .accessibilityElement(children: .contain)
    }
}
#endif
