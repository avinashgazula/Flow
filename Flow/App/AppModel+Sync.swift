import SwiftUI
import FlowKit

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

    /// Straight away: the app coming to the front, a refreshed sign-in, Sync Now.
    func syncNow() {
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
        guard syncPairing != nil, !isDemo else { return nil }
        await runSync()
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
        syncPushTask?.cancel()
        syncPairing = nil
        syncPairingStore.save(nil)
        syncState = FlowSyncState()
        let store = self.store
        Self.persistence.async { store.remove("sync-state") }
        syncLastSynced = nil
        syncError = nil
        return nil
    }

    /// A fixed, made-up sync for the screenshot tour. Nothing is stored and, in demo mode, nothing is ever sent.
    func showDemoSync() {
        guard isDemo else { return }
        syncPairing = FlowSyncPairing(keyText: "000G40R40M30E209185GR38E1W", server: "https://flow-sync.example.workers.dev", token: "demo-token")
        syncLastSynced = Date().addingTimeInterval(-120)
        syncError = nil
    }
}
