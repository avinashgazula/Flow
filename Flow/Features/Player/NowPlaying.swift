import Foundation
import AVFoundation
import FlowKit
#if os(iOS) || os(macOS)
import MediaPlayer
#endif
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Lock Screen, Control Center, headphone buttons and the Mac's media keys.
/// Apple TV's player view publishes all of this by itself.
@MainActor
final class NowPlaying {
    #if os(iOS) || os(macOS)
    private var targets: [(MPRemoteCommand, Any)] = []
    private var info: [String: Any] = [:]
    private var artworkTask: Task<Void, Never>?
    #endif

    struct Handlers {
        var play: () -> Void
        var pause: () -> Void
        var toggle: () -> Void
        var skip: (Double) -> Void
        var seek: (Double) -> Void
    }

    func begin(title: String, subtitle: String?, artwork: URL?, skipForward: Int, skipBackward: Int, handlers: Handlers) {
        #if os(iOS) || os(macOS)
        end()
        let center = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, _ action: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
            command.isEnabled = true
            targets.append((command, command.addTarget(handler: action)))
        }
        add(center.playCommand) { _ in handlers.play(); return .success }
        add(center.pauseCommand) { _ in handlers.pause(); return .success }
        add(center.togglePlayPauseCommand) { _ in handlers.toggle(); return .success }
        center.skipForwardCommand.preferredIntervals = [NSNumber(value: skipForward)]
        center.skipBackwardCommand.preferredIntervals = [NSNumber(value: skipBackward)]
        add(center.skipForwardCommand) { _ in handlers.skip(Double(skipForward)); return .success }
        add(center.skipBackwardCommand) { _ in handlers.skip(-Double(skipBackward)); return .success }
        add(center.changePlaybackPositionCommand) { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            handlers.seek(event.positionTime)
            return .success
        }
        info = [MPMediaItemPropertyTitle: title, MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue]
        if let subtitle { info[MPMediaItemPropertyArtist] = subtitle }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        artworkTask = Task { [weak self] in
            guard let artwork, let (data, _) = try? await URLSession.shared.data(from: artwork) else { return }
            #if canImport(UIKit)
            guard let image = UIImage(data: data) else { return }
            #else
            guard let image = NSImage(data: data) else { return }
            #endif
            let item = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            guard let self, !Task.isCancelled else { return }
            self.info[MPMediaItemPropertyArtwork] = item
            MPNowPlayingInfoCenter.default().nowPlayingInfo = self.info
        }
        #endif
    }

    func update(elapsed: Double, duration: Double, rate: Float) {
        #if os(iOS) || os(macOS)
        guard !info.isEmpty else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        info[MPNowPlayingInfoPropertyPlaybackRate] = rate
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        #if os(macOS)
        MPNowPlayingInfoCenter.default().playbackState = rate > 0 ? .playing : .paused
        #endif
        #endif
    }

    func end() {
        #if os(iOS) || os(macOS)
        artworkTask?.cancel()
        for (command, target) in targets { command.removeTarget(target) }
        targets = []
        info = [:]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        #endif
    }
}

/// Stops playback after a while, or when the current title ends.
enum SleepTimer: Hashable, Identifiable {
    case minutes(Int)
    case endOfItem

    var id: String { title }
    var title: String {
        switch self {
        case .minutes(let m): return m >= 60 ? "\(m / 60) Hour\(m >= 120 ? "s" : "")" : "\(m) Minutes"
        case .endOfItem: return "End of Episode or Movie"
        }
    }

    static let choices: [SleepTimer] = [.minutes(15), .minutes(30), .minutes(45), .minutes(60), .endOfItem]
}
