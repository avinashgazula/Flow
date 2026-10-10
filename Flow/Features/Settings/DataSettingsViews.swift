import SwiftUI
import UniformTypeIdentifiers
import FlowKit

struct DataStorageView: View {
    @Environment(AppModel.self) private var model
    @State private var statuses: [CloudDomainStatus] = []
    @State private var usedBytes = 0
    @State private var cacheBytes: Int64 = 0
    @State private var downloadBytes: Int64 = 0
    @State private var exportURL: URL?
    @State private var confirmClear: ClearAction?

    enum ClearAction: String, Identifiable {
        case trakt, rewatches, shuffle, progress, resetCloud, allCache, cloud, downloads, tracking
        var id: String { rawValue }
        var title: String {
            switch self {
            case .trakt: return "Clear Trakt Cache"
            case .rewatches: return "Clear Rewatches"
            case .shuffle: return "Clear Shuffle History"
            case .progress: return "Reset Playback Progress"
            case .resetCloud: return "Reset iCloud Copy"
            case .allCache: return "Clear All Cache"
            case .cloud: return "Erase iCloud Data"
            case .downloads: return "Delete All Downloads"
            case .tracking: return "Delete All Tracking Data"
            }
        }
        var message: String? {
            switch self {
            case .progress: return "Clears the resume positions saved on this device."
            case .resetCloud: return "Deletes the iCloud copy and uploads this device's in its place."
            case .tracking: return "Erases your on-device watch history, watchlist, favourites, resume positions and rewatches, including the iCloud copy. This can't be undone."
            default: return nil
            }
        }
    }

    var body: some View {
        @Bindable var model = model
        List {
            Section {
                Toggle("iCloud Sync", isOn: $model.settings.sync.iCloudEnabled)
                if model.settings.sync.iCloudEnabled {
                    ForEach(statuses) { status in
                        HStack {
                            Image(systemName: "checkmark.circle").foregroundStyle(.green)
                            Text(status.domain.title).foregroundStyle(.green)
                            Spacer()
                            Text(detail(status)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    HStack {
                        Image(systemName: "checkmark.circle").foregroundStyle(.green)
                        Text("iCloud Storage").foregroundStyle(.green)
                        Spacer()
                        Text("\(ByteCountFormatter.string(fromByteCount: Int64(usedBytes), countStyle: .file)) of 1 MB").font(.caption).foregroundStyle(.secondary)
                    }
                    Button { model.pushToCloud(); refresh() } label: { Label("Push to iCloud", systemImage: "icloud.and.arrow.up") }
                    if let last = model.settings.sync.lastCloudSync {
                        LabeledContent("Last Synced") { Text(last, style: .relative) + Text(" ago") }
                    }
                }
            } header: {
                Text("iCloud")
            } footer: {
                Text("Syncs playback progress, settings, rewatch state, and shuffle history across your devices. Push also syncs your on-device watchlist, watch history and favourites through iCloud.")
            }

            Section {
                Button { confirmClear = .trakt } label: { Label("Clear Trakt Cache", systemImage: "arrow.triangle.2.circlepath") }
                Button { confirmClear = .rewatches } label: { Label("Clear Rewatches", systemImage: "arrow.counterclockwise") }
                Button { confirmClear = .shuffle } label: { Label("Clear Shuffle History", systemImage: "shuffle") }
                Button(role: .destructive) { confirmClear = .progress } label: {
                    LabeledContent {
                        Text(progressCount == 1 ? "1 item" : "\(progressCount) items").foregroundStyle(.red)
                    } label: {
                        Label("Reset Playback Progress", systemImage: "gobackward")
                    }
                }
            } header: {
                Text("Cache")
            } footer: {
                Text("Clearing the Trakt cache re-fetches your watchlist, history and progress from Trakt.")
            }

            Section {
                if model.settings.sync.iCloudEnabled {
                    Button { model.pullFromCloud(); refresh() } label: { Label("Re-download from iCloud", systemImage: "icloud.and.arrow.down") }
                    Button { confirmClear = .resetCloud } label: { Label("Reset iCloud Copy", systemImage: "icloud.and.arrow.up") }
                }
                #if !os(tvOS)
                if let exportURL {
                    ShareLink(item: exportURL) { Label("Export Tracking Data", systemImage: "square.and.arrow.up") }
                }
                #endif
            } header: {
                Text("On-Device Tracking")
            } footer: {
                Text((model.settings.sync.iCloudEnabled ? "Re-download reads the whole iCloud copy and merges anything missing into this device; nothing is uploaded or deleted. Reset replaces the iCloud copy with this device's. " : "")
                     + "Export saves your watch history, watchlist, favourites, resume positions and rewatches as a JSON file.")
            }

            if Platform.supportsDownloads {
                Section {
                    LabeledContent("Storage Used", value: ByteCountFormatter.string(fromByteCount: downloadBytes, countStyle: .file))
                    #if os(iOS)
                    Picker("Download Location", selection: $model.settings.downloads.location) {
                        ForEach(DownloadLocation.allCases) { Text($0.title).tag($0) }
                    }
                    #endif
                    NavigationLink(value: Route.downloads) { Label("Manage Downloads", systemImage: "arrow.down.circle") }
                } header: {
                    Text("Downloads")
                } footer: {
                    #if os(iOS)
                    Text("Files App keeps downloads in Flow's folder in the Files app, so you can copy them off this device. App Storage keeps them inside Flow and out of backups. Downloads already saved stay where they are.")
                    #else
                    Text("Downloads are saved for watching offline.")
                    #endif
                }

                Section {
                    Picker("Movies", selection: $model.settings.downloads.movieLimitGB) {
                        ForEach(Self.sizeLimits, id: \.self) { Text(Self.limitTitle($0)).tag($0) }
                    }
                    Picker("TV Episodes", selection: $model.settings.downloads.episodeLimitGB) {
                        ForEach(Self.sizeLimits, id: \.self) { Text(Self.limitTitle($0)).tag($0) }
                    }
                    Picker("Resolution", selection: $model.settings.downloads.resolution) {
                        ForEach(Self.resolutions) { Text($0 == .unknown ? "Highest Available" : $0.label).tag($0) }
                    }
                    Toggle("Download Automatically", isOn: $model.settings.downloads.downloadAutomatically)
                } header: {
                    Text("Download Limits")
                } footer: {
                    Text("Applies to downloads only: playing still offers every source. With Download Automatically on, Download takes the best source within these limits, in your source order, and the source list opens only when nothing fits. Sources that don't report their size or resolution aren't picked automatically.")
                }
            }

            Section {
                Button(role: .destructive) { confirmClear = .allCache } label: {
                    LabeledContent { Text(ByteCountFormatter.string(fromByteCount: cacheBytes, countStyle: .file)) } label: {
                        Label("Clear All Cache", systemImage: "trash")
                    }
                }
                if Platform.supportsDownloads {
                    Button(role: .destructive) { confirmClear = .downloads } label: { Label("Delete All Downloads", systemImage: "arrow.down.circle") }
                }
                Button(role: .destructive) { confirmClear = .cloud } label: { Label("Erase iCloud Data", systemImage: "icloud.slash") }
                Button(role: .destructive) { confirmClear = .tracking } label: { Label("Delete All Tracking Data", systemImage: "person.crop.circle.badge.xmark") }
            } header: {
                Text("Danger Zone")
            } footer: {
                Text("Clear All Cache removes artwork, metadata and stream header caches; they download again as needed. Delete All Tracking Data erases your on-device history, watchlist, favourites, resume positions and rewatches, along with their iCloud copy. It can't be undone.")
            }
        }
        .onAppear { refresh() }
        .confirmationDialog(confirmClear?.title ?? "", isPresented: Binding(get: { confirmClear != nil }, set: { if !$0 { confirmClear = nil } }), titleVisibility: .visible) {
            Button(confirmClear?.title ?? "Clear", role: .destructive) { perform(confirmClear) }
            Button("Cancel", role: .cancel) {}
        } message: {
            if let message = confirmClear?.message { Text(message) }
        }
    }

    private static let sizeLimits: [Double?] = [nil, 2, 5, 10, 20, 40]
    private static let resolutions: [VideoResolution] = [.unknown, .uhd4k, .hd1080, .hd720]

    private static func limitTitle(_ gb: Double?) -> String {
        gb.map { "\(Int($0)) GB" } ?? "No Limit"
    }

    private var progressCount: Int { model.localLibrary.progress.count }

    private func detail(_ status: CloudDomainStatus) -> String {
        let cloud = status.cloudCount.map { "\($0) cloud" } ?? "—"
        if status.domain == .playbackProgress && model.settings.account.tracker != .local {
            return "\(status.localCount) local · via \(model.settings.account.tracker.displayName)"
        }
        return "\(status.localCount) local · \(cloud)"
    }

    private func refresh() {
        statuses = model.cloud.status(settings: model.settings, library: model.localLibrary)
        usedBytes = model.cloud.usedBytes
        cacheBytes = JSONFileStore.caches("FlowResponses").sizeInBytes + JSONFileStore.caches("FlowMatroskaHeaders").sizeInBytes + Int64(URLCache.shared.currentDiskUsage)
        downloadBytes = DownloadManager.shared.totalBytes
        exportURL = model.exportTrackingData()
    }

    private func perform(_ action: ClearAction?) {
        guard let action else { return }
        Task {
            switch action {
            case .trakt: await model.clearTrackerCache()
            case .rewatches: await model.clearRewatches()
            case .shuffle: await model.clearShuffleHistory()
            case .progress: await model.resetPlaybackProgress()
            case .resetCloud: model.resetCloudCopy()
            case .allCache: await model.clearAllCaches()
            case .cloud:
                model.cloud.clear()
                model.showToast("iCloud data erased")
            case .downloads:
                for item in DownloadManager.shared.items { DownloadManager.shared.remove(item) }
                model.showToast("Downloads deleted")
            case .tracking: await model.deleteAllTrackingData()
            }
            refresh()
        }
    }
}

struct ShareSetupView: View {
    @Environment(AppModel.self) private var model
    @State private var includeSecrets = false
    @State private var link = ""
    @State private var fileURL: URL?

    var body: some View {
        Form {
            Section {
                Toggle("Include API Keys & Passwords", isOn: $includeSecrets)
            } footer: {
                Text("Exports every setting — shelves, sources, add-ons, servers, IPTV providers. Leave keys out when sharing with someone else. Tracker sign-ins are never exported.")
            }
            if let qr = QRCode.image(for: link), link.count < 2800 {
                Section("Scan on another device") {
                    qr.interpolation(.none).resizable().scaledToFit().frame(maxWidth: 280).padding(12)
                        .background(.white, in: RoundedRectangle(cornerRadius: 14))
                        .frame(maxWidth: .infinity)
                }
            } else {
                Section { Text("Your setup is too large for a QR code — share the file or link instead.").foregroundStyle(.secondary) }
            }
            #if !os(tvOS)
            Section {
                if let fileURL {
                    ShareLink(item: fileURL) { Label("Share Setup File", systemImage: "square.and.arrow.up") }
                }
                ShareLink(item: link) { Label("Share Setup Link", systemImage: "link") }
                Button { Platform.copyToPasteboard(link) ; model.showToast("Copied") } label: { Label("Copy Link", systemImage: "doc.on.doc") }
            }
            #endif
        }
        .task(id: includeSecrets) { build() }
    }

    private func build() {
        link = (try? SetupShare.exportLink(settings: model.settings, credentials: model.credentials, includeSecrets: includeSecrets)) ?? ""
        if let data = try? SetupShare.export(settings: model.settings, credentials: model.credentials, includeSecrets: includeSecrets) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("Flow Setup.json")
            try? data.write(to: url, options: .atomic)
            fileURL = url
        }
    }
}

struct ImportSetupView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var bundle: SetupBundle?
    @State private var error: String?
    @State private var showImporter = false

    var body: some View {
        Form {
            Section {
                TextField("Setup link or JSON", text: $text, prompt: Text("flow://setup?d=…"), axis: .vertical)
                    .lineLimit(1...6)
                    .autocorrectionDisabled()
                #if !os(tvOS)
                Button("Paste") { text = Platform.pasteboardString() ?? "" }
                Button("Choose File…") { showImporter = true }
                #endif
                Button("Read Setup") { parse(Data(text.utf8)) }.disabled(text.isEmpty)
            } footer: {
                Text("Paste a link from Share Setup, scan its QR code with your camera, or pick an exported file.")
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
            if let bundle {
                Section("This setup contains") {
                    LabeledContent("Shelves", value: "\(bundle.settings.shelves.count)")
                    LabeledContent("Media Servers", value: "\(bundle.settings.mediaServers.servers.count)")
                    LabeledContent("WebDAV Shares", value: "\(bundle.settings.webDAV.count)")
                    LabeledContent("IPTV Providers", value: "\(bundle.settings.liveTV.providers.count)")
                    LabeledContent("Stream Add-ons", value: "\(bundle.settings.sources.addons.count)")
                    LabeledContent("API Keys", value: bundle.credentials == nil ? "Not included" : "Included")
                    LabeledContent("Exported", value: bundle.exportedAt.formatted(date: .abbreviated, time: .shortened))
                }
                Section {
                    Button("Import and Replace My Setup") { apply(bundle) }
                        .buttonStyle(.borderedProminent)
                } footer: {
                    Text("Keys, tokens and passwords already on this device are kept unless the import includes new ones.")
                }
            }
        }
        .navigationTitle("Import Setup")
        .onAppear {
            if let pending = model.pendingImport {
                text = pending
                parse(Data(pending.utf8))
            }
        }
        #if !os(tvOS)
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json, .plainText]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url) { parse(data) }
        }
        #endif
    }

    private func parse(_ data: Data) {
        do {
            bundle = try SetupShare.importBundle(data)
            error = nil
        } catch {
            bundle = nil
            self.error = "That isn't a Flow setup."
        }
    }

    private func apply(_ bundle: SetupBundle) {
        let (settings, credentials) = SetupShare.apply(bundle, to: model.settings, credentials: model.credentials)
        model.credentials = credentials
        model.settings = settings
        model.pendingImport = nil
        model.showToast("Setup imported")
        dismiss()
    }
}
