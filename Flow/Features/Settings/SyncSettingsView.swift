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
        Section {
            TextField("Worker Address", text: $server, prompt: Text("https://your-worker.workers.dev")).syncField(url: true)
            SecureField("Token", text: $token, prompt: Text("The Worker's token")).syncField()
            Button {
                turnOn()
            } label: {
                HStack {
                    Text("Turn On Sync")
                    if working { Spacer(); ProgressView() }
                }
            }
            .disabled(working || server.nonEmpty == nil || token.nonEmpty == nil)
            if let failure { Text(failure).font(.footnote).foregroundStyle(Theme.Palette.red) }
        } header: {
            Text("Turn On Sync")
        } footer: {
            Text(syncExplainer + " Use the stream proxy Worker from web/proxy, with a KV namespace bound as SYNC.")
        }

        Section {
            NavigationLink {
                SyncJoinView()
            } label: {
                Text("Join a Sync")
            }
        } footer: {
            Text("Already syncing on another device? Join it with its pairing link, or with its key, server and token.")
        }
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
                    Text(last, style: .relative) + Text(" ago")
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
                .font(.footnote)
                .foregroundStyle(Theme.Palette.warn)
            }
        } header: {
            Text("Flow Sync")
        } footer: {
            Text(syncExplainer)
        }

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
            Button("Turn Off Sync") { turnOff(erase: false) }
            Button("Turn Off and Erase", role: .destructive) { confirmErase = true }
            if let failure { Text(failure).font(.footnote).foregroundStyle(Theme.Palette.red) }
        } footer: {
            Text("Turn Off Sync forgets the key on this device and keeps your settings. Turn Off and Erase also deletes the synced copy from your Worker, so no other device can sync until you turn it on again.")
        }
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
                    Text("Scan the code on your iPhone, iPad or Mac, or type this key into Flow on another device along with your server and token.")
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
                    .font(.footnote)
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
                .background(.white, in: RoundedRectangle(cornerRadius: side / 20, style: .continuous))
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
                TextField("Pairing Link", text: $link, prompt: Text("flow://sync?k=…"), axis: .vertical)
                    .lineLimit(1...4)
                    .syncField(url: true)
                Button("Paste") { link = Platform.pasteboardString() ?? "" }
                if let linkProblem { Text(linkProblem).font(.footnote).foregroundStyle(Theme.Palette.red) }
            } header: {
                Text("Pairing Link")
            } footer: {
                Text("Paste the link from Show Pairing Link on your other device, or scan its code with the camera.")
            }
            #endif

            Section {
                TextField("Sync Key", text: $keyText, prompt: Text("0000-0000-0000-0000-0000-0000-00"))
                    .font(.system(.body, design: .monospaced))
                    .syncField()
                TextField("Worker Address", text: $server, prompt: Text("https://your-worker.workers.dev")).syncField(url: true)
                SecureField("Token", text: $token, prompt: Text("The Worker's token")).syncField()
            } header: {
                Text(Platform.isTV ? "Key, Server and Token" : "Or Type Them In")
            } footer: {
                if Platform.isTV {
                    Text("The key is on the Sync page of your other device, under Show Pairing Link. Letters and numbers only; dashes are optional.")
                }
            }

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
                if let failure { Text(failure).font(.footnote).foregroundStyle(Theme.Palette.red) }
            } footer: {
                if model.syncIsOn {
                    Text("This device is already syncing. Joining another sync replaces that one here and leaves it as it is on the server.")
                } else {
                    Text("This device's settings are kept; anything the sync has that this device doesn't is added.")
                }
            }
        }
        .flowPageTitle("Join a Sync")
        .inlineNavigationTitle()
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
