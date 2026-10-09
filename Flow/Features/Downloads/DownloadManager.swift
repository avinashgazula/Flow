import SwiftUI
import Observation
import FlowKit

struct DownloadItem: Codable, Identifiable, Hashable {
    enum State: String, Codable { case queued, downloading, finished, failed }
    var id: String
    var request: PlaybackRequest
    var sourceTitle: String
    var remoteURL: URL
    var headers: [String: String]
    var fileName: String
    var state: State
    var progress: Double
    var bytes: Int64?
    var error: String?
    var createdAt: Date
}

/// Background-capable file downloads for offline playback (iOS / macOS).
@MainActor
@Observable
final class DownloadManager: NSObject {
    static let shared = DownloadManager()

    private(set) var items: [DownloadItem] = []
    @ObservationIgnored private let store = JSONFileStore.applicationSupport("FlowDownloads")
    @ObservationIgnored private var tasks: [String: URLSessionDownloadTask] = [:]
    @ObservationIgnored private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.allowsExpensiveNetworkAccess = true
        config.timeoutIntervalForResource = 60 * 60 * 12
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()

    static var directory: URL {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    override init() {
        super.init()
        items = store.load([DownloadItem].self, "downloads") ?? []
        // Anything interrupted by quitting is marked failed so it can be retried.
        for i in items.indices where items[i].state == .downloading || items[i].state == .queued {
            items[i].state = .failed
            items[i].error = "Interrupted"
        }
    }

    func localURL(for item: DownloadItem) -> URL { Self.directory.appendingPathComponent(item.fileName) }

    /// Queues a download; returns an error message when the source can't be saved.
    @discardableResult
    func start(source: StreamSource, request: PlaybackRequest) -> String? {
        guard let url = source.location.playableURL else { return "This source can't be downloaded." }
        if url.pathExtension.lowercased() == "m3u8" {
            return "This source is a stream (HLS) and can't be saved. Pick a file source instead."
        }
        let ext = url.pathExtension.isEmpty ? "mp4" : url.pathExtension
        let safeTitle = request.displayTitle.replacingOccurrences(of: "[^A-Za-z0-9 ._-]", with: "", options: .regularExpression)
        let item = DownloadItem(id: UUID().uuidString, request: request, sourceTitle: source.providerName, remoteURL: url, headers: source.location.headers,
                                fileName: "\(safeTitle)-\(UUID().uuidString.prefix(6)).\(ext)", state: .queued, progress: 0, bytes: source.traits.sizeBytes, error: nil, createdAt: Date())
        items.insert(item, at: 0)
        resume(item)
        save()
        return nil
    }

    func resume(_ item: DownloadItem) {
        var request = URLRequest(url: item.remoteURL)
        for (k, v) in item.headers { request.setValue(v, forHTTPHeaderField: k) }
        let task = session.downloadTask(with: request)
        task.taskDescription = item.id
        tasks[item.id] = task
        update(item.id) { $0.state = .downloading; $0.error = nil }
        task.resume()
    }

    func cancel(_ item: DownloadItem) {
        tasks[item.id]?.cancel()
        tasks[item.id] = nil
        remove(item)
    }

    func remove(_ item: DownloadItem) {
        try? FileManager.default.removeItem(at: localURL(for: item))
        items.removeAll { $0.id == item.id }
        save()
    }

    func finished(for request: PlaybackRequest) -> DownloadItem? {
        items.first { $0.request.id == request.id && $0.state == .finished }
    }

    /// A playable source pointing at the downloaded file.
    func localSource(for item: DownloadItem) -> StreamSource {
        StreamSource(id: "download#\(item.id)", category: .mediaServers, providerID: "downloads", providerName: "Downloaded",
                     title: item.sourceTitle, filename: item.fileName, location: .url(localURL(for: item), headers: [:]))
    }

    private func update(_ id: String, _ change: (inout DownloadItem) -> Void) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[i])
    }

    private func save() { store.save(items, "downloads") }

    var totalBytes: Int64 {
        items.filter { $0.state == .finished }.reduce(0) { total, item in
            let size = (try? FileManager.default.attributesOfItem(atPath: localURL(for: item).path)[.size] as? Int64) ?? 0
            return total + size
        }
    }
}

extension DownloadManager: URLSessionDownloadDelegate {
    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let id = downloadTask.taskDescription else { return }
        let progress = totalBytesExpectedToWrite > 0 ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite) : 0
        MainActor.assumeIsolated {
            update(id) { item in
                item.progress = progress
                if totalBytesExpectedToWrite > 0 { item.bytes = totalBytesExpectedToWrite }
            }
        }
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = downloadTask.taskDescription else { return }
        // The temp file is deleted when this method returns, so move it synchronously.
        let staging = FileManager.default.temporaryDirectory.appendingPathComponent(id)
        try? FileManager.default.removeItem(at: staging)
        let moved = (try? FileManager.default.moveItem(at: location, to: staging)) != nil
        MainActor.assumeIsolated {
            guard let item = items.first(where: { $0.id == id }) else { return }
            let destination = localURL(for: item)
            try? FileManager.default.removeItem(at: destination)
            if moved, (try? FileManager.default.moveItem(at: staging, to: destination)) != nil {
                update(id) { $0.state = .finished; $0.progress = 1 }
            } else {
                update(id) { $0.state = .failed; $0.error = "Couldn't save the file." }
            }
            tasks[id] = nil
            save()
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let id = task.taskDescription else { return }
        let message = error.localizedDescription
        MainActor.assumeIsolated {
            if (error as? URLError)?.code == .cancelled { return }
            update(id) { $0.state = .failed; $0.error = message }
            tasks[id] = nil
            save()
        }
    }
}

struct DownloadsView: View {
    @Environment(AppModel.self) private var model
    @State private var manager = DownloadManager.shared

    var body: some View {
        List {
            if manager.items.isEmpty {
                ContentUnavailableView("No Downloads", systemImage: "arrow.down.circle",
                                       description: Text("Tap the download button on a movie or episode to save it for offline viewing."))
            }
            ForEach(manager.items) { item in
                Button {
                    if item.state == .finished {
                        model.startPlayback(manager.localSource(for: item), request: item.request)
                    } else if item.state == .failed {
                        manager.resume(item)
                    }
                } label: {
                    HStack(spacing: 12) {
                        RemoteImage(url: item.request.item.posterURL)
                            .frame(width: 50, height: 75)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.request.displayTitle).font(.headline).lineLimit(1)
                            switch item.state {
                            case .downloading, .queued:
                                ProgressView(value: item.progress)
                                Text("\(Int(item.progress * 100))%" + (item.bytes.map { " of " + StreamParser.formatBytes($0) } ?? ""))
                                    .font(.caption).foregroundStyle(.secondary)
                            case .finished:
                                Text(item.bytes.map(StreamParser.formatBytes) ?? "Ready").font(.caption).foregroundStyle(.secondary)
                            case .failed:
                                Text(item.error ?? "Failed — tap to retry").font(.caption).foregroundStyle(.orange)
                            }
                        }
                        Spacer()
                        if item.state == .finished { Image(systemName: "play.circle.fill").font(.title2) }
                    }
                }
                .buttonStyle(.plain)
                #if !os(tvOS)
                .swipeActions {
                    Button(role: .destructive) { manager.cancel(item) } label: { Label("Delete", systemImage: "trash") }
                }
                #endif
                .contextMenu {
                    Button(role: .destructive) { manager.cancel(item) } label: { Label("Delete", systemImage: "trash") }
                }
            }
        }
        .navigationTitle("Downloads")
    }
}
