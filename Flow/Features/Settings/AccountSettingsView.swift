import SwiftUI
import FlowKit
#if !os(tvOS)
import AuthenticationServices
#endif

struct AccountSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var signIn: SignInService?
    #if !os(tvOS)
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    #endif
    @State private var traktSigningIn = false
    @State private var traktError: String?

    enum SignInService: String, Identifiable { case trakt, simkl; var id: String { rawValue } }

    var body: some View {
        @Bindable var model = model
        FilmForm {
            Section {
                ForEach(TrackerKind.allCases) { kind in
                    Button { select(kind) } label: {
                        HStack(spacing: 14) {
                            Image(systemName: icon(kind)).font(.title3).frame(width: 30)
                                .foregroundStyle(model.settings.account.tracker == kind ? Color.green : .secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(kind.displayName).font(.headline).foregroundStyle(.primary)
                                Text(kind.blurb).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if model.settings.account.tracker == kind { Image(systemName: "checkmark").foregroundStyle(.green) }
                        }
                    }
                    .disabled(!isAvailable(kind))
                }
            } header: {
                Text("Tracking With")
            } footer: {
                Text("Only one of these can track at a time — choosing another moves your tracking to it. This Device needs no account and is the default.")
            }

            Section {
                if model.credentials.traktToken != nil {
                    accountRow(name: model.settings.account.tracker == .trakt ? model.profile?.username : nil, service: "Trakt", tracker: .trakt)
                    Button("Sign Out", role: .destructive) {
                        Task {
                            await model.trakt?.signOut()
                            model.credentials.traktToken = nil
                            if model.settings.account.tracker == .trakt { model.settings.account.tracker = .local }
                            dropDestinations(.trakt)
                        }
                    }
                } else if model.traktClientID == nil {
                    NavigationLink(value: Route.settings(.apiKeys)) {
                        Text("Add a Trakt Client ID in API Keys to sign in.").foregroundStyle(.secondary)
                    }
                } else {
                    #if os(tvOS)
                    Button("Sign In to Trakt") { signIn = .trakt }
                    #else
                    Button {
                        Task { await signInToTrakt() }
                    } label: {
                        HStack {
                            Text("Sign In to Trakt")
                            if traktSigningIn { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(traktSigningIn)
                    #endif
                }
            } header: {
                Text("Trakt")
            } footer: {
                if let traktError {
                    Text(traktError).foregroundStyle(.red)
                } else if Platform.isTV, model.credentials.traktToken == nil, model.traktClientID != nil {
                    // Apple TV signs in with a code. Credentials sync through iCloud Keychain, so a sign-in
                    // made on another device usually shows up here without any code at all.
                    Text("Already signed in to Trakt on your iPhone, iPad or Mac? iCloud Keychain brings that sign-in to Apple TV.")
                }
            }

            Section("Simkl") {
                if model.credentials.simklToken != nil {
                    accountRow(name: model.settings.account.tracker == .simkl ? model.profile?.username : nil, service: "Simkl", tracker: .simkl)
                    Button("Sign Out", role: .destructive) {
                        model.credentials.simklToken = nil
                        if model.settings.account.tracker == .simkl { model.settings.account.tracker = .local }
                        dropDestinations(.simkl)
                    }
                } else if model.simklClientID == nil {
                    NavigationLink(value: Route.settings(.apiKeys)) {
                        Text("Add a Simkl Client ID in API Keys to sign in.").foregroundStyle(.secondary)
                    }
                } else {
                    Button("Sign In to Simkl") { signIn = .simkl }
                }
            }

            Section {
                HStack {
                    Button("Sync Now") { Task { await model.refreshLibrary(force: true) } }
                    Spacer()
                    if model.isSyncing { ProgressView() }
                    else if let last = model.settings.sync.lastTrackerSync {
                        Text(last, format: .relative(presentation: .numeric, unitsStyle: .wide)).foregroundStyle(.secondary)
                    }
                }
                if let error = model.lastSyncError, !showsSyncIssueInAccountRow {
                    Text(error).font(.caption).foregroundStyle(.orange)
                }
                Picker("Sync Interval", selection: $model.settings.account.syncInterval) {
                    ForEach(SyncInterval.allCases) { Text($0.title).tag($0) }
                }
                Toggle("Scrobble While Watching", isOn: $model.settings.account.scrobble)
            } header: {
                Text("Sync")
            } footer: {
                Text("How often watch history syncs when reopening the app. With Trakt, Simkl, PublicMetaDB or MDBList connected, resume positions come from that service alone — Flow keeps no progress of its own, so Resume goes exactly as far as your tracker records it.")
            }

            Section {
                Picker("Watchlist Saved To", selection: $model.settings.account.watchlistDestination) {
                    ForEach(destinations) { Text($0.displayName).tag($0) }
                }
            } header: {
                Text("Watchlist Provider")
            } footer: {
                Text("Where Add/Remove Watchlist actions are saved. PublicMetaDB and MDBList appear once their API key is set.")
            }

            Section {
                Picker("Favourites Saved To", selection: $model.settings.account.favouritesDestination) {
                    ForEach(destinations.filter { $0 != .simkl && $0 != .mdblist && $0 != .publicMetaDB }) { Text($0.displayName).tag($0) }
                }
            } header: {
                Text("Favourites Provider")
            } footer: {
                Text("Where the heart (Favourite) button saves to, and which source the Library's Favourites row shows. Trakt appears when signed in; Media Server when one is connected.")
            }

            Section {
                NavigationLink(value: Route.settings(.apiKeys)) {
                    LabeledContent("API Keys", value: configuredSummary)
                }
            } footer: {
                Text("MDBList provides the IMDb, Rotten Tomatoes and Metacritic ratings shown on detail pages, and can also back your watchlist and list shelves. IntroDB and PublicMetaDB provide skip segments, and PublicMetaDB can also back your watchlist. Subtitle Sources (SubSource, SubDL, Wyzie and OpenSubtitles) power the in-player subtitle search.")
            }
        }
        .sheet(item: $signIn) { service in
            DeviceSignInView(service: service).environment(model)
        }
        .onChange(of: model.settings.account.watchlistDestination) { _, _ in Task { await model.refreshLibrary(force: true) } }
        .onChange(of: model.settings.account.favouritesDestination) { _, _ in Task { await model.refreshLibrary(force: true) } }
    }

    private var destinations: [ListDestination] {
        var list = model.availableListDestinations
        if !model.settings.mediaServers.servers.isEmpty { list.append(.mediaServer) }
        return list
    }

    private var configuredSummary: String {
        let c = model.credentials
        let count = [c.mdblistAPIKey, c.publicMetaDBAPIKey, c.introDBAPIKey, c.openSubtitlesAPIKey, c.subdlAPIKey, c.subSourceAPIKey].compactMap { $0?.nonEmpty }.count
        return count == 0 ? "Not configured" : "\(count) configured"
    }

    /// Trakt and Simkl show a failed sync under their own account row; other trackers have no row to hang it on.
    private var showsSyncIssueInAccountRow: Bool {
        (model.settings.account.tracker == .trakt && model.credentials.traktToken != nil)
            || (model.settings.account.tracker == .simkl && model.credentials.simklToken != nil)
    }

    private func accountRow(name: String?, service: String, tracker: TrackerKind) -> some View {
        let issue = model.settings.account.tracker == tracker ? model.lastSyncError : nil
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                RemoteImage(url: model.profile?.avatarURL)
                    .overlay { if model.profile?.avatarURL == nil { Image(systemName: "person.fill") } }
                    .frame(width: 44, height: 44).clipShape(Circle())
                VStack(alignment: .leading) {
                    Text(name ?? service).font(.headline)
                    Text(issue == nil ? "Connected" : "Sync issues").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if issue == nil {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                } else {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                }
            }
            if let issue {
                Text(issue).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func icon(_ kind: TrackerKind) -> String {
        switch kind {
        case .trakt: return "checkmark.circle"
        case .simkl: return "play.rectangle"
        case .publicMetaDB: return "car.side"
        case .mdblist: return "star.square.on.square"
        case .local: return "icloud"
        }
    }

    private func isAvailable(_ kind: TrackerKind) -> Bool {
        switch kind {
        case .trakt: return model.credentials.traktToken != nil
        case .simkl: return model.credentials.simklToken != nil
        case .mdblist: return model.credentials.mdblistAPIKey?.nonEmpty != nil
        case .publicMetaDB: return model.credentials.publicMetaDBAPIKey?.nonEmpty != nil
        case .local: return true
        }
    }

    /// Lists saved to a service you've just signed out of go back to this device, rather than pointing at a picker entry that's gone.
    private func dropDestinations(_ destination: ListDestination) {
        if model.settings.account.watchlistDestination == destination { model.settings.account.watchlistDestination = .local }
        if model.settings.account.favouritesDestination == destination { model.settings.account.favouritesDestination = .local }
    }

    #if !os(tvOS)
    /// Trakt signs apps in with PKCE: a web sheet returns a code, and the secret verifier made here
    /// stands in for the client secret Trakt no longer issues.
    private func signInToTrakt() async {
        guard let trakt = model.trakt else { return }
        traktSigningIn = true
        traktError = nil
        defer { traktSigningIn = false }
        do {
            let pkce = PKCE.generate()
            let state = TraktOAuth.makeState()
            let callback = try await webAuthenticationSession.authenticate(using: trakt.authorizeURL(pkce: pkce, state: state), callbackURLScheme: TraktOAuth.callbackScheme)
            let token = try await trakt.signIn(callback: callback, expectedState: state, pkce: pkce)
            model.credentials.traktToken = token
            model.settings.account.tracker = .trakt
            model.settings.account.watchlistDestination = .trakt
            await model.refreshLibrary(force: true)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // Closing the sheet isn't a failure worth a message.
        } catch FlowError.cancelled {
        } catch {
            traktError = error.localizedDescription
        }
    }
    #endif

    private func select(_ kind: TrackerKind) {
        model.settings.account.tracker = kind
        // Lists follow the tracker unless the user picked something else.
        if let destination = ListDestination(rawValue: kind.rawValue), model.availableListDestinations.contains(destination) {
            model.settings.account.watchlistDestination = destination
        }
    }
}

/// Device-code sign-in: shows the code, a QR to the activation page, and polls. Simkl everywhere, Trakt on Apple TV,
/// which has no web sign-in sheet (iPhone, iPad and Mac sign in to Trakt with PKCE instead).
struct DeviceSignInView: View {
    let service: AccountSettingsView.SignInService
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var code: DeviceCode?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                if let code {
                    Text("Go to").foregroundStyle(.secondary)
                    Text(code.verificationURL.absoluteString).font(.title3.weight(.semibold))
                    Text("and enter").foregroundStyle(.secondary)
                    Text(code.userCode)
                        .font(.system(size: Platform.isTV ? 72 : 44, weight: .bold, design: .monospaced))
                        .kerning(4)
                    if let qr = QRCode.image(for: code.verificationURL.absoluteString) {
                        qr.interpolation(.none).resizable().frame(width: 180, height: 180).padding(10).background(.white, in: RoundedRectangle(cornerRadius: 12))
                    }
                    #if !os(tvOS)
                    HStack {
                        Button("Copy Code") { Platform.copyToPasteboard(code.userCode) }
                        Link("Open Page", destination: code.verificationURL).buttonStyle(PrimaryButtonStyle(compact: true))
                    }
                    #endif
                    ProgressView("Waiting for approval…")
                } else if let error {
                    ContentUnavailableView("Sign-In Failed", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    ProgressView()
                }
            }
            .padding(30)
            .navigationTitle("Sign In to \(service == .trakt ? "Trakt" : "Simkl")")
            .inlineNavigationTitle()
            .sheetDismissButton("Cancel") { dismiss() }
            .task { await run() }
        }
    }

    private func run() async {
        do {
            switch service {
            case .trakt:
                guard let trakt = model.trakt else { throw FlowError.missingCredential("Trakt client ID") }
                let c = try await trakt.startDeviceAuth()
                code = c
                let token = try await trakt.pollDeviceToken(c)
                model.credentials.traktToken = token
                model.settings.account.tracker = .trakt
                model.settings.account.watchlistDestination = .trakt
            case .simkl:
                guard let simkl = model.simkl else { throw FlowError.missingCredential("Simkl client ID") }
                let c = try await simkl.startDeviceAuth()
                code = c
                let token = try await simkl.pollDeviceToken(c)
                model.credentials.simklToken = token
                model.settings.account.tracker = .simkl
                model.settings.account.watchlistDestination = .simkl
            }
            await model.refreshLibrary(force: true)
            dismiss()
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct APIKeysView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        FilmForm {
            Section {
                OptionalTextField(title: "MDBList API Key", text: $model.credentials.mdblistAPIKey, secure: true)
                Link("Get a key at mdblist.com", destination: URL(string: "https://mdblist.com/preferences/")!)
            } header: { Text("MDBList") } footer: { Text("Ratings, list shelves, and optional tracking/watchlist.") }

            Section {
                OptionalTextField(title: "PublicMetaDB API Key", text: $model.credentials.publicMetaDBAPIKey, secure: true)
                TextField("Base URL", text: $model.settings.account.publicMetaDBBaseURL).autocorrectionDisabled()
            } header: { Text("PublicMetaDB") } footer: { Text("Tracking, watchlist and skip segments.") }

            Section {
                OptionalTextField(title: "IntroDB API Key", text: $model.credentials.introDBAPIKey, secure: true)
                TextField("Base URL", text: $model.settings.account.introDBBaseURL).autocorrectionDisabled()
            } header: { Text("IntroDB") } footer: { Text("Intro, recap and credits timestamps for the Skip button.") }

            Section {
                OptionalTextField(title: "RPDB API Key", text: $model.credentials.rpdbAPIKey, secure: true)
                Link("Get a key at ratingposterdb.com", destination: URL(string: "https://ratingposterdb.com")!)
            } header: { Text("RatingPosterDB") } footer: { Text("Posters with ratings drawn on, for Poster Enhancement in Metadata settings.") }

            Section("Subtitle Sources") {
                OptionalTextField(title: "OpenSubtitles API Key", text: $model.credentials.openSubtitlesAPIKey, secure: true)
                OptionalTextField(title: "OpenSubtitles Username (optional)", text: $model.credentials.openSubtitlesUsername)
                OptionalTextField(title: "OpenSubtitles Password (optional)", text: $model.credentials.openSubtitlesPassword, secure: true)
                OptionalTextField(title: "SubDL API Key", text: $model.credentials.subdlAPIKey, secure: true)
                OptionalTextField(title: "SubSource API Key", text: $model.credentials.subSourceAPIKey, secure: true)
                Text("Wyzie needs no key.").font(.caption).foregroundStyle(.secondary)
            }

            Section {
                OptionalTextField(title: "Trakt Client ID", text: $model.credentials.traktClientID, prompt: BundleKeys.traktClientID == nil ? "Client ID" : "Using built-in app")
                OptionalTextField(title: "Simkl Client ID", text: $model.credentials.simklClientID, prompt: BundleKeys.simklClientID == nil ? "Client ID" : "Using built-in app")
            } header: {
                Text("OAuth Apps")
            } footer: {
                Text("Create an app at trakt.tv/oauth/applications with the redirect URI \(TraktOAuth.redirectURI). Trakt no longer issues a client secret, and Flow doesn't need one. Or create a Simkl app at simkl.com/settings/developer.")
            }

            Section {
                TextField("TheSportsDB Key", text: $model.settings.sports.apiKey).autocorrectionDisabled()
                Toggle("Show Score Spoilers", isOn: $model.settings.sports.showScoreSpoilers)
                Toggle("Choose Channel on Tap", isOn: $model.settings.sports.chooseChannelOnTap)
            } header: {
                Text("Sports")
            } footer: {
                Text("Hide Score Spoilers blurs live and final scores so results stay hidden until you're ready. Tap a finished game to reveal its score. Choose Channel on Tap opens the channel list when you tap a game so you can pick a broadcast; press and hold to start the best match. Off taps straight into the best match and press-and-hold opens the list.")
            }
        }
    }
}
