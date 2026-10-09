import SwiftUI
import UniformTypeIdentifiers
import FlowKit

struct DataStorageView: View {
    @Environment(AppModel.self) private var model
    @State private var statuses: [CloudDomainStatus] = []
    @State private var usedBytes = 0
    @State private var cacheBytes: Int64 = 0
    @State private var confirmClear: ClearAction?

    enum ClearAction: String, Identifiable {
        case trakt, rewatches, shuffle, responses, cloud, downloads
        var id: String { rawValue }
        var title: String {
            switch self {
            case .trakt: return "Clear Trakt Cache"
            case .rewatches: return "Clear Rewatches"
            case .shuffle: return "Clear Shuffle History"
            case .responses: return "Clear Metadata Cache"
            case .cloud: return "Erase iCloud Data"
            case .downloads: return "Delete All Downloads"
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
                    Button { model.pullFromCloud(); refresh() } label: { Label("Pull from iCloud", systemImage: "icloud.and.arrow.down") }
                    if let last = model.settings.sync.lastCloudSync {
                        LabeledContent("Last Synced") { Text(last, style: .relative) + Text(" ago") }
                    }
                }
            } header: {
                Text("iCloud")
            } footer: {
                Text("Syncs playback progress, settings, rewatch state, and shuffle history across your devices. Push and Pull also sync your on-device watchlist, watch history and favourites through iCloud.")
            }

            Section("Cache") {
                Button { confirmClear = .trakt } label: { Label("Clear Trakt Cache", systemImage: "arrow.triangle.2.circlepath") }
                Button { confirmClear = .rewatches } label: { Label("Clear Rewatches", systemImage: "arrow.counterclockwise") }
                Button { confirmClear = .shuffle } label: { Label("Clear Shuffle History", systemImage: "shuffle") }
                Button { confirmClear = .responses } label: {
                    LabeledContent { Text(ByteCountFormatter.string(fromByteCount: cacheBytes, countStyle: .file)) } label: {
                        Label("Clear Metadata Cache", systemImage: "trash")
                    }
                }
            }
            Section {
                if Platform.supportsDownloads {
                    Button(role: .destructive) { confirmClear = .downloads } label: { Label("Delete All Downloads", systemImage: "arrow.down.circle") }
                }
                Button(role: .destructive) { confirmClear = .cloud } label: { Label("Erase iCloud Data", systemImage: "icloud.slash") }
            }
        }
        .onAppear { refresh() }
        .confirmationDialog(confirmClear?.title ?? "", isPresented: Binding(get: { confirmClear != nil }, set: { if !$0 { confirmClear = nil } }), titleVisibility: .visible) {
            Button(confirmClear?.title ?? "Clear", role: .destructive) { perform(confirmClear) }
            Button("Cancel", role: .cancel) {}
        }
    }

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
        cacheBytes = JSONFileStore.caches("FlowResponses").sizeInBytes
    }

    private func perform(_ action: ClearAction?) {
        guard let action else { return }
        Task {
            switch action {
            case .trakt:
                model.settings.sync.lastTrackerSync = nil
                await model.refreshLibrary(force: true)
            case .rewatches:
                await model.local.clearRewatches()
            case .shuffle:
                await model.local.clearShuffleHistory()
            case .responses:
                await model.catalog?.clearCache()
                await model.cache.clear()
            case .cloud:
                model.cloud.clear()
            case .downloads:
                for item in DownloadManager.shared.items { DownloadManager.shared.remove(item) }
            }
            refresh()
            model.showToast("Done")
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
