import SwiftUI
import FlowKit

enum SettingsPage: String, Hashable, CaseIterable, Identifiable {
    case general, account, shelves, mediaServers, webDAV, liveTV, sources, dataStorage, shareSetup, importSetup
    case playback, subtitles, metadata, about
    case sourceAppearance, apiKeys, addons

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "General"
        case .account: return "Account"
        case .shelves: return "Shelves"
        case .mediaServers: return "Media Servers"
        case .webDAV: return "WebDAV"
        case .liveTV: return "Live TV"
        case .sources: return "Sources"
        case .dataStorage: return "Data & Storage"
        case .shareSetup: return "Share Setup"
        case .importSetup: return "Import Setup"
        case .playback: return "Playback"
        case .subtitles: return "Subtitles"
        case .metadata: return "Metadata"
        case .about: return "About"
        case .sourceAppearance: return "Source Appearance"
        case .apiKeys: return "API Keys"
        case .addons: return "Stream Add-ons"
        }
    }

    var systemImage: String {
        switch self {
        case .general: return "gearshape"
        case .account: return "person.crop.circle"
        case .shelves: return "square.grid.2x2"
        case .mediaServers: return "server.rack"
        case .webDAV: return "externaldrive.connected.to.line.below"
        case .liveTV: return "tv.and.mediabox"
        case .sources: return "list.number"
        case .dataStorage: return "internaldrive"
        case .shareSetup: return "square.and.arrow.up"
        case .importSetup: return "square.and.arrow.down"
        case .playback: return "play.circle"
        case .subtitles: return "captions.bubble"
        case .metadata: return "text.magnifyingglass"
        case .about: return "info.circle"
        case .sourceAppearance: return "textformat"
        case .apiKeys: return "key"
        case .addons: return "puzzlepiece.extension"
        }
    }

    /// Icon tile colour, iOS Settings–style.
    var tint: Color {
        switch self {
        case .general: return .gray
        case .account: return .blue
        case .shelves: return .indigo
        case .mediaServers: return .purple
        case .webDAV: return .teal
        case .liveTV: return .red
        case .sources: return .orange
        case .dataStorage: return .green
        case .shareSetup: return .cyan
        case .importSetup: return .mint
        case .playback: return .pink
        case .subtitles: return .yellow
        case .metadata: return .brown
        case .about: return .gray
        case .sourceAppearance: return .orange
        case .apiKeys: return .blue
        case .addons: return .purple
        }
    }

    /// Words that make a page show up in Search Settings.
    var keywords: String {
        switch self {
        case .general: return "accent color start tab poster titles hero haptics"
        case .account: return "trakt simkl mdblist publicmetadb tracking sync interval watchlist favourites sign in"
        case .shelves: return "home rows discover lists reorder"
        case .mediaServers: return "jellyfin emby plex server badge artwork"
        case .webDAV: return "webdav nas share files"
        case .liveTV: return "iptv m3u xtream epg channels guide"
        case .sources: return "addons aiostreams order sort filter cap resolution"
        case .dataStorage: return "icloud sync push pull cache storage clear"
        case .shareSetup: return "export qr share backup"
        case .importSetup: return "import restore qr"
        case .playback: return "resolution autoplay skip intro credits resume audio external player infuse vlc pip"
        case .subtitles: return "subtitles captions language size color offset"
        case .metadata: return "tvdb tmdb episode source time zone unreleased language api key"
        case .about: return "version licenses"
        case .sourceAppearance: return "badges formatting title"
        case .apiKeys: return "keys opensubtitles subdl introdb"
        case .addons: return "stremio manifest addon"
        }
    }

    static let primary: [SettingsPage] = [.general, .account, .shelves, .mediaServers, .webDAV, .liveTV, .sources, .dataStorage, .shareSetup, .importSetup]
    static let secondary: [SettingsPage] = [.playback, .subtitles, .metadata]
}

struct SettingsRootView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        List {
            if query.isEmpty {
                if model.isDemo {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Label("You're exploring sample data", systemImage: "sparkles").font(.headline)
                            Text("Nothing here touches your accounts. Leave the demo to set Flow up with your own sources.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Button("Leave Demo") { model.showSettings = false; model.setDemoMode(false) }
                    }
                }
                if let profile = model.profile, model.settings.account.tracker != .local {
                    Section {
                        NavigationLink(value: Route.settings(.account)) {
                            HStack(spacing: 12) {
                                RemoteImage(url: profile.avatarURL)
                                    .overlay { if profile.avatarURL == nil { Image(systemName: "person.fill") } }
                                    .frame(width: 44, height: 44).clipShape(Circle())
                                VStack(alignment: .leading) {
                                    Text(profile.displayName ?? profile.username).font(.headline)
                                    Text("Tracking with \(model.settings.account.tracker.displayName)").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                Section { ForEach(SettingsPage.primary) { row($0) } }
                Section { ForEach(SettingsPage.secondary) { row($0) } }
                Section {
                    row(.about)
                    Link(destination: URL(string: "https://github.com/avinashgazula/flow")!) {
                        Label("Source Code & Issues", systemImage: "chevron.left.forwardslash.chevron.right")
                    }
                }
            } else {
                let matches = SettingsPage.allCases.filter {
                    $0.title.localizedCaseInsensitiveContains(query) || $0.keywords.localizedCaseInsensitiveContains(query)
                }
                if matches.isEmpty { Text("No settings match “\(query)”").foregroundStyle(.secondary) }
                ForEach(matches) { row($0) }
            }
        }
        .navigationTitle("Settings")
        .searchable(text: $query, prompt: "Search Settings")
    }

    private func row(_ page: SettingsPage) -> some View {
        NavigationLink(value: Route.settings(page)) {
            Label {
                Text(page.title)
            } icon: {
                SettingsIcon(systemImage: page.systemImage, tint: page.tint)
            }
        }
    }
}

struct SettingsPageView: View {
    let page: SettingsPage

    var body: some View {
        Group {
            switch page {
            case .general: GeneralSettingsView()
            case .account: AccountSettingsView()
            case .shelves: ShelvesSettingsView()
            case .mediaServers: MediaServersSettingsView()
            case .webDAV: WebDAVSettingsView()
            case .liveTV: LiveTVSettingsView()
            case .sources: SourcesSettingsView()
            case .dataStorage: DataStorageView()
            case .shareSetup: ShareSetupView()
            case .importSetup: ImportSetupView()
            case .playback: PlaybackSettingsView()
            case .subtitles: SubtitleSettingsView()
            case .metadata: MetadataSettingsView()
            case .about: AboutView()
            case .sourceAppearance: SourceAppearanceView()
            case .apiKeys: APIKeysView()
            case .addons: AddonsSettingsView()
            }
        }
        .navigationTitle(page.title)
        .inlineNavigationTitle()
    }
}

/// A text field bound to an optional string, with a label above on tvOS-friendly layouts.
struct OptionalTextField: View {
    let title: String
    @Binding var text: String?
    var secure = false
    var prompt: String = ""

    var body: some View {
        let binding = Binding<String>(get: { text ?? "" }, set: { text = $0.isEmpty ? nil : $0 })
        Group {
            if secure {
                SecureField(title, text: binding, prompt: Text(prompt.isEmpty ? title : prompt))
            } else {
                TextField(title, text: binding, prompt: Text(prompt.isEmpty ? title : prompt))
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
            }
        }
    }
}

struct AboutView: View {
    var body: some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "play.rectangle.on.rectangle.fill").font(.system(size: 54)).foregroundStyle(.tint)
                    Text("Flow").font(.title.weight(.bold))
                    Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding()
            }
            Section("Data Providers") {
                Text("Metadata and images from TMDb. This product uses the TMDB API but is not endorsed or certified by TMDB.")
                Text("Episode data from TheTVDB. Ratings via MDBList. Sports data from TheSportsDB.")
            }
            .font(.footnote)
            Section("Content") {
                Text("Flow does not host or provide any content. It plays media from servers, shares, providers and add-ons that you configure and are responsible for.")
                    .font(.footnote)
            }
        }
    }
}

/// White glyph on a coloured squircle, like iOS Settings.
struct SettingsIcon: View {
    let systemImage: String
    let tint: Color

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 14 * Theme.scale, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 29 * Theme.scale, height: 29 * Theme.scale)
            .background(
                LinearGradient(colors: [tint.opacity(0.95), tint.opacity(0.75)], startPoint: .top, endPoint: .bottom),
                in: RoundedRectangle(cornerRadius: 7 * Theme.scale, style: .continuous)
            )
    }
}
