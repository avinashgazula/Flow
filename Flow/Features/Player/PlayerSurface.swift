import SwiftUI
import AVKit
import FlowKit

#if os(iOS)
/// Bare video layer for iOS; Flow draws its own controls on top.
final class PlayerLayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    var gravity: AVLayerVideoGravity
    var onLayer: (AVPlayerLayer) -> Void = { _ in }

    func makeUIView(context: Context) -> PlayerLayerUIView {
        let view = PlayerLayerUIView()
        view.backgroundColor = .black
        view.playerLayer.player = player
        view.playerLayer.videoGravity = gravity
        onLayer(view.playerLayer)
        return view
    }

    func updateUIView(_ view: PlayerLayerUIView, context: Context) {
        view.playerLayer.videoGravity = gravity
        if view.playerLayer.player !== player { view.playerLayer.player = player }
    }
}

/// AirPlay route picker.
struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = .systemBlue
        view.prioritizesVideoDevices = true
        return view
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
#endif

#if os(tvOS)
/// What Flow draws in the system player's content overlay, beneath its transport bar and info
/// panel: subtitles, and the still-watching question (answered with the player's own button).
struct TVContentOverlay: View {
    let session: PlaybackSession
    let settings: SubtitleSettings

    var body: some View {
        ZStack {
            SubtitleLayer(session: session, settings: settings)
            if session.asksStillWatching {
                StillWatchingPrompt(session: session).transition(.opacity)
            }
        }
        .animation(Theme.Motion.gentle, value: session.asksStillWatching)
    }
}

/// AVKit owns the Apple TV transport, track selection, scrubbing, and Siri Remote interactions.
struct TVPlayerController: UIViewControllerRepresentable {
    let session: PlaybackSession
    let subtitleSettings: SubtitleSettings

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = session.player
        controller.delegate = context.coordinator
        session.tvPlayerController = controller
        // The session requests display matching before it assigns the HLS item.
        controller.appliesPreferredDisplayCriteriaAutomatically = false

        // Downloaded and disc captions sit beneath the system playback controls.
        if let overlay = controller.contentOverlayView {
            let host = UIHostingController(rootView: TVContentOverlay(session: session, settings: subtitleSettings))
            host.view.backgroundColor = .clear
            host.view.isUserInteractionEnabled = false
            controller.addChild(host)
            host.view.frame = overlay.bounds
            host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            overlay.addSubview(host.view)
            host.didMove(toParent: controller)
            context.coordinator.subtitleHost = host
        }
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        let coordinator = context.coordinator
        if let host = coordinator.subtitleHost, host.rootView.settings != subtitleSettings {
            host.rootView = TVContentOverlay(session: session, settings: subtitleSettings)
        }

        let action = contextualAction
        if coordinator.action != action {
            coordinator.action = action
            controller.contextualActions = action.map { [makeAction($0)] } ?? []
        }

        // AVKit's subtitle picker handles stream captions. Picture-based disc tracks need their own selector.
        let tracks = session.bitmapTracks
        let selection = session.selectedBitmapTrack
        if coordinator.discTracks != tracks || coordinator.discSelection != selection {
            coordinator.discTracks = tracks
            coordinator.discSelection = selection
            controller.transportBarCustomMenuItems = tracks.isEmpty ? [] : [
                UIMenu(title: "Disc Subtitles", image: UIImage(systemName: "captions.bubble"), options: .singleSelection,
                       children: [discSubtitleAction(title: "Off", track: nil, selected: selection)] +
                           tracks.map { discSubtitleAction(title: $0.title, track: $0.id, selected: selection) })
            ]
        }
    }

    private var contextualAction: ContextualAction? {
        if session.asksStillWatching { return .keepWatching }
        if let segment = session.activeSegment { return .skip(segment) }
        if session.upNextCountdown != nil { return .playNext }
        return nil
    }

    private func makeAction(_ action: ContextualAction) -> UIAction {
        switch action {
        case .keepWatching:
            return UIAction(title: "Keep Watching", image: UIImage(systemName: "play.fill")) { _ in session.confirmStillWatching() }
        case .skip(let segment):
            return UIAction(title: segment.kind.buttonTitle) { _ in session.skip(segment) }
        case .playNext:
            return UIAction(title: "Play Next", image: UIImage(systemName: "forward.fill")) { _ in
                Task { await session.playUpNext() }
            }
        }
    }

    private func discSubtitleAction(title: String, track: Int?, selected: Int?) -> UIAction {
        UIAction(title: title, state: track == selected ? .on : .off) { _ in session.selectBitmapSubtitle(track) }
    }

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    enum ContextualAction: Equatable {
        case keepWatching
        case skip(SkipSegment)
        case playNext
    }

    final class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        let session: PlaybackSession
        var subtitleHost: UIHostingController<TVContentOverlay>?
        var action: ContextualAction?
        var discTracks: [PlayerTrack] = []
        var discSelection: Int?
        init(session: PlaybackSession) { self.session = session }

        func playerViewControllerShouldDismiss(_ playerViewController: AVPlayerViewController) -> Bool {
            // AVKit handles Back while its controls are open. Once it asks to exit, close the embedded view.
            Task { @MainActor in session.stop() }
            return false
        }
    }
}

#endif

#if os(macOS)
struct MacPlayerView: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.player = player
        view.controlsStyle = .floating
        view.showsFullScreenToggleButton = true
        view.allowsPictureInPicturePlayback = true
        view.showsSharingServiceButton = false
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if view.player !== player { view.player = player }
    }
}
#endif
