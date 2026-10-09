import SwiftUI
import FlowKit

// MARK: - WebDAV

struct WebDAVSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var editing: WebDAVConfig?

    var body: some View {
        @Bindable var model = model
        List {
            Section {
                ForEach($model.settings.webDAV) { $config in
                    HStack {
                        Button { editing = config } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(config.name).font(.headline).foregroundStyle(.primary)
                                Text(config.baseURL.absoluteString).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        Toggle("", isOn: $config.enabled).labelsHidden()
                    }
                    .contextMenu {
                        Button(role: .destructive) { model.settings.webDAV.removeAll { $0.id == config.id } } label: { Label("Remove", systemImage: "trash") }
                    }
                }
                .onDelete { model.settings.webDAV.remove(atOffsets: $0) }
                Button {
                    editing = WebDAVConfig(name: "My NAS", baseURL: URL(string: "https://example.invalid")!)
                } label: { Label("Add WebDAV Share", systemImage: "plus.circle.fill") }
            } footer: {
                Text("Flow scans the Movies and TV Shows folders for files named like “Movie (2020).mkv” or “Show/Season 1/Show S01E02.mkv” and offers them as sources.")
            }
        }
        .sheet(item: $editing) { config in WebDAVEditor(config: config).environment(model) }
    }
}

struct WebDAVEditor: View {
    @State var config: WebDAVConfig
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var urlText = ""
    @State private var status: String?
    @State private var testing = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $config.name)
                TextField("Address", text: $urlText, prompt: Text("https://nas.local:5006/dav"))
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                OptionalTextField(title: "Username", text: $config.username)
                OptionalTextField(title: "Password", text: $config.password, secure: true)
                TextField("Movies Folder", text: $config.moviesPath)
                TextField("TV Shows Folder", text: $config.showsPath)
                Section {
                    Button {
                        Task { await test() }
                    } label: { HStack { Text("Test Connection"); if testing { Spacer(); ProgressView() } } }
                    if let status { Text(status).font(.caption).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(config.name)
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.disabled(URL(string: urlText)?.host == nil) }
            }
            .onAppear { urlText = config.baseURL.host == "example.invalid" ? "" : config.baseURL.absoluteString }
        }
    }

    private func test() async {
        guard let url = URL(string: urlText) else { return }
        testing = true
        defer { testing = false }
        var c = config
        c.baseURL = url
        do {
            let count = try await WebDAVClient(config: c, http: model.http).testConnection()
            status = "Connected — \(count) items at the root."
        } catch {
            status = error.localizedDescription
        }
    }

    private func save() {
        guard let url = URL(string: urlText) else { return }
        config.baseURL = url
        if let i = model.settings.webDAV.firstIndex(where: { $0.id == config.id }) {
            model.settings.webDAV[i] = config
        } else {
            model.settings.webDAV.append(config)
        }
        dismiss()
    }
}

// MARK: - Live TV

struct LiveTVSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var editing: IPTVProviderConfig?

    var body: some View {
        @Bindable var model = model
        List {
            Section {
                ForEach($model.settings.liveTV.providers) { $provider in
                    HStack {
                        Button { editing = provider } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(provider.name).font(.headline).foregroundStyle(.primary)
                                Text(provider.kind.displayName + (provider.useForVOD ? " · VOD sources" : "")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        Toggle("", isOn: $provider.enabled).labelsHidden()
                    }
                    .contextMenu {
                        Button(role: .destructive) { model.settings.liveTV.providers.removeAll { $0.id == provider.id } } label: { Label("Remove", systemImage: "trash") }
                    }
                }
                .onDelete { model.settings.liveTV.providers.remove(atOffsets: $0) }
                Button {
                    editing = IPTVProviderConfig(name: "IPTV", kind: .m3u, url: URL(string: "https://example.invalid")!)
                } label: { Label("Add Provider", systemImage: "plus.circle.fill") }
            } header: {
                Text("IPTV Providers")
            }
            Section("Guide") {
                Picker("Refresh Guide Every", selection: $model.settings.liveTV.epgRefreshHours) {
                    ForEach([3, 6, 12, 24, 48], id: \.self) { Text("\($0) hours").tag($0) }
                }
                Toggle("Hide Empty Groups", isOn: $model.settings.liveTV.hideEmptyGroups)
                Button("Clear Favourite Channels", role: .destructive) { model.settings.liveTV.favouriteChannelIDs = [] }
            }
        }
        .sheet(item: $editing) { provider in IPTVEditor(config: provider).environment(model) }
    }
}

struct IPTVEditor: View {
    @State var config: IPTVProviderConfig
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var urlText = ""
    @State private var epgText = ""
    @State private var status: String?
    @State private var testing = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $config.name)
                Picker("Type", selection: $config.kind) {
                    ForEach(IPTVProviderKind.allCases) { Text($0.displayName).tag($0) }
                }
                Section {
                    TextField(config.kind == .m3u ? "Playlist URL" : "Server URL", text: $urlText,
                              prompt: Text(config.kind == .m3u ? "https://provider.example/playlist.m3u" : "http://provider.example:8080"))
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                    if config.kind == .xtream {
                        OptionalTextField(title: "Username", text: $config.username)
                        OptionalTextField(title: "Password", text: $config.password, secure: true)
                    }
                    TextField("EPG (XMLTV) URL — optional", text: $epgText).autocorrectionDisabled()
                    OptionalTextField(title: "User-Agent — optional", text: $config.userAgent)
                }
                Section {
                    Toggle("Offer VOD as Sources", isOn: $config.useForVOD)
                } footer: {
                    Text("Movies and series from this provider appear in the source picker under IPTV / VOD.")
                }
                Section {
                    Button { Task { await test() } } label: { HStack { Text("Test"); if testing { Spacer(); ProgressView() } } }
                    if let status { Text(status).font(.caption).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(config.name)
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.disabled(URL(string: urlText)?.host == nil) }
            }
            .onAppear {
                urlText = config.url.host == "example.invalid" ? "" : config.url.absoluteString
                epgText = config.epgURL?.absoluteString ?? ""
            }
        }
    }

    private func current() -> IPTVProviderConfig? {
        guard let url = URL(string: urlText) else { return nil }
        var c = config
        c.url = url
        c.epgURL = epgText.isEmpty ? nil : URL(string: epgText)
        return c
    }

    private func test() async {
        guard let c = current() else { return }
        testing = true
        defer { testing = false }
        do {
            if c.kind == .xtream {
                let client = XtreamClient(config: c, http: model.http)
                let info = try await client.accountInfo()
                let channels = try await client.channels()
                status = "OK — \(channels.count) channels" + (info.expiresAt.map { ", expires \($0.formatted(date: .abbreviated, time: .omitted))" } ?? "")
            } else {
                let channels = try await M3UProvider(config: c, http: model.http).channels()
                status = "OK — \(channels.count) channels"
            }
        } catch {
            status = error.localizedDescription
        }
    }

    private func save() {
        guard let c = current() else { return }
        if let i = model.settings.liveTV.providers.firstIndex(where: { $0.id == c.id }) {
            model.settings.liveTV.providers[i] = c
        } else {
            model.settings.liveTV.providers.append(c)
        }
        dismiss()
    }
}
