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
/// The system player on tvOS: Siri Remote scrubbing, info panel, audio/subtitle menus.
/// Flow adds skip buttons as contextual actions and a subtitle-search menu item.
struct TVPlayerController: UIViewControllerRepresentable {
    let session: PlaybackSession
    var onSubtitleSearch: () -> Void

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = session.player
        controller.delegate = context.coordinator
        controller.appliesPreferredDisplayCriteriaAutomatically = true
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if let segment = session.activeSegment {
            controller.contextualActions = [UIAction(title: segment.kind.buttonTitle, image: UIImage(systemName: "forward.end.fill")) { _ in session.skip(segment) }]
        } else if let countdown = session.upNextCountdown {
            controller.contextualActions = [UIAction(title: "Next Episode in \(countdown)", image: UIImage(systemName: "forward.fill")) { _ in
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
        controller.transportBarCustomMenuItems = items
    }

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    final class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        let session: PlaybackSession
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
