import SwiftUI
import FlowKit
#if canImport(UIKit)
import UIKit
#endif

/// Flow Sync in the app: when to talk to the Worker, and how a pull lands in settings (docs/SYNC.md).
/// The merge, the crypto and the client live in FlowKit; this only decides when, and applies the result
/// through the same paths the settings screens use, so services pick the values up as if they were typed.
extension AppModel {
    var syncIsOn: Bool { syncPairing != nil }

    // MARK: When

    /// About three seconds after the last change to a synced value, so typing a key is one write and not one a letter.
    func scheduleSyncPush() {
        guard syncPairing != nil, !applyingSync, !isDemo else { return }
        syncPushTask?.cancel()
        syncPushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            await self?.runSync()
        }
    }

    /// Straight away: the app coming to the front, a refreshed sign-in, Sync Now. A Marquee Account is looked at too.
    func syncNow() {
        accountSyncNow()
        guard syncPairing != nil, !isDemo else { return }
        syncPushTask?.cancel()
        Task { await runSync() }
    }

    /// One round at a time. A request that arrives mid-round makes the round go again, and waits for that.
    func runSync() async {
        guard !isDemo, syncPairing != nil else { return }
        if let running = syncInFlight {
            syncAgain = true
            await running.value
            return
        }
        let task = Task { await self.syncLoop(createIfMissing: true) }
        syncInFlight = task
        await task.value
    }

    private func syncLoop(createIfMissing: Bool) async {
        isSyncingNow = true
        var create = createIfMissing
        repeat {
            syncAgain = false
            await syncOnce(createIfMissing: create)
            create = true
        } while syncAgain && syncPairing != nil
        isSyncingNow = false
        syncInFlight = nil
    }

    private func syncOnce(createIfMissing: Bool) async {
        guard let pairing = syncPairing else { return }
        do {
            let client = try FlowSyncClient(pairing: pairing, http: http)
            let engine = FlowSyncEngine(client: client, device: Platform.deviceKind)
            let snapshot = FlowSyncMapping.sections(credentials: credentials, settings: settings)
            let outcome = try await engine.sync(local: snapshot, state: syncState, createIfMissing: createIfMissing)
            // Turned off, or switched to another sync, while the request was out.
            guard syncPairing == pairing else { return }
            applySynced(outcome.apply, since: snapshot)
            syncState = outcome.state
            let store = self.store, state = outcome.state
            Self.persistence.async { store.save(state, "sync-state") }
            syncLastSynced = outcome.state.lastSyncedAt
            syncError = nil
        } catch is CancellationError {
        } catch FlowError.cancelled {
        } catch FlowSyncError.erased {
            // Erased from another device: sync turns itself off here (the settings stay), and says why.
            guard syncPairing == pairing else { return }
            forgetSyncLocally()
            syncError = FlowSyncError.erased.errorDescription
        } catch {
            if syncPairing == pairing { syncError = Self.syncMessage(error) }
        }
    }

    static func syncMessage(_ error: Error) -> String {
        if let error = error as? FlowSyncError { return error.errorDescription ?? FlowSyncError.unreachable.errorDescription! }
        if let error = error as? FlowError, let text = error.errorDescription { return text }
        return FlowSyncError.unreachable.errorDescription!
    }

    // MARK: Landing a pull

    /// Puts the sections the server won into this device's settings. A section the person changed while the
    /// request was out is left alone: their edit is newer, and goes up on the next round.
    private func applySynced(_ apply: [String: JSONValue], since snapshot: [String: JSONValue]) {
        guard !apply.isEmpty else { return }
        let current = FlowSyncMapping.sections(credentials: credentials, settings: settings)
        var newCredentials = credentials
        var newSettings = settings
        var applied: [String] = []
        for (name, data) in apply where current[name] == snapshot[name] {
            FlowSyncMapping.apply(data, to: name, credentials: &newCredentials, settings: &newSettings)
            applied.append(name)
        }
        FlowSyncMapping.adoptTracker(&newSettings.account, before: credentials, after: newCredentials)
        applyingSync = true
        if newCredentials != credentials { credentials = newCredentials }
        if newSettings != settings { settings = newSettings }
        applyingSync = false
        let touchedServices = applied.contains { [FlowSyncSectionName.keys, FlowSyncSectionName.accounts, FlowSyncSectionName.servers].contains($0) }
        if touchedServices {
            contentVersion += 1
            Task { await refreshLibrary(force: true) }
        }
    }

    /// Before Trakt spends a refresh token: pull, and hand back a newer sign-in if another device already refreshed.
    func traktTokenAfterPull(_ current: OAuthToken) async -> OAuthToken? {
        guard syncPairing != nil || account != nil, !isDemo else { return nil }
        if syncPairing != nil { await runSync() } else { await runAccountSync() }
        guard let latest = credentials.traktToken, latest != current else { return nil }
        return latest
    }

    // MARK: Turning on and off

    /// Makes a new sync key on this device. Returns what went wrong, in words, or nil once the first round worked.
    func turnOnSync(server: String, token: String) async -> String? {
        do {
            return await startSync(try FlowSyncPairing(key: FlowSyncKey.generate(), server: server, token: token), joining: false)
        } catch {
            return Self.syncMessage(error)
        }
    }

    /// Joins the sync another device made. A key with nothing on the server is refused rather than started afresh.
    func joinSync(_ pairing: FlowSyncPairing) async -> String? {
        await startSync(pairing, joining: true)
    }

    private func startSync(_ pairing: FlowSyncPairing, joining: Bool) async -> String? {
        if isDemo { return "Leave the sample data to turn on Sync. It would have nothing of yours to sync." }
        while let running = syncInFlight { await running.value }
        let previous = (syncPairing, syncState, syncLastSynced)
        syncPushTask?.cancel()
        syncPairing = pairing
        syncState = FlowSyncState()
        syncError = nil
        let task = Task { await self.syncLoop(createIfMissing: !joining) }
        syncInFlight = task
        await task.value
        if let failure = syncError {
            // It didn't work: stay as before, and say why.
            (syncPairing, syncState, syncLastSynced) = previous
            syncError = nil
            return failure
        }
        syncPairingStore.save(pairing)
        return nil
    }

    /// Forgets the key on this device and keeps the local settings. With `erase`, deletes the server's copy first,
    /// so no other device can sync until someone turns Sync on again.
    func turnOffSync(erase: Bool) async -> String? {
        guard let pairing = syncPairing else { return nil }
        if erase {
            do {
                try await FlowSyncClient(pairing: pairing, http: http).delete()
            } catch {
                return Self.syncMessage(error)
            }
        }
        while let running = syncInFlight { await running.value }
        forgetSyncLocally()
        return nil
    }

    private func forgetSyncLocally() {
        syncPushTask?.cancel()
        syncPairing = nil
        syncPairingStore.save(nil)
        syncState = FlowSyncState()
        let store = self.store
        Self.persistence.async { store.remove("sync-state") }
        syncLastSynced = nil
        syncError = nil
    }

    /// A fixed, made-up sync for the screenshot tour. Nothing is stored and, in demo mode, nothing is ever sent.
    func showDemoSync() {
        guard isDemo else { return }
        syncPairing = FlowSyncPairing(keyText: "000G40R40M30E209185GR38E1W", server: "https://flow-sync.example.workers.dev", token: "demo-token")
        syncLastSynced = Date().addingTimeInterval(-120)
        syncError = nil
    }

    func hideDemoSync() {
        guard isDemo else { return }
        syncPairing = nil
        syncLastSynced = nil
        syncError = nil
    }
}

// MARK: - Marquee Accounts

/// Marquee Accounts in the app: when to talk to the account server, and how a pull lands in settings and the library
/// (docs/SYNC.md). The number, the keys, the merge and the client live in FlowKit; this only decides when, and puts the
/// result in through the same paths the screens use, so everything picks it up as if it had been done here.
extension AppModel {
    var accountIsOn: Bool { account != nil }

    /// The server this build names (`FLOW_ACCOUNT_SERVER_HOST`), else the one typed under Settings.
    var accountServerURL: URL? { AccountServer.resolve(build: BundleKeys.accountServerHost, typed: accountServerText) }
    var accountServerIsBuiltIn: Bool { AccountServer.url(BundleKeys.accountServerHost) != nil }

    /// The watchlist's arrangement and when it was made, from the keys Library keeps it under.
    var accountOrder: AccountOrder? {
        get {
            let defaults = UserDefaults.standard
            let keys = (defaults.stringArray(forKey: "flow.watchlistOrder") ?? []).compactMap(MediaKey.init(string:))
            if let stamp = defaults.object(forKey: "flow.watchlistOrderUpdatedAt") as? Double {
                return AccountOrder(keys: keys, updatedAt: Date(timeIntervalSince1970: stamp))
            }
            // Arranged before the time was kept: it counts from now, once.
            guard !keys.isEmpty else { return nil }
            let now = Date().timeIntervalSince1970
            defaults.set(now, forKey: "flow.watchlistOrderUpdatedAt")
            return AccountOrder(keys: keys, updatedAt: Date(timeIntervalSince1970: now))
        }
        set {
            let defaults = UserDefaults.standard
            guard let newValue else {
                defaults.removeObject(forKey: "flow.watchlistOrder")
                defaults.removeObject(forKey: "flow.watchlistOrderUpdatedAt")
                return
            }
            defaults.set(newValue.keys.map(\.description), forKey: "flow.watchlistOrder")
            defaults.set(newValue.updatedAt.timeIntervalSince1970, forKey: "flow.watchlistOrderUpdatedAt")
        }
    }

    // MARK: When

    /// About three seconds after the last change, so ticking several episodes is one write. A change that is only a
    /// resume point waits up to a minute, since those tick every few seconds while something plays.
    func scheduleAccountPush(progressOnly: Bool = false) {
        guard account != nil, !applyingAccount, !isDemo else { return }
        if progressOnly {
            guard accountProgressTask == nil, accountPushTask == nil else { return }
            accountProgressTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                guard !Task.isCancelled, let self else { return }
                self.accountProgressTask = nil
                await self.runAccountSync()
            }
            return
        }
        accountPushTask?.cancel()
        accountPushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled, let self else { return }
            self.accountPushTask = nil
            await self.runAccountSync()
        }
    }

    /// A library change as `localLibraryDidChange` sees it. What the last pull put in place isn't the person's own change.
    func noteAccountLibraryChange(from old: LocalLibrary, to new: LocalLibrary) {
        guard account != nil, !isDemo else { return }
        if let applied = accountAppliedLibrary {
            accountAppliedLibrary = nil
            if applied == new { return }
        }
        scheduleAccountPush(progressOnly: new.onlyResumePointsDiffer(from: old))
    }

    /// Straight away: launch, the app coming to the front, Sync Now.
    func accountSyncNow() {
        guard account != nil, !isDemo else { return }
        accountPushTask?.cancel()
        accountPushTask = nil
        accountProgressTask?.cancel()
        accountProgressTask = nil
        Task { await runAccountSync() }
    }

    /// The app going to the background writes what is waiting at once, so a resume point isn't lost with it.
    func flushAccount() {
        guard account != nil, !isDemo, accountPushTask != nil || accountProgressTask != nil else { return }
        accountPushTask?.cancel()
        accountPushTask = nil
        accountProgressTask?.cancel()
        accountProgressTask = nil
        #if os(iOS)
        // The system gives a few seconds to finish what was started as the app left.
        let box = AccountBackgroundTask()
        box.id = UIApplication.shared.beginBackgroundTask(withName: "Marquee Account") {
            UIApplication.shared.endBackgroundTask(box.id)
            box.id = .invalid
        }
        Task {
            await runAccountSync()
            if box.id != .invalid { UIApplication.shared.endBackgroundTask(box.id) }
        }
        #else
        Task { await runAccountSync() }
        #endif
    }

    /// One round at a time. A request that arrives mid-round makes the round go again, and waits for that.
    func runAccountSync() async {
        guard !isDemo, account != nil else { return }
        if let running = accountInFlight {
            accountAgain = true
            await running.value
            return
        }
        let task = Task { await self.accountLoop() }
        accountInFlight = task
        await task.value
    }

    private func accountLoop() async {
        isSyncingAccount = true
        accountProgressTask?.cancel()
        accountProgressTask = nil
        repeat {
            accountAgain = false
            await accountSyncOnce()
        } while accountAgain && account != nil
        isSyncingAccount = false
        accountInFlight = nil
    }

    private func accountSyncOnce() async {
        guard let credentials = account else { return }
        do {
            let client = try await accountClient(for: credentials)
            let snapshot = await accountSnapshot()
            let outcome = try await AccountSyncEngine(client: client, device: Platform.deviceKind).sync(local: snapshot, state: accountState)
            // Logged out, or into another account, while the request was out.
            guard account == credentials else { return }
            await landAccount(outcome, snapshot: snapshot)
            accountState = outcome.state
            saveAccountState()
            accountLastSynced = outcome.state.lastSyncedAt
            accountError = nil
        } catch is CancellationError {
        } catch {
            if account == credentials { accountError = Self.accountMessage(error) }
        }
    }

    static func accountMessage(_ error: Error) -> String {
        if let error = error as? AccountError { return error.errorDescription ?? AccountError.unreachable.errorDescription! }
        if let error = error as? FlowError, let text = error.errorDescription { return text }
        return AccountError.unreachable.errorDescription!
    }

    private func accountClient(for credentials: AccountCredentials) async throws -> AccountClient {
        guard let server = URL(string: credentials.server) else { throw AccountError.invalidServer }
        let keys: AccountKeys
        if let cached = accountKeysCache, cached.number == credentials.number {
            keys = cached.keys
        } else {
            // The slow step, off the main thread.
            keys = await AccountKeys.derive(number: credentials.number)
            accountKeysCache = (credentials.number, keys)
        }
        return AccountClient(server: server, keys: keys, http: http)
    }

    private func accountSnapshot() async -> AccountLocal {
        AccountLocal(settings: FlowSyncMapping.sections(credentials: credentials, settings: settings), library: await local.library,
                     sources: settings.sources.lastSources, order: accountOrder)
    }

    private func saveAccountState() {
        let store = self.store, state = accountState
        Self.persistence.async { store.save(state, "account-state") }
    }

    // MARK: Landing a pull

    /// Puts what the account's copy won into settings, the remembered sources, the watchlist's order and the library. A
    /// thing the person changed while the request was out is left alone: it is newer, and goes up on the next round.
    private func landAccount(_ outcome: AccountOutcome, snapshot: AccountLocal) async {
        applyingAccount = true
        applySynced(outcome.settingsApply, since: snapshot.settings)
        if settings.sources.lastSources == snapshot.sources, outcome.sources != snapshot.sources {
            settings.sources.lastSources = outcome.sources
        }
        applyingAccount = false

        if let order = outcome.order, order != snapshot.order, accountOrder == snapshot.order {
            accountOrder = order
            contentVersion += 1
        }

        if outcome.library != snapshot.library {
            accountAppliedLibrary = outcome.library
            if await local.replace(with: outcome.library, unlessChangedSince: snapshot.library) {
                await refreshLibrary(force: true)
            } else {
                accountAppliedLibrary = nil
            }
        }
    }

    // MARK: Create, log in, out, delete

    /// Makes a number, registers it and uploads what this device holds. The number is left in `pendingAccountNumber` for
    /// the "write this down" step. Returns what went wrong, in words, or nil.
    func createAccount() async -> String? {
        if isDemo { return "Leave the sample data to create an account. It would have nothing of yours to sync." }
        if account != nil { return "This device is already logged in to an account." }
        guard let server = accountServerURL else { return AccountError.noServer.errorDescription }
        while let running = accountInFlight { await running.value }
        do {
            let made = try await AccountLifecycle.create(server: server, http: http)
            accountKeysCache = (made.number, made.client.keys)
            let credentials = AccountCredentials(number: made.number, server: server.absoluteString)
            if let failure = await beginAccount(credentials) {
                // The first upload failed: the account is deleted again, so a number the person never saw doesn't linger.
                try? await made.client.delete()
                accountKeysCache = nil
                return failure
            }
            pendingAccountNumber = made.number
            return nil
        } catch {
            return Self.accountMessage(error)
        }
    }

    /// Logs in with a typed number. What this device holds is kept and merged with the account's, never dropped.
    func logInToAccount(_ input: String) async -> String? {
        if isDemo { return "Leave the sample data to log in. It would have nothing of yours to sync." }
        if account != nil { return "This device is already logged in to an account." }
        guard let server = accountServerURL else { return AccountError.noServer.errorDescription }
        while let running = accountInFlight { await running.value }
        do {
            let found = try await AccountLifecycle.login(number: input, server: server, http: http)
            accountKeysCache = (found.number, found.client.keys)
            return await beginAccount(AccountCredentials(number: found.number, server: server.absoluteString))
        } catch {
            return Self.accountMessage(error)
        }
    }

    /// Runs the first sync. If it fails, this device stays as it was, and the problem comes back in words.
    private func beginAccount(_ credentials: AccountCredentials) async -> String? {
        accountPushTask?.cancel()
        accountPushTask = nil
        accountProgressTask?.cancel()
        accountProgressTask = nil
        account = credentials
        accountState = AccountSyncState()
        accountError = nil
        let task = Task { await self.accountLoop() }
        accountInFlight = task
        await task.value
        if let failure = accountError {
            account = nil
            accountState = AccountSyncState()
            accountLastSynced = nil
            accountError = nil
            return failure
        }
        accountStore.save(credentials)
        return nil
    }

    /// Forgets the number, the keys and what was synced on this device, and stops syncing. Clearing never deletes anything
    /// from the account, and the account is forgotten first so the clearing isn't mistaken for removing everything from it.
    func logOutOfAccount(clearingData: Bool) async {
        accountPushTask?.cancel()
        accountPushTask = nil
        accountProgressTask?.cancel()
        accountProgressTask = nil
        forgetAccountLocally()
        guard clearingData else { return }
        // A fresh install, but not one that writes the empty library over iCloud's copy.
        var fresh = AppSettings()
        fresh.sync.iCloudEnabled = false
        credentials = Credentials()
        settings = fresh
        accountOrder = nil
        accountAppliedLibrary = nil
        await local.replace(LocalLibrary())
        await refreshLibrary(force: true)
        contentVersion += 1
    }

    private func forgetAccountLocally() {
        account = nil
        accountStore.save(nil)
        accountState = AccountSyncState()
        accountKeysCache = nil
        accountLastSynced = nil
        accountError = nil
        pendingAccountNumber = nil
        let store = self.store
        Self.persistence.async { store.remove("account-state") }
    }

    /// Deletes the account and every value in it, then logs out here with this device's data kept. Other devices find out
    /// at their next sync. Returns what went wrong, in words, or nil.
    func deleteAccount() async -> String? {
        guard let credentials = account else { return nil }
        do {
            let client = try await accountClient(for: credentials)
            try await client.delete()
        } catch {
            return "Couldn’t delete it. " + Self.accountMessage(error)
        }
        await logOutOfAccount(clearingData: false)
        return nil
    }

    /// One tap from Marquee Sync: make an account from what this device holds (it is all synced already), then forget the
    /// pairing. The old record stays on the Worker until it is erased from a device that still has the pairing.
    func moveToAccount() async -> String? {
        if let failure = await createAccount() { return failure }
        while let running = syncInFlight { await running.value }
        forgetSyncLocally()
        return nil
    }

    /// A fixed, made-up account for the screenshot tour. Nothing is stored and, in demo mode, nothing is ever sent.
    func showDemoAccount(writeDown: Bool) {
        guard isDemo else { return }
        let number = "0123456789012345"
        account = AccountCredentials(number: number, server: "https://accounts.example.workers.dev")
        accountLastSynced = Date().addingTimeInterval(-90)
        accountError = nil
        pendingAccountNumber = writeDown ? number : nil
    }

    func hideDemoAccount() {
        guard isDemo else { return }
        account = nil
        accountLastSynced = nil
        accountError = nil
        pendingAccountNumber = nil
    }
}

#if os(iOS)
/// The system's handle on the few seconds it grants a leaving app.
private final class AccountBackgroundTask: @unchecked Sendable {
    var id: UIBackgroundTaskIdentifier = .invalid
}
#endif
