import SwiftUI
import FlowKit

struct MediaServersSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var adding = false
    @State private var reachable: [String: Bool] = [:]

    var body: some View {
        @Bindable var model = model
        List {
            Section {
                ForEach($model.settings.mediaServers.servers) { $server in
                    HStack(spacing: 12) {
                        Circle().fill(reachable[server.id] == false ? Color.red : reachable[server.id] == true ? .green : .gray)
                            .frame(width: 9, height: 9)
                        Image(systemName: "server.rack").foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(server.name).font(.headline)
                                Tag(text: server.kind.displayName, color: .purple)
                                Tag(text: server.isRemote ? "Remote" : "Local", color: .green)
                            }
                            Text(server.baseURL.host ?? server.baseURL.absoluteString).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Toggle("", isOn: $server.enabled).labelsHidden()
                    }
                    .contextMenu {
                        Button(role: .destructive) { remove(server.id) } label: { Label("Remove", systemImage: "trash") }
                    }
                }
                .onDelete { model.settings.mediaServers.servers.remove(atOffsets: $0) }
            } header: {
                Text("Servers")
            } footer: {
                Text("Swipe to remove. Toggle to enable or disable.")
            }

            Section {
                Button { adding = true } label: { Label("Add Server", systemImage: "plus.circle.fill") }
            } footer: {
                Text("Connect your Jellyfin, Emby, or Plex media server to stream from your own library.")
            }

            Section {
                Toggle("Show Badge on Posters", isOn: $model.settings.mediaServers.showBadgeOnPosters)
            } header: { Text("Display") } footer: {
                Text("Adds a small server icon to the top-right of any poster whose content is available on one of your media servers.")
            }
            Section {
                Toggle("Only Show My Server's Content", isOn: $model.settings.mediaServers.onlyShowServerContent)
            } footer: {
                Text("Hides every movie and show that isn't in your media server library — across Home, Search, and Discover. Live TV channels are unaffected.")
            }
            Section {
                Toggle("Search Media Servers", isOn: $model.settings.mediaServers.searchServers)
            } footer: {
                Text("Includes your media server libraries in search results. Turn this off and searching stops asking your servers entirely — the Media Servers row disappears and no requests are sent to them.")
            }
            Section {
                Toggle("Use Server Artwork", isOn: $model.settings.mediaServers.useServerArtwork)
            } footer: {
                Text("Uses posters and backdrops from your media server for titles in its library. Everything else — and all text details — still comes from TMDb.")
            }
            Section {
                Button("Refresh Library Index") { Task { await model.refreshServerIndex() } }
                LabeledContent("Indexed Titles", value: "\(model.serverKeys.count)")
            }
        }
        .sheet(isPresented: $adding) { AddServerView().environment(model) }
        .task(id: model.settings.mediaServers.servers.map(\.id)) { await probe() }
    }

    private func remove(_ id: String) {
        model.settings.mediaServers.servers.removeAll { $0.id == id }
    }

    private func probe() async {
        for server in model.settings.mediaServers.servers {
            let client = model.makeServerClient(server)
            reachable[server.id] = (try? await client.libraries()) != nil
        }
    }
}

struct Tag: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(color.opacity(0.25), in: Capsule())
            .foregroundStyle(color)
    }
}

/// Jellyfin/Emby username+password sign-in, or Plex link-code sign-in with server discovery.
struct AddServerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var kind: MediaServerKind = .jellyfin
    @State private var address = ""
    @State private var username = ""
    @State private var password = ""
    @State private var working = false
    @State private var error: String?
    @State private var plexCode: DeviceCode?
    @State private var plexServers: [PlexClient.DiscoveredServer] = []

    var body: some View {
        NavigationStack {
            Form {
                Picker("Server Type", selection: $kind) {
                    ForEach(MediaServerKind.allCases) { Text($0.displayName).tag($0) }
                }
                .pickerStyle(.segmented)

                if kind == .plex {
                    plexSection
                } else {
                    Section {
                        TextField("Server Address", text: $address, prompt: Text("https://jellyfin.example.com"))
                            .autocorrectionDisabled()
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            #endif
                        TextField("Username", text: $username)
                            .autocorrectionDisabled()
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            #endif
                        SecureField("Password", text: $password)
                    } footer: {
                        Text(kind == .emby ? "Include /emby in the address if your server uses it." : "Use the address you open Jellyfin with in a browser.")
                    }
                    Section {
                        Button {
                            Task { await signIn() }
                        } label: {
                            HStack { Text("Sign In"); if working { Spacer(); ProgressView() } }
                        }
                        .disabled(address.isEmpty || username.isEmpty || working)
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Add Server")
            .inlineNavigationTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    @ViewBuilder
    private var plexSection: some View {
        if !plexServers.isEmpty {
            Section("Choose Servers") {
                ForEach(plexServers) { server in
                    Button {
                        Task { await addPlex(server) }
                    } label: {
                        HStack {
                            Text(server.name)
                            Spacer()
                            if model.settings.mediaServers.servers.contains(where: { $0.machineID == server.machineID }) {
                                Image(systemName: "checkmark").foregroundStyle(.green)
                            }
                        }
                    }
                }
                Button("Done") { dismiss() }
            }
        } else if let plexCode {
            Section {
                VStack(spacing: 14) {
                    Text("Go to **plex.tv/link** and enter").foregroundStyle(.secondary)
                    Text(plexCode.userCode).font(.system(size: 44, weight: .bold, design: .monospaced)).kerning(4)
                    if let qr = QRCode.image(for: plexCode.verificationURL.absoluteString) {
                        qr.interpolation(.none).resizable().frame(width: 160, height: 160).padding(8).background(.white, in: RoundedRectangle(cornerRadius: 10))
                    }
                    ProgressView("Waiting for Plex…")
                }
                .frame(maxWidth: .infinity)
            }
        } else {
            Section {
                Button {
                    Task { await linkPlex() }
                } label: {
                    HStack { Text("Link Plex Account"); if working { Spacer(); ProgressView() } }
                }
            } footer: {
                Text("You'll get a 4-character code to enter at plex.tv/link. Flow then finds the servers on your account.")
            }
        }
    }

    private func normalizedURL() -> URL? {
        var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.lowercased().hasPrefix("http") { text = "http://" + text }
        while text.hasSuffix("/") { text.removeLast() }
        return URL(string: text)
    }

    private func signIn() async {
        guard let url = normalizedURL() else { error = "That address doesn't look right."; return }
        working = true
        defer { working = false }
        do {
            let config = try await JellyfinClient.signIn(kind: kind, baseURL: url, username: username, password: password,
                                                         deviceID: model.deviceID, deviceName: Platform.deviceName, http: model.http)
            model.settings.mediaServers.servers.append(config)
            if model.settings.sources.providerOrder[SourceCategory.mediaServers.rawValue] == nil {
                model.settings.sources.providerOrder[SourceCategory.mediaServers.rawValue] = []
            }
            model.settings.sources.providerOrder[SourceCategory.mediaServers.rawValue]?.append(config.id)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func linkPlex() async {
        working = true
        defer { working = false }
        do {
            let (pin, code) = try await PlexClient.createPin(clientIdentifier: model.deviceID, http: model.http)
            plexCode = code
            let token = try await PlexClient.pollPin(pin, clientIdentifier: model.deviceID, expiresIn: code.expiresIn, http: model.http)
            plexServers = try await PlexClient.discoverServers(userToken: token, clientIdentifier: model.deviceID, http: model.http)
            if plexServers.isEmpty { error = "No servers found on this Plex account." }
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func addPlex(_ server: PlexClient.DiscoveredServer) async {
        guard !model.settings.mediaServers.servers.contains(where: { $0.machineID == server.machineID }) else { return }
        do {
            let config = try await PlexClient.config(for: server, clientIdentifier: model.deviceID, http: model.http)
            model.settings.mediaServers.servers.append(config)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
