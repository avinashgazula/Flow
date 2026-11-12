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

/// The volume as Apple's player draws it: a speaker and a thin track with a small knob, on a translucent capsule.
struct VolumePill: View {
    let volume: SystemVolume
    /// Reports when a drag begins and ends, so the player's controls neither hide mid-drag nor linger after.
    var onEditingChanged: (Bool) -> Void = { _ in }

    @State private var editing = false

    private var symbol: String {
        switch volume.level {
        case ..<0.01: "speaker.slash.fill"
        case ..<0.34: "speaker.wave.1.fill"
        case ..<0.67: "speaker.wave.2.fill"
        default: "speaker.wave.3.fill"
        }
    }

    private static let trackWidth: CGFloat = 130

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .regular))
                .frame(width: 24)
                .contentTransition(.symbolEffect(.replace))
            track
        }
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.45), radius: 4, y: 1)
        .padding(.horizontal, 14)
        .frame(height: 48)
        .playerCapsule()
        .background(VolumeViewHost(volume: volume).frame(width: 0, height: 0))
        .accessibilityElement()
        .accessibilityLabel("Volume")
        .accessibilityValue("\(Int((volume.level * 100).rounded())) percent")
        .accessibilityAdjustableAction { direction in
            volume.set(volume.level + (direction == .increment ? 0.0625 : -0.0625))
        }
    }

    /// A 4pt bar with a 12pt knob; the hit area is the full height of the capsule, so a finger doesn't have to find the line.
    private var track: some View {
        let fraction = CGFloat(min(1, max(0, volume.level)))
        return ZStack(alignment: .leading) {
            Capsule().fill(.white.opacity(0.3)).frame(height: editing ? 6 : 4)
            Capsule().fill(.white).frame(width: Self.trackWidth * fraction, height: editing ? 6 : 4)
            Circle().fill(.white)
                .frame(width: 12, height: 12)
                .offset(x: min(max(Self.trackWidth * fraction - 6, 0), Self.trackWidth - 12))
        }
        .frame(width: Self.trackWidth, height: 44)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if !editing { editing = true; onEditingChanged(true) }
                    volume.set(Float(value.location.x / Self.trackWidth))
                }
                .onEnded { _ in
                    editing = false
                    onEditingChanged(false)
                }
        )
        .animation(Theme.Motion.snappy, value: editing)
    }
}
#endif
