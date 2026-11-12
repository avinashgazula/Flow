import SwiftUI
import FlowKit

private extension View {
    /// Keys, addresses and tokens: no autocorrect, no capital letters, and the URL keyboard for an address.
    func syncField(url: Bool = false) -> some View {
        autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(url ? .URL : .default)
            #endif
    }
}

/// What Flow Sync carries, said the same way on every page of it.
private let syncExplainer = "Syncs your API keys, Trakt and Simkl sign-ins, stream add-ons, media servers, and audio and subtitle preferences between your devices, including builds that can't use iCloud. It's end-to-end encrypted: everything is locked with your sync key on this device before it goes to your own Cloudflare Worker, which only ever stores scrambled data. Watch history, progress and appearance stay on each device."

struct SyncSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var server = ""
    @State private var token = ""
    @State private var working = false
    @State private var failure: String?
    @State private var confirmErase = false
    @State private var moving = false
    @State private var moveFailure: String?

    var body: some View {
        FilmForm {
            if let pairing = model.syncPairing {
                onSections(pairing)
            } else {
                offSections
            }
        }
        .confirmationDialog("Turn Off and Erase", isPresented: $confirmErase, titleVisibility: .visible) {
            Button("Turn Off and Erase", role: .destructive) { turnOff(erase: true) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes the synced copy from your Worker, so your other devices can't sync until you turn Sync on again. The settings on this device stay.")
        }
    }

    // MARK: Off

    @ViewBuilder
    private var offSections: some View {
        if model.account != nil {
            // Once an account is on, a device that isn't paired isn't offered Turn On Sync: the account is the sync.
            Section {
                NavigationLink(value: Route.settings(.account)) { Text("Marquee Account") }
            } header: {
                FilmSectionHeader("Marquee Sync")
            } footer: { FilmFooter {
                Text("This device uses a Marquee Account, which syncs your settings and your library. Marquee Sync, the older pairing, isn't offered once an account is on.")
            } }
        } else {
            Section {
                NavigationLink(value: Route.settings(.account)) { Text("Use a Marquee Account Instead") }
            } footer: { FilmFooter {
                Text("A Marquee Account needs no key, server or token to log in: just a 16-digit number. It syncs your library along with your settings.")
            } }
            pairingOffSections
        }
    }

    @ViewBuilder
    private var pairingOffSections: some View {
        Section {
            TextField("Worker Address", text: $server, prompt: Text(verbatim: "https://your-worker.workers.dev")).syncField(url: true)
            SecureField("Token", text: $token, prompt: Text(verbatim: "The Worker's token")).syncField()
            Button {
                turnOn()
            } label: {
                HStack {
                    Text("Turn On Sync")
                    if working { Spacer(); ProgressView() }
                }
            }
            .disabled(working || server.nonEmpty == nil || token.nonEmpty == nil)
            // Also what turned Sync off by itself, like an erase from another device.
            if let message = failure ?? model.syncError { Text(message).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.red) }
        } header: {
            FilmSectionHeader("Turn On Sync")
        } footer: { FilmFooter {
            Text(syncExplainer + " Use the stream proxy Worker from web/proxy, with a KV namespace bound as SYNC.")
        } }

        Section {
            NavigationLink {
                SyncJoinView()
            } label: {
                Text("Join a Sync")
            }
        } footer: { FilmFooter {
            Text("Already syncing on another device? Join it with its pairing link, or with its key, server and token.")
        } }
    }

    // MARK: On

    @ViewBuilder
    private func onSections(_ pairing: FlowSyncPairing) -> some View {
        #if os(tvOS)
        // Across the room, the code and the key are the point of this page.
        Section {
            SyncPairingCard(pairing: pairing, large: true)
        }
        #endif

        Section {
            HStack {
                Label("Sync Is On", systemImage: "arrow.triangle.2.circlepath")
                Spacer()
                if model.isSyncingNow { ProgressView() }
            }
            LabeledContent("Last Synced") {
                if let last = model.syncLastSynced {
                    Text(last, format: .relative(presentation: .numeric, unitsStyle: .wide))
                } else {
                    Text("Not yet")
                }
            }
            LabeledContent("Server", value: pairing.serverHost)
            if let error = model.syncError {
                Label {
                    Text(error)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.warn)
            }
        } header: {
            FilmSectionHeader("Marquee Sync")
        } footer: { FilmFooter {
            Text(syncExplainer)
        } }

        Section {
            Button { model.syncNow() } label: {
                Label("Sync Now", systemImage: "arrow.clockwise")
            }
            .disabled(model.isSyncingNow)
            #if !os(tvOS)
            NavigationLink(value: Route.settings(.syncPairing)) {
                Label("Show Pairing Link", systemImage: "qrcode")
            }
            #endif
        }

        Section {
            Button { move() } label: {
                HStack {
                    Text("Move to an Account")
                    if moving { Spacer(); ProgressView() }
                }
            }
            .disabled(moving)
            if let moveFailure { Text(moveFailure).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.red) }
        } footer: { FilmFooter {
            Text("Makes a Marquee Account from this device's settings and library, shows you its number to write down, and turns Marquee Sync off here. Your other paired devices keep syncing settings until they move too.")
        } }

        Section {
            // Not the accent: the accent marks the next action, and this one is a way out.
            Button { turnOff(erase: false) } label: {
                Text("Turn Off Sync")
                    #if !os(tvOS)
                    .foregroundStyle(Theme.Palette.text)
                    #endif
            }
            Button("Turn Off and Erase", role: .destructive) { confirmErase = true }
            if let failure { Text(failure).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.red) }
        } footer: { FilmFooter {
            Text("Turn Off Sync forgets the key on this device and keeps your settings. Turn Off and Erase also deletes the synced copy from your Worker, so no other device can sync until you turn it on again.")
        } }
    }

    // MARK: Actions

    private func turnOn() {
        working = true
        failure = nil
        Task {
            let problem = await model.turnOnSync(server: server, token: token)
            working = false
            if let problem { failure = problem } else { server = ""; token = "" }
        }
    }

    private func turnOff(erase: Bool) {
        failure = nil
        Task { failure = await model.turnOffSync(erase: erase) }
    }

    private func move() {
        moveFailure = nil
        moving = true
        Task {
            let problem = await model.moveToAccount()
            moving = false
            if let problem { moveFailure = problem } else { model.settingsPath.append(.settings(.accountNumber)) }
        }
    }
}

/// The key and the way to hand it to another device: a QR code of the pairing link, the grouped key, and the link
/// itself with Copy and Share. Large enough on Apple TV to read from the sofa.
struct SyncPairingCard: View {
    let pairing: FlowSyncPairing
    var large = false

    private var link: String { FlowSyncLink.appLink(pairing) }
    private var grouped: String { pairing.key?.grouped ?? pairing.keyText }

    var body: some View {
        if large {
            HStack(alignment: .center, spacing: Theme.Space.xl) {
                qr(side: 340)
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    Text("Sync Key").font(Theme.Typeface.edgePrint).edgePrint().foregroundStyle(Theme.Palette.print)
                    Text(grouped)
                        .font(.system(size: 50, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Theme.Palette.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Text("Scan the code on your iPhone, iPad or Mac, or type this key into Marquee on another device along with your server and token.")
                        .font(.system(.title3))
                        .foregroundStyle(Theme.Palette.textSecondary)
                }
            }
            .padding(.vertical, Theme.Space.m)
            .accessibilityElement(children: .combine)
        } else {
            VStack(spacing: Theme.Space.l) {
                qr(side: 220)
                VStack(spacing: Theme.Space.xs) {
                    Text("Sync Key").font(Theme.Typeface.edgePrint).edgePrint().foregroundStyle(Theme.Palette.print)
                    Text(grouped)
                        .font(.system(.title3, design: .monospaced).weight(.semibold))
                        .foregroundStyle(Theme.Palette.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        #if !os(tvOS)
                        .textSelection(.enabled)
                        #endif
                }
                Text(link)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Theme.Palette.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .truncationMode(.middle)
                    #if !os(tvOS)
                    .textSelection(.enabled)
                    #endif
                #if !os(tvOS)
                HStack(spacing: Theme.Space.s) {
                    Button { Platform.copyToPasteboard(link) } label: { Label("Copy Link", systemImage: "doc.on.doc") }
                    Button { Platform.copyToPasteboard(pairing.key?.grouped ?? pairing.keyText) } label: { Label("Copy Key", systemImage: "key") }
                    ShareLink(item: link) { Label("Share", systemImage: "square.and.arrow.up") }
                }
                .buttonStyle(GlassButtonStyle(compact: true))
                #endif
                Text("Anyone with this link can read your synced settings. Share it only with your own devices.")
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.textTertiary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private func qr(side: CGFloat) -> some View {
        if let image = QRCode.image(for: link, scale: 8) {
            image
                .interpolation(.none)
                .resizable()
                .frame(width: side, height: side)
                .padding(side / 20)
                .background(.white, in: Rectangle())
                .accessibilityLabel("QR code of the sync pairing link")
        }
    }
}

/// Show Pairing Link, on iPhone, iPad and Mac. Apple TV shows the same card on the Sync page itself.
struct SyncPairingView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            if let pairing = model.syncPairing {
                SyncPairingCard(pairing: pairing)
                    .padding(Theme.Space.l)
                    .frame(maxWidth: 520)
                    .frame(maxWidth: .infinity)
            } else {
                Text("Sync is off.").foregroundStyle(Theme.Palette.textSecondary).padding(Theme.Space.l)
            }
        }
        .filmGround()
    }
}

/// Joining a sync another device made: a pairing link (iPhone, iPad, Mac), or its key, server and token typed in.
struct SyncJoinView: View {
    var initialLink: String?
    var isSheet = false
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var linkProblem: String?
    @State private var keyText = ""
    @State private var server = ""
    @State private var token = ""
    @State private var working = false
    @State private var failure: String?

    init(initialLink: String? = nil, isSheet: Bool = false) {
        self.initialLink = initialLink
        self.isSheet = isSheet
    }

    private var canJoin: Bool { FlowSyncKey.isValid(keyText) && server.nonEmpty != nil && token.nonEmpty != nil && !working }

    var body: some View {
        FilmForm {
            #if !os(tvOS)
            Section {
                TextField("Pairing Link", text: $link, prompt: Text(verbatim: "flow://sync?k=…"), axis: .vertical)
                    .lineLimit(1...4)
                    .syncField(url: true)
                Button("Paste") { link = Platform.pasteboardString() ?? "" }
                if let linkProblem { Text(linkProblem).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.red) }
            } header: {
                FilmSectionHeader("Pairing Link")
            } footer: { FilmFooter {
                Text("Paste the link from Show Pairing Link on your other device, or scan its code with the camera.")
            } }
            #endif

            Section {
                TextField("Sync Key", text: $keyText, prompt: Text(verbatim: "0000-0000-0000-0000-0000-0000-00"))
                    .font(.system(.body, design: .monospaced))
                    .syncField()
                TextField("Worker Address", text: $server, prompt: Text(verbatim: "https://your-worker.workers.dev")).syncField(url: true)
                SecureField("Token", text: $token, prompt: Text(verbatim: "The Worker's token")).syncField()
            } header: {
                FilmSectionHeader(Platform.isTV ? "Key, Server and Token" : "Or Type Them In")
            } footer: { FilmFooter {
                if Platform.isTV {
                    Text("The key is on the Sync page of your other device, under Show Pairing Link. Letters and numbers only; dashes are optional.")
                }
            } }

            Section {
                Button {
                    join()
                } label: {
                    HStack {
                        Text("Join Sync")
                        if working { Spacer(); ProgressView() }
                    }
                }
                .disabled(!canJoin)
                if let failure { Text(failure).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.red) }
            } footer: { FilmFooter {
                if model.syncIsOn {
                    Text("This device is already syncing. Joining another sync replaces that one here and leaves it as it is on the server.")
                } else {
                    Text("This device's settings are kept; anything the sync has that this device doesn't is added.")
                }
            } }
        }
        // Pushed from Settings, the page already has its title; as a sheet it needs its own.
        .modifier(JoinTitle(isSheet: isSheet))
        .onChange(of: link) { _, _ in fillFromLink() }
        .task(id: initialLink) { if let initialLink { link = initialLink; fillFromLink() } }
        #if !os(tvOS)
        .toolbar {
            // Pushed from the Sync page, Back already leaves; opened from a link or the welcome screen, it's a sheet.
            if isSheet {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        model.pendingSyncLink = nil
                        dismiss()
                    }
                }
            }
        }
        #endif
    }

    private func fillFromLink() {
        let text = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { linkProblem = nil; return }
        do {
            let pairing = try FlowSyncLink.parse(text)
            keyText = pairing.key?.grouped ?? pairing.keyText
            server = pairing.server
            token = pairing.token
            linkProblem = nil
        } catch {
            linkProblem = Self.describe(error)
        }
    }

    private func join() {
        failure = nil
        let pairing: FlowSyncPairing
        do {
            pairing = try FlowSyncPairing(key: keyText, server: server, token: token)
        } catch {
            failure = Self.describe(error)
            return
        }
        working = true
        Task {
            let problem = await model.joinSync(pairing)
            working = false
            if let problem {
                failure = problem
            } else {
                model.pendingSyncLink = nil
                dismiss()
            }
        }
    }

    private static func describe(_ error: Error) -> String { AppModel.syncMessage(error) }
}

private struct JoinTitle: ViewModifier {
    let isSheet: Bool

    func body(content: Content) -> some View {
        if isSheet {
            content.flowPageTitle("Join a Sync").inlineNavigationTitle()
        } else {
            content
        }
    }
}

// MARK: - Marquee Accounts

/// What an account carries, said the same way wherever it is offered.
private let accountExplainer = "A Marquee Account keeps your settings, watchlist, favourites, watch history, resume points and ratings the same on your iPhone, iPad, Mac, Apple TV and the website. There's no username and no password: Create Account makes a 16-digit number, and that number is the account. Everything is end-to-end encrypted on your device before it goes to your own Worker, which only ever stores scrambled data."

private extension View {
    /// The 16 digits: no autocorrect, no capitals, and the number pad (the remote's digit entry on Apple TV).
    func accountNumberField() -> some View {
        autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.never)
            #endif
            #if os(iOS) || os(tvOS)
            .keyboardType(.numberPad)
            #endif
    }
}

/// Settings → Account's "Marquee Account" group, at the top: how to get an account when there isn't one, and what to do with
/// it when there is.
struct MarqueeAccountSections: View {
    @Environment(AppModel.self) private var model
    @State private var showNumber = false
    @State private var confirmLogOut = false
    @State private var confirmDelete = false
    @State private var failure: String?
    @State private var deleting = false

    var body: some View {
        if let account = model.account {
            onSections(account)
        } else {
            offSections
        }
    }

    // MARK: Off

    @ViewBuilder
    private var offSections: some View {
        Section {
            NavigationLink(value: Route.settings(.accountCreate)) { Text("Create Account") }
            NavigationLink(value: Route.settings(.accountLogIn)) { Text("Log In") }
        } header: {
            FilmSectionHeader("Marquee Account")
        } footer: { FilmFooter {
            Text(accountExplainer)
        } }
        AccountServerSection()
    }

    // MARK: On

    @ViewBuilder
    private func onSections(_ account: AccountCredentials) -> some View {
        Section {
            HStack {
                Text("Account On")
                Spacer()
                if model.isSyncingAccount { ProgressView() }
            }
            #if os(tvOS)
            // Across the room, the number is the point of its own page.
            NavigationLink(value: Route.settings(.accountNumber)) { Text("Show Account Number") }
            #else
            LabeledContent("Account Number") {
                Text(showNumber ? AccountNumber.group(account.number) : "•••• •••• •••• ••••")
                    .font(Theme.Typeface.body)
                    .foregroundStyle(showNumber ? Theme.Palette.fg : Theme.Palette.muted)
                    .textSelection(.enabled)
                    .accessibilityLabel(showNumber ? "Account number " + account.number.map(String.init).joined(separator: " ") : "Account number, hidden")
            }
            Button(showNumber ? "Hide Number" : "Show Number") { showNumber.toggle() }
            Button("Copy Number") {
                Platform.copyToPasteboard(AccountNumber.group(account.number))
                model.showToast("Account number copied")
            }
            #endif
            LabeledContent("Last Synced") {
                if let last = model.accountLastSynced {
                    Text(last, format: .relative(presentation: .numeric, unitsStyle: .wide))
                } else {
                    Text("Not yet")
                }
            }
            if let error = model.accountError {
                Label {
                    Text(error)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.warn)
            }
        } header: {
            FilmSectionHeader("Marquee Account")
        } footer: { FilmFooter {
            Text("Keeps your settings and your library the same on every device that logs in with this number. Anything you remove stays removed everywhere.")
        } }

        Section {
            Button { model.accountSyncNow() } label: {
                Label("Sync Now", systemImage: "arrow.clockwise")
            }
            .disabled(model.isSyncingAccount)
        }

        Section {
            // Not the accent: the accent marks the next action, and these are ways out.
            Button { confirmLogOut = true } label: {
                Text("Log Out")
                    #if !os(tvOS)
                    .foregroundStyle(Theme.Palette.text)
                    #endif
            }
            .confirmationDialog("Log Out", isPresented: $confirmLogOut, titleVisibility: .visible) {
                Button("Log Out and Keep My Data") { Task { await model.logOutOfAccount(clearingData: false) } }
                Button("Log Out and Clear This Device", role: .destructive) { Task { await model.logOutOfAccount(clearingData: true) } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The account and its data stay as they are, and you can log back in with your number. Clearing this device sets its settings, library and remembered sources back to a fresh install.")
            }
            Button("Delete Account", role: .destructive) { confirmDelete = true }
                .confirmationDialog("Delete Account", isPresented: $confirmDelete, titleVisibility: .visible) {
                    Button("Delete Account", role: .destructive) { delete() }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("This deletes the account and everything stored in it from your Worker, so your other devices stop syncing. The settings and library on this device stay.")
                }
                .disabled(deleting)
            if let failure { Text(failure).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.red) }
        } footer: { FilmFooter {
            Text("Log Out forgets the number on this device. Delete Account removes the account from the server for good.")
        } }
    }

    private func delete() {
        failure = nil
        deleting = true
        Task {
            failure = await model.deleteAccount()
            deleting = false
        }
    }
}

/// Builds that name no account server ask for one. A build's own address always wins, so this is empty and hidden when
/// `FLOW_ACCOUNT_SERVER_HOST` is set.
private struct AccountServerSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if !model.accountServerIsBuiltIn {
            Section {
                TextField("Account Server", text: Binding(get: { model.accountServerText }, set: { model.accountServerText = $0 }),
                          prompt: Text(verbatim: "your-worker.workers.dev"))
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
            } header: {
                FilmSectionHeader("Account Server")
            } footer: { FilmFooter {
                Text("This build has no account server set. Enter the address of your Worker, the one from web/proxy, to create an account or log in.")
            } }
        }
    }
}

/// A sheet's own title and Cancel; a page pushed from Settings already has its title.
private struct AccountPageTitle: ViewModifier {
    let title: String
    let isSheet: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    func body(content: Content) -> some View {
        if isSheet {
            content
                .flowPageTitle(title)
                .inlineNavigationTitle()
                // A number that hasn't been written down yet can't be walked away from.
                .sheetDismissButton { if model.pendingAccountNumber == nil { dismiss() } }
        } else {
            content
        }
    }
}

/// Log In: the 16 digits, grouped as they are typed.
struct AccountLogInView: View {
    var isSheet = false
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var working = false
    @State private var failure: String?

    init(isSheet: Bool = false) { self.isSheet = isSheet }

    private var canLogIn: Bool { AccountNumber.isValid(text) && !working }

    var body: some View {
        FilmForm {
            Section {
                TextField("Account Number", text: $text, prompt: Text(verbatim: "0000 0000 0000 0000"))
                    .font(Theme.Typeface.heading)
                    .accountNumberField()
                    .onChange(of: text) { _, new in
                        let formatted = AccountNumber.formatTyped(new)
                        if formatted != new { text = formatted }
                    }
                    .onSubmit { if canLogIn { logIn() } }
                #if !os(tvOS)
                Button("Paste") { text = AccountNumber.formatTyped(Platform.pasteboardString() ?? "") }
                #endif
            } header: {
                FilmSectionHeader("Account Number")
            } footer: { FilmFooter {
                Text("The 16 digits you wrote down when you made your account.")
            } }

            AccountServerSection()

            Section {
                Button {
                    logIn()
                } label: {
                    HStack {
                        Text("Log In")
                        if working { Spacer(); ProgressView() }
                    }
                }
                .disabled(!canLogIn)
                if let failure { Text(failure).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.red) }
            } footer: { FilmFooter {
                Text("This device's settings and library are kept and merged with your account's. Nothing on it is dropped.")
            } }
        }
        .modifier(AccountPageTitle(title: "Log In", isSheet: isSheet))
    }

    private func logIn() {
        failure = nil
        working = true
        Task {
            let problem = await model.logInToAccount(text)
            working = false
            if let problem { failure = problem } else { dismiss() }
        }
    }
}

/// Create Account: one button, then the number to write down.
struct AccountCreateView: View {
    var isSheet = false
    @Environment(AppModel.self) private var model
    @State private var working = false
    @State private var failure: String?

    init(isSheet: Bool = false) { self.isSheet = isSheet }

    var body: some View {
        Group {
            if model.pendingAccountNumber != nil {
                AccountNumberView(isSheet: isSheet)
            } else {
                FilmForm {
                    Section {
                        Button {
                            create()
                        } label: {
                            HStack {
                                Text("Create Account")
                                if working { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(working)
                        if let failure { Text(failure).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.red) }
                    } header: {
                        FilmSectionHeader("Marquee Account")
                    } footer: { FilmFooter {
                        Text(accountExplainer + " What this device holds goes up as soon as the account exists.")
                    } }
                    AccountServerSection()
                }
                .modifier(AccountPageTitle(title: "Create Account", isSheet: isSheet))
            }
        }
    }

    private func create() {
        failure = nil
        working = true
        Task {
            failure = await model.createAccount()
            working = false
        }
    }
}

/// The number, large: to write down when the account has just been made, and to read again later.
struct AccountNumberView: View {
    var isSheet = false
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var written = false

    init(isSheet: Bool = false) { self.isSheet = isSheet }

    private var confirming: Bool { model.pendingAccountNumber != nil }

    var body: some View {
        FilmForm {
            if let number = model.pendingAccountNumber ?? model.account?.number {
                Section {
                    AccountNumberCard(number: number)
                } header: {
                    FilmSectionHeader(confirming ? "Write This Down" : "Account Number")
                } footer: { FilmFooter {
                    Text(confirming
                         ? "Write this down. It’s the only way back into your account. There’s no password to reset, and nobody, Marquee included, can recover it for you."
                         : "Anyone with this number can log in to your account. Keep it somewhere safe.")
                } }

                #if !os(tvOS)
                Section {
                    Button("Copy Number") {
                        Platform.copyToPasteboard(AccountNumber.group(number))
                        model.showToast("Account number copied")
                    }
                    ShareLink(item: AccountNumber.group(number)) { Text("Share Number") }
                }
                #endif

                if confirming {
                    Section {
                        Toggle("I’ve Written It Down Somewhere Safe", isOn: $written)
                        Button {
                            model.pendingAccountNumber = nil
                            dismiss()
                        } label: {
                            Text("Continue")
                        }
                        .buttonStyle(PrimaryButtonStyle(fill: true))
                        .disabled(!written)
                        // The row is the button; keep the list from drawing a second background behind it.
                        .listRowBackground(Color.clear)
                    }
                }
            } else {
                Section { Text("No account is on this device.").foregroundStyle(Theme.Palette.muted) }
            }
        }
        .modifier(AccountPageTitle(title: confirming ? "Write It Down" : "Account Number", isSheet: isSheet))
    }
}

/// The number as the apps show it: grouped in fours, in a ruled frame, large enough to copy down by hand. Apple TV sets it
/// larger still, to read from the sofa.
struct AccountNumberCard: View {
    let number: String

    var body: some View {
        Text(AccountNumber.group(number))
            .font(Theme.Typeface.custom(Theme.Face.monoSemiBold, 30, .title))
            .foregroundStyle(Theme.Palette.fg)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .padding(Theme.Space.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(Rectangle().strokeBorder(Theme.Palette.rule, lineWidth: Theme.Rule.heavy))
            #if !os(tvOS)
            .textSelection(.enabled)
            #endif
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Account number")
            .accessibilityValue(number.map(String.init).joined(separator: " "))
    }
}
