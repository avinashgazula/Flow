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

/// The system player on tvOS: Siri Remote scrubbing, info panel, audio/subtitle menus.
/// Flow adds skip buttons as contextual actions, a subtitle-search menu item, and info panel tabs for
/// X-Ray, playback details and how subtitles look.
struct TVPlayerController: UIViewControllerRepresentable {
    let session: PlaybackSession
    let model: AppModel
    let subtitleSettings: SubtitleSettings
    var onSubtitleSearch: () -> Void

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = session.player
        controller.delegate = context.coordinator
        controller.appliesPreferredDisplayCriteriaAutomatically = true
        // Flow's own subtitles go in the content overlay, which sits beneath the transport bar and info panel.
        let host = UIHostingController(rootView: TVContentOverlay(session: session, settings: subtitleSettings))
        host.view.backgroundColor = .clear
        host.view.isUserInteractionEnabled = false
        if let overlay = controller.contentOverlayView {
            controller.addChild(host)
            host.view.frame = overlay.bounds
            host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            overlay.addSubview(host.view)
            host.didMove(toParent: controller)
        }
        context.coordinator.subtitleHost = host
        // A "Details" tab in the info panel, beside Apple's own.
        let details = UIHostingController(rootView: PlaybackInfoPanel(session: session, card: false))
        details.title = "Details"
        details.view.backgroundColor = .clear
        details.preferredContentSize = CGSize(width: 0, height: 360)
        // X-Ray first: the cast, with whoever the dialogue names leading.
        let xray = UIHostingController(rootView: XRayTVPanel(session: session, model: model))
        xray.title = "X-Ray"
        xray.view.backgroundColor = .clear
        xray.preferredContentSize = CGSize(width: 0, height: 400)
        // How subtitles look, in steps the Siri Remote can click through; the subtitles on screen follow.
        let style = UIHostingController(rootView: SubtitleStyleTVPanel(model: model))
        style.title = "Subtitle Style"
        style.view.backgroundColor = .clear
        style.preferredContentSize = CGSize(width: 0, height: 440)
        controller.customInfoViewControllers = [xray, details, style]
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        context.coordinator.subtitleHost?.rootView = TVContentOverlay(session: session, settings: subtitleSettings)
        // The player cuts these buttons off at about fourteen characters, so their titles stay short.
        if session.asksStillWatching {
            controller.contextualActions = [UIAction(title: "Keep Watching", image: UIImage(systemName: "play.fill")) { _ in session.confirmStillWatching() }]
        } else if let segment = session.activeSegment {
            controller.contextualActions = [UIAction(title: segment.kind.buttonTitle, image: UIImage(systemName: "forward.end.fill")) { _ in session.skip(segment) }]
        } else if session.showsSuggestions, session.phase == .playing {
            controller.contextualActions = [UIAction(title: "More Like This", image: UIImage(systemName: "rectangle.stack")) { _ in session.endWithSuggestions() }]
        } else if let countdown = session.upNextCountdown {
            controller.contextualActions = [UIAction(title: "Up Next in \(countdown)", image: UIImage(systemName: "forward.fill")) { _ in
                Task { await session.playUpNext() }
            }]
        } else {
            controller.contextualActions = []
        }
        let search = UIAction(title: "Search Subtitles", image: UIImage(systemName: "magnifyingglass")) { _ in onSubtitleSearch() }
        var items: [UIMenuElement] = []
        if !session.bitmapTracks.isEmpty {
            // Picture subtitles from the disc: AVKit can't show them, so Flow draws them and offers its own menu.
            var choices: [UIMenuElement] = [UIAction(title: "Off", state: session.selectedBitmapTrack == nil ? .on : .off) { _ in session.selectBitmapSubtitle(nil) }]
            choices += session.bitmapTracks.map { track in
                UIAction(title: track.title, state: session.selectedBitmapTrack == track.id ? .on : .off) { _ in session.selectBitmapSubtitle(track.id) }
            }
            items.append(UIMenu(title: "Disc Subtitles", image: UIImage(systemName: "captions.bubble"), options: .singleSelection, children: choices))
        }
        items.append(search)
        // Disc Subtitles already has the captions bubble; this one goes back ten seconds.
        items.append(UIAction(title: "What Did They Say?", image: UIImage(systemName: "gobackward.10")) { _ in session.replayWithSubtitles() })
        items.append(UIAction(title: session.songs.isListening ? "Listening…" : "Identify Song", image: UIImage(systemName: "shazam.logo"),
                              attributes: session.songs.isListening ? .disabled : []) { _ in session.songs.identify(session) })
        if session.canAutoSync {
            let sync = UIAction(title: session.isAutoSyncing ? "Syncing Subtitles…" : "Auto-sync Subtitles (Beta)", image: UIImage(systemName: "waveform"),
                                attributes: session.isAutoSyncing ? .disabled : []) { _ in session.autoSyncSubtitles() }
            items.append(sync)
        }
        controller.transportBarCustomMenuItems = items
    }

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    final class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        let session: PlaybackSession
        var subtitleHost: UIHostingController<TVContentOverlay>?
        init(session: PlaybackSession) { self.session = session }

        func playerViewControllerShouldDismiss(_ playerViewController: AVPlayerViewController) -> Bool {
            Task { @MainActor in session.stop() }
            return true
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
