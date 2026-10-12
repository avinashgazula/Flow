import SwiftUI
import AVFoundation
import ShazamKit
import FlowKit

/// A song Shazam named, and where in the film it was playing.
struct SongMatch: Identifiable {
    let id = UUID()
    let item: SHMatchedMediaItem
    /// Playback time, in seconds, when it was heard.
    let at: Double

    var title: String { item.title ?? "Unknown Song" }
    var artist: String { item.artist ?? "" }
}

/// Names the song that's playing with ShazamKit.
///
/// Flow reads the soundtrack itself where it can: from its own remuxer for MKV files (so it works with
/// headphones in and on Apple TV, which has no microphone), or straight from a plain video file. Only for
/// streams it can't read (HLS) does it listen through the microphone, on iPhone, iPad and Mac.
@MainActor
@Observable
final class SongRecognizer {
    enum State: Equatable {
        case idle, listening, noMatch
        case matched(UUID)
        case failed(String)
    }

    private(set) var state: State = .idle
    /// Everything found while this title played, newest first.
    private(set) var found: [SongMatch] = []
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var dismissTask: Task<Void, Never>?

    var latest: SongMatch? {
        guard case .matched(let id) = state else { return nil }
        return found.first { $0.id == id }
    }

    var isListening: Bool { state == .listening }

    func identify(_ session: PlaybackSession) {
        guard !isListening else { return }
        dismissTask?.cancel()
        withAnimation(Theme.Motion.snappy) { state = .listening }
        let at = session.currentTime
        task = Task { [weak self] in
            let result = await Self.recognise(session)
            guard let self, !Task.isCancelled else { return }
            withAnimation(Theme.Motion.gentle) {
                switch result {
                case .success(let item?):
                    let match = SongMatch(item: item, at: at)
                    // The same song asked about twice moves to the top instead of appearing twice.
                    self.found.removeAll { $0.item.shazamID != nil && $0.item.shazamID == item.shazamID }
                    self.found.insert(match, at: 0)
                    self.state = .matched(match.id)
                case .success(nil): self.state = .noMatch
                case .failure(let error): self.state = .failed(error.message)
                }
            }
            self.scheduleDismiss(after: self.state == .noMatch ? 3 : 12)
        }
    }

    func dismiss() {
        task?.cancel()
        dismissTask?.cancel()
        withAnimation(Theme.Motion.gentle) { state = .idle }
    }

    #if !os(tvOS)
    /// Adds a song to the viewer's Shazam library, where Shazam and Control Center's recognition list it.
    func addToShazam(_ match: SongMatch) async -> Bool {
        do {
            try await SHLibrary.default.addItems([match.item])
            return true
        } catch {
            return false
        }
    }
    #endif

    private func scheduleDismiss(after seconds: Double) {
        dismissTask?.cancel()
        dismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.dismiss()
        }
    }

    // MARK: Recognition

    struct RecognitionError: Error {
        let message: String
    }

    private static func recognise(_ session: PlaybackSession) async -> Result<SHMatchedMediaItem?, RecognitionError> {
        if let clip = await session.soundtrackClip() {
            return await match(fileBytes: clip)
        }
        if let direct = session.directSoundtrack {
            let result = await match(url: direct.url, headers: direct.headers, from: session.currentTime)
            if case .success = result { return result }
        }
        #if os(tvOS)
        return .failure(RecognitionError(message: "This stream's soundtrack can't be read on Apple TV."))
        #else
        return await listen()
        #endif
    }

    /// A clip from the remuxer: written out as an MP4 file, which AVFoundation can then decode.
    private static func match(fileBytes: [UInt8]) async -> Result<SHMatchedMediaItem?, RecognitionError> {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("flow-song-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: url) }
        do {
            try Data(fileBytes).write(to: url)
        } catch {
            return .failure(RecognitionError(message: "Couldn't read the soundtrack."))
        }
        return await match(url: url, headers: [:], from: nil)
    }

    /// Decodes up to twelve seconds of `url`'s soundtrack, from `start` (or the beginning), and asks Shazam.
    private static func match(url: URL, headers: [String: String], from start: Double?) async -> Result<SHMatchedMediaItem?, RecognitionError> {
        let options: [String: Any] = headers.isEmpty ? [:] : ["AVURLAssetHTTPHeaderFieldsKey": headers]
        let asset = AVURLAsset(url: url, options: options)
        guard let track = try? await asset.loadTracks(withMediaType: .audio).first else {
            return .failure(RecognitionError(message: "No soundtrack to read."))
        }
        let signature: SHSignature
        do {
            signature = try await Task.detached(priority: .userInitiated) {
                try Self.signature(asset: asset, track: track, from: start)
            }.value
        } catch {
            return .failure(RecognitionError(message: "Couldn't read the soundtrack."))
        }
        return await match(signature)
    }

    nonisolated private static func signature(asset: AVAsset, track: AVAssetTrack, from start: Double?) throws -> SHSignature {
        let reader = try AVAssetReader(asset: asset)
        if let start {
            reader.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600), duration: CMTime(seconds: 12, preferredTimescale: 600))
        }
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 1, interleaved: false)!
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsNonInterleaved: true,
            AVLinearPCMIsBigEndianKey: false,
        ])
        reader.add(output)
        guard reader.startReading() else { throw reader.error ?? RecognitionError(message: "unreadable") }
        let generator = SHSignatureGenerator()
        var seconds = 0.0
        while seconds < 12, let sample = output.copyNextSampleBuffer() {
            let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sample))
            guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { continue }
            buffer.frameLength = frames
            let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList)
            guard status == noErr else { continue }
            try generator.append(buffer, at: nil)
            seconds += Double(frames) / 44_100
        }
        reader.cancelReading()
        guard seconds >= 3 else { throw RecognitionError(message: "too short") }
        return generator.signature()
    }

    private static func match(_ signature: SHSignature) async -> Result<SHMatchedMediaItem?, RecognitionError> {
        switch await SHSession().result(from: signature) {
        case .match(let match): return .success(match.mediaItems.first)
        case .noMatch: return .success(nil)
        case .error(let error, _): return .failure(describe(error))
        }
    }

    #if !os(tvOS)
    /// For streams Flow can't read: Shazam listens through the microphone for up to fifteen seconds.
    private static func listen() async -> Result<SHMatchedMediaItem?, RecognitionError> {
        let managed = SHManagedSession()
        let timeout = Task {
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            if !Task.isCancelled { managed.cancel() }
        }
        defer { timeout.cancel() }
        switch await managed.result() {
        case .match(let match): return .success(match.mediaItems.first)
        case .noMatch: return .success(nil)
        case .error(let error, _): return .failure(describe(error))
        }
    }
    #endif

    private static func describe(_ error: Error) -> RecognitionError {
        let nsError = error as NSError
        if nsError.domain == SHErrorDomain, nsError.code == SHError.Code.matchAttemptFailed.rawValue {
            return RecognitionError(message: "Shazam couldn't be reached. Check the connection, and that ShazamKit is enabled for this app's identifier.")
        }
        if nsError.domain == SHErrorDomain {
            return RecognitionError(message: "Shazam couldn't listen. Allow Flow to use the microphone in Settings.")
        }
        return RecognitionError(message: error.localizedDescription)
    }
}

/// The song card: listening, then the song with its artwork and links, top right over the picture.
struct SongCard: View {
    let recognizer: SongRecognizer
    @Environment(\.openURL) private var openURL
    @State private var added = false

    var body: some View {
        Group {
            switch recognizer.state {
            case .idle:
                EmptyView()
            case .listening:
                pill(icon: "shazam.logo.fill", text: "Listening…", animating: true)
            case .noMatch:
                pill(icon: "music.note", text: "No song found", animating: false)
            case .failed(let message):
                pill(icon: "exclamationmark.triangle.fill", text: message, animating: false)
            case .matched:
                if let match = recognizer.latest { card(match) }
            }
        }
        .transition(.opacity.combined(with: .scale(scale: 0.95, anchor: .topTrailing)))
        .onChange(of: recognizer.latest?.id) { _, _ in added = false }
    }

    private func pill(icon: String, text: String, animating: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .symbolEffect(.variableColor.iterative, isActive: animating)
            Text(text).lineLimit(2)
        }
        .font(.system(size: 14 * Theme.scale, weight: .semibold))
        .padding(.horizontal, 16 * Theme.scale).padding(.vertical, 10 * Theme.scale)
        .frame(maxWidth: 360 * Theme.scale)
        .flowGlass(Capsule(), tint: Theme.Palette.overPicture)
        .onTapGesture { recognizer.dismiss() }
    }

    private func card(_ match: SongMatch) -> some View {
        HStack(spacing: 14 * Theme.scale) {
            RemoteImage(url: match.item.artworkURL, maxPixel: 300, fallbackTitle: match.title)
                .frame(width: 64 * Theme.scale, height: 64 * Theme.scale)
                .clipShape(RoundedRectangle(cornerRadius: 10 * Theme.scale, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Label("Shazam", systemImage: "shazam.logo.fill")
                    .font(.system(size: 11 * Theme.scale, weight: .bold))
                    .foregroundStyle(Theme.Palette.textSecondary)
                Text(match.title).font(.system(size: 16 * Theme.scale, weight: .bold)).lineLimit(1)
                if !match.artist.isEmpty {
                    Text(match.artist).font(.system(size: 14 * Theme.scale)).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                }
                #if !os(tvOS)
                HStack(spacing: 8) {
                    if let url = match.item.appleMusicURL ?? match.item.webURL {
                        Button { openURL(url) } label: { Label(match.item.appleMusicURL != nil ? "Apple Music" : "Shazam", systemImage: "arrow.up.right") }
                    }
                    Button {
                        Task { added = await recognizer.addToShazam(match) }
                    } label: { Label(added ? "Added" : "My Shazam", systemImage: added ? "checkmark" : "plus") }
                    .disabled(added)
                }
                .font(.system(size: 12, weight: .semibold))
                .buttonStyle(.bordered)
                .controlSize(.small)
                .padding(.top, 4)
                #endif
            }
            Spacer(minLength: 0)
        }
        .padding(12 * Theme.scale)
        .frame(width: 340 * Theme.scale)
        .flowGlass(RoundedRectangle(cornerRadius: 20 * Theme.scale, style: .continuous), tint: Theme.Palette.overPicture)
        .overlay(alignment: .topTrailing) {
            #if !os(tvOS)
            Button { recognizer.dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).frame(width: 22, height: 22).background(.white.opacity(0.14), in: Circle())
            }
            .buttonStyle(.plain)
            .padding(8)
            .accessibilityLabel("Close")
            #endif
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Song: \(match.title)\(match.artist.isEmpty ? "" : " by \(match.artist)")")
    }
}
