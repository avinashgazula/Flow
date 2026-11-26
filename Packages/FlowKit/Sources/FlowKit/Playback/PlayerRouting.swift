import Foundation

/// Which engine plays a stream, and what happens when one of them gives up. The session feeds in what it has
/// learned (the container, what the remuxer found, what Apple's player reported) and acts on the answer.
public enum PlayerRouting {
    /// Shown when a stream goes to the built-in decoder because Apple's player can't play it.
    public static let builtInNotice = "Playing with Marquee's built-in decoder"

    // MARK: Where a stream starts

    public enum StartPath: Equatable, Sendable {
        /// The built-in decoder (libmpv). A notice says why when the viewer didn't choose it.
        case builtIn(notice: String?)
        /// Matroska, repackaged on the fly for Apple's player.
        case remux
        /// Apple's player straight on the link (MP4, HLS, TS, audio, and names that tell nothing).
        case apple
    }

    /// Whether a Matroska file goes to the external player from Settings first. The hand-off itself can
    /// still fail (none chosen, not installed), and then the stream plays here as usual.
    public static func triesExternalPlayer(container: ContainerDetector.Container, matroskaPlayback: MatroskaPlayback) -> Bool {
        container == .matroska && matroskaPlayback == .external
    }

    /// The first route for a stream. `builtInAlready` is a stream Apple's player already let go of: it stays in
    /// the built-in decoder, also when it reloads after a drop. `debugForcesBuiltIn` is the debug launch switch.
    public static func startPath(container: ContainerDetector.Container, builtInAlready: Bool, engine: PlayerEngine, debugForcesBuiltIn: Bool) -> StartPath {
        if builtInAlready || engine == .builtIn || debugForcesBuiltIn { return .builtIn(notice: nil) }
        switch container {
        case .matroska: return .remux
        // AVI, WMV, FLV, DVD and Ogg files: nothing on the Apple path opens them.
        case .unsupported: return .builtIn(notice: builtInNotice)
        case .native, .unknown: return .apple
        }
    }

    // MARK: After the remuxer has opened a file

    public enum RemuxVerdict: Equatable, Sendable {
        /// Hand the stream to Apple's player through the remuxer.
        case proceed
        /// This device can't play what the remuxer found: the built-in decoder takes it.
        case builtIn
    }

    /// AV1 with no decoder in this device, or a soundtrack made only of audio Apple's player can't decode
    /// (with audio that was skipped), go to the built-in decoder. A file with no audio at all is not that.
    public static func afterRemuxOpened(videoCodecID: String?, deviceDecodesAV1: Bool, hasPlayableSoundtrack: Bool, skippedAudioCount: Int) -> RemuxVerdict {
        if videoCodecID == "V_AV1", !deviceDecodesAV1 { return .builtIn }
        if !hasPlayableSoundtrack, skippedAudioCount > 0 { return .builtIn }
        return .proceed
    }

    /// For an error that isn't Matroska's own (a network error while opening, say).
    public static func couldntOpen(_ description: String) -> String { "Couldn't open this file. \(description)" }

    // MARK: When Apple's player fails an item

    public enum ItemFailureAction: Equatable, Sendable {
        /// Remux again without Dolby Vision and Atmos signalling.
        case reloadCompatibleRemux
        /// The built-in decoder takes over, where Apple's player stopped.
        case switchToBuiltIn
        /// A dropped connection: reconnect where it stopped, after a short wait.
        case reconnect
        case showError
    }

    public struct ItemFailureInput: Equatable, Sendable {
        public var didStart: Bool
        public var usesRemux: Bool
        public var remuxIsCompatible: Bool
        /// Compatible remux can remove Dolby Vision or Atmos signalling from the stream.
        public var remuxHasDolbyVisionOrAtmos: Bool
        public var builtInAlreadyRunning: Bool
        /// The AVFoundation error's code, nil when the error isn't in that domain (or there is none).
        public var appleErrorCode: Int?
        public var canStartBuiltIn: Bool
        public var recoveries: Int
        /// Seconds since the last reconnect, nil if there was none.
        public var secondsSinceLastRecovery: Double?

        public init(didStart: Bool, usesRemux: Bool, remuxIsCompatible: Bool, remuxHasDolbyVisionOrAtmos: Bool, builtInAlreadyRunning: Bool,
                    appleErrorCode: Int?, canStartBuiltIn: Bool, recoveries: Int, secondsSinceLastRecovery: Double?) {
            self.didStart = didStart
            self.usesRemux = usesRemux
            self.remuxIsCompatible = remuxIsCompatible
            self.remuxHasDolbyVisionOrAtmos = remuxHasDolbyVisionOrAtmos
            self.builtInAlreadyRunning = builtInAlreadyRunning
            self.appleErrorCode = appleErrorCode
            self.canStartBuiltIn = canStartBuiltIn
            self.recoveries = recoveries
            self.secondsSinceLastRecovery = secondsSinceLastRecovery
        }
    }

    public struct ItemFailureDecision: Equatable, Sendable {
        public var action: ItemFailureAction
        /// The reconnect count to keep: reset after a long quiet spell, and one more when reconnecting.
        public var recoveries: Int
    }

    /// AVFoundation format and decoder errors that a different engine may be able to play.
    static let appleFormatErrorCodes: Set<Int> = [-11821, -11828, -11829, -11833, -11834, -11839, -11848, -11853, -11855, -11864, -11868]
    private static let decodeFailuresDuringPlayback: Set<Int> = [-11821, -11833, -11855, -11864, -11868]

    /// Reconnects allowed before the error screen, and how long a quiet spell makes the count start again.
    static let maxReconnects = 2
    static let reconnectForgetAfter: Double = 600

    /// Apple's player turned a stream down because of its format, or the stream is Marquee's own repackaging
    /// that Apple's player won't take (a 10-bit H.264 an iPhone's decoder refuses): the built-in decoder tries it.
    public static func shouldRetryInBuiltIn(builtInAlreadyRunning: Bool, usesRemux: Bool, appleErrorCode: Int?) -> Bool {
        guard !builtInAlreadyRunning else { return false }
        if usesRemux { return true }
        guard let appleErrorCode else { return false }
        return appleFormatErrorCodes.contains(appleErrorCode)
    }

    public static func onItemFailure(_ input: ItemFailureInput) -> ItemFailureDecision {
        // Some devices turn down a stream's Dolby Vision or Atmos signalling; the HDR10 picture and
        // 5.1 bed underneath still play, so try that once before giving up.
        if !input.didStart, input.usesRemux, !input.remuxIsCompatible, input.remuxHasDolbyVisionOrAtmos {
            return ItemFailureDecision(action: .reloadCompatibleRemux, recoveries: input.recoveries)
        }
        if input.canStartBuiltIn, !input.builtInAlreadyRunning {
            let failedToStart = !input.didStart &&
                shouldRetryInBuiltIn(builtInAlreadyRunning: false, usesRemux: input.usesRemux, appleErrorCode: input.appleErrorCode)
            let lostDecoder = input.didStart && input.appleErrorCode.map(decodeFailuresDuringPlayback.contains) == true
            if failedToStart || lostDecoder {
                return ItemFailureDecision(action: .switchToBuiltIn, recoveries: input.recoveries)
            }
        }
        // Drops far apart in a long film are separate bad moments, not a dead stream: each gets its own tries.
        var recoveries = input.recoveries
        if let since = input.secondsSinceLastRecovery, since > reconnectForgetAfter { recoveries = 0 }
        if input.didStart, recoveries < maxReconnects {
            return ItemFailureDecision(action: .reconnect, recoveries: recoveries + 1)
        }
        return ItemFailureDecision(action: .showError, recoveries: recoveries)
    }

    /// The built-in decoder's own failure: the same couple of reconnects mid-film as Apple's player, and the same
    /// fresh tries for a drop that comes long after the last one.
    public static func onBuiltInFailure(didStart: Bool, recoveries: Int, secondsSinceLastRecovery: Double? = nil) -> ItemFailureDecision {
        var recoveries = recoveries
        if let since = secondsSinceLastRecovery, since > reconnectForgetAfter { recoveries = 0 }
        if didStart, recoveries < maxReconnects {
            return ItemFailureDecision(action: .reconnect, recoveries: recoveries + 1)
        }
        return ItemFailureDecision(action: .showError, recoveries: recoveries)
    }

    // MARK: A remuxed start that never gets going

    /// Seconds a remuxed file on this device may take to start before it counts as stuck.
    public static let stallSeconds = 20

    /// Only a remuxed file on this device is certainly stuck when it starts slowly; a link can honestly take longer.
    public static func watchesForStall(usesRemux: Bool, remuxesLocalFile: Bool) -> Bool { usesRemux && remuxesLocalFile }

    /// Whether, after the wait, the start is still the same stuck one: the player is open, this item is the one
    /// on screen, nothing has played, no resume question is waiting and the loading screen is still up.
    public static func isStillStalled(isClosed: Bool, isCurrentItem: Bool, didStart: Bool, resumeQuestionShowing: Bool, isConnecting: Bool) -> Bool {
        !isClosed && isCurrentItem && !didStart && !resumeQuestionShowing && isConnecting
    }

    public enum StallAction: Equatable, Sendable {
        case loadAgain
        case giveUp
    }

    /// Load it again once (finished segments are kept, so that is quick); a second stall ends in the error screen.
    public static func afterStall(alreadyRetried: Bool) -> StallAction { alreadyRetried ? .giveUp : .loadAgain }

    public static func stallFailureDetail(itemStatus: Int) -> String { "No picture after \(stallSeconds) s twice (item status \(itemStatus))" }
    public static let stallFailureMessage = "This file didn't start. Try again, or try another source."

    // MARK: When a source fails

    public enum SourceFailureAction: Equatable, Sendable {
        case tryNextSource
        case showError
    }

    /// A source that fails before anything played moves on quietly to the next one, when the viewer allows it.
    /// Once something has played, a failure is shown, not hidden by a different source.
    public static func afterSourceFailure(didStart: Bool, tryNextEnabled: Bool, alternativesLeft: Int) -> SourceFailureAction {
        !didStart && tryNextEnabled && alternativesLeft > 0 ? .tryNextSource : .showError
    }

    /// A slate counts as a failed source whether or not it began to play.
    public static func afterSlate(tryNextEnabled: Bool, alternativesLeft: Int) -> SourceFailureAction {
        tryNextEnabled && alternativesLeft > 0 ? .tryNextSource : .showError
    }

    /// The error screen offers "Try Another Source" while another source is left.
    public static func offersAnotherSource(alternativesLeft: Int) -> Bool { alternativesLeft > 0 }
}

/// The notices the player shows for source changes and engine choices. Plain sentences that say what happened.
public enum PlayerNotices {
    /// `resolutionLabel` is nil when the next source's resolution is unknown.
    public static func tryingNextSource(provider: String, resolutionLabel: String?) -> String {
        "That source didn't work, so Marquee is trying \(provider)\(resolutionLabel.map { " " + $0 } ?? "")."
    }

    /// "1080p BluRay" tells one AIOStreams source from another; the provider's name alone doesn't.
    public static func switchingSource(provider: String, resolutionLabel: String?, qualityLabel: String?) -> String {
        let release = [resolutionLabel, qualityLabel].compactMap { $0 }.joined(separator: " ")
        return "Switching to \(release.isEmpty ? provider : release)…"
    }

    public static let reconnecting = "Connection lost. Reconnecting…"

    /// For a soundtrack Apple's player can't decode when the remuxer plays another one instead.
    /// `decodersAvailable` is whether this build can decode such audio itself (a Settings switch turns that on).
    public static func skippedAudio(reason: String, decodersAvailable: Bool, playing: String) -> String {
        reason + (decodersAvailable ? " can't play on Apple devices. " : ": turn on Decode Audio Apple Can't Play in Settings. ") + "Playing \(playing) instead."
    }
}
