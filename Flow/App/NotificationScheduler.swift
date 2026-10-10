import Foundation
import FlowKit

#if os(iOS) || os(macOS)
import UserNotifications

/// Local notifications: new episodes, match kick-offs and results. FlowKit's planner decides what
/// goes out and when; this hands it to the system. tvOS has no alerts, so it gets stubs below.
@MainActor
enum NotificationScheduler {
    private static let notifiedKey = "flow.notifiedResultIDs"
    private static let presenter = ForegroundPresenter()
    private static var refreshTask: Task<Void, Never>?
    private static var lastRefresh = Date.distantPast

    /// Result ids already announced, oldest first, so a score is never sent twice.
    static var notifiedResultIDs: [String] {
        get { UserDefaults.standard.stringArray(forKey: notifiedKey) ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: notifiedKey) }
    }

    /// Lets banners show while Flow is open; results arrive then, and would otherwise be swallowed.
    static func install() {
        UNUserNotificationCenter.current().delegate = presenter
    }

    /// Asks the first time; afterwards reports what the person chose.
    static func requestAuthorization() async -> Bool {
        let center = UNUserNotificationCenter.current()
        switch await center.notificationSettings().authorizationStatus {
        case .denied: return false
        case .notDetermined: return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        default: return true
        }
    }

    /// Never prompts; scheduling quietly waits until the person has said yes.
    static func isAuthorized() async -> Bool {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        return status != .denied && status != .notDetermined
    }

    /// Makes the pending requests of `kinds` exactly `plan`: matching ids are overwritten, the rest removed.
    static func replacePending(kinds: Set<PlannedNotification.Kind>, with plan: [PlannedNotification]) async {
        let center = UNUserNotificationCenter.current()
        let wanted = Set(plan.map(\.id))
        let stale = await center.pendingNotificationRequests().map(\.identifier).filter { id in
            kinds.contains { id.hasPrefix($0.prefix) } && !wanted.contains(id)
        }
        center.removePendingNotificationRequests(withIdentifiers: stale)
        await deliver(plan)
    }

    /// Adds each notification: at its date, or right now when it has none.
    static func deliver(_ items: [PlannedNotification]) async {
        let center = UNUserNotificationCenter.current()
        for item in items {
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.body = item.body
            content.sound = .default
            var trigger: UNNotificationTrigger?
            if let date = item.fireDate {
                let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
                trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            }
            try? await center.add(UNNotificationRequest(identifier: item.id, content: content, trigger: trigger))
        }
    }

    /// Coalesces refreshes: a newer request replaces one still running, and a plain foreground
    /// return within ten minutes of the last is skipped.
    static func scheduleRefresh(force: Bool, _ work: @escaping @MainActor () async -> Void) {
        guard force || Date().timeIntervalSince(lastRefresh) > 600 else { return }
        lastRefresh = Date()
        refreshTask?.cancel()
        refreshTask = Task { await work() }
    }
}

/// Shows notifications as banners while Flow is in the foreground.
private final class ForegroundPresenter: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}

extension AppModel {
    /// Rebuilds the pending episode and kick-off alerts and announces any new results. Switched-off
    /// kinds are cleared; a kind whose data couldn't be fetched keeps what it had.
    func refreshNotifications() async {
        guard !isDemo else { return }
        let general = settings.general
        let switches: [(PlannedNotification.Kind, Bool)] = [
            (.episode, general.episodeNotifications),
            (.matchStart, general.matchStartNotifications),
            (.matchResult, general.matchResultNotifications),
        ]
        let off = Set(switches.filter { !$0.1 }.map { $0.0 })
        if !off.isEmpty { await NotificationScheduler.replacePending(kinds: off, with: []) }
        guard switches.contains(where: { $0.1 }), await NotificationScheduler.isAuthorized() else { return }

        var plan: [PlannedNotification] = []
        var replace: Set<PlannedNotification.Kind> = []
        if general.episodeNotifications, let sources = await upcomingEpisodeSources() {
            plan += NotificationPlanner.episodes(sources)
            replace.insert(.episode)
        }
        if general.matchStartNotifications || general.matchResultNotifications, let events = await followedTeamEvents() {
            if general.matchStartNotifications {
                plan += NotificationPlanner.matchStarts(events)
                replace.insert(.matchStart)
            }
            if general.matchResultNotifications { await announceResults(events) }
        }
        guard !Task.isCancelled else { return }
        await NotificationScheduler.replacePending(kinds: replace, with: NotificationPlanner.capped(plan))
    }

    /// Debounced entry point for launch, returning to the foreground and settings changes.
    func scheduleNotificationRefresh(force: Bool = false) {
        NotificationScheduler.scheduleRefresh(force: force) { [weak self] in await self?.refreshNotifications() }
    }

    /// Announces matches that finished since the last look. Called after any sports refresh.
    func announceResults(_ events: [SportsEvent]) async {
        guard !isDemo, settings.general.matchResultNotifications, await NotificationScheduler.isAuthorized() else { return }
        let known = NotificationScheduler.notifiedResultIDs
        let (items, ids) = NotificationPlanner.results(events, alreadyNotified: Set(known))
        guard !items.isEmpty else { return }
        NotificationScheduler.notifiedResultIDs = NotificationPlanner.trimmed(known + ids)
        await NotificationScheduler.deliver(items)
    }

    /// Results only; polled while Flow is open.
    func refreshMatchResults() async {
        guard settings.general.matchResultNotifications, let events = await followedTeamEvents() else { return }
        await announceResults(events)
    }

    /// Next episodes of the shows you're partway through; nil when none could be looked up.
    private func upcomingEpisodeSources() async -> [EpisodeAlertSource]? {
        guard let catalog else { return nil }
        let recent = showStates.values
            .filter { !$0.watched.isEmpty }
            .sorted { ($0.lastWatchedAt ?? .distantPast) > ($1.lastWatchedAt ?? .distantPast) }
            .map(\.key)
        var seen = Set<MediaKey>()
        let shows = (continueWatching.map(\.key) + recent).filter { $0.type == .show && seen.insert($0).inserted }.prefix(40)
        guard !shows.isEmpty else { return [] }

        let results = await withTaskGroup(of: Result<MediaDetail, Error>.self) { group in
            for key in shows { group.addTask { await resultOf { try await catalog.details(.show, id: key.tmdbID) } } }
            var all: [Result<MediaDetail, Error>] = []
            for await result in group { all.append(result) }
            return all
        }
        let details = results.compactMap { try? $0.get() }
        guard !details.isEmpty else { return nil }
        return details.compactMap { detail in
            detail.nextEpisode.map { EpisodeAlertSource(showName: detail.item.title, episode: $0) }
        }
    }

    /// Upcoming and recent fixtures of every followed team; nil when none could be fetched.
    private func followedTeamEvents() async -> [SportsEvent]? {
        let teams = settings.sports.followedTeams
        guard !teams.isEmpty else { return [] }
        let client = SportsClient(apiKey: settings.sports.apiKey, http: http)
        let batches = await withTaskGroup(of: [SportsEvent]?.self) { group in
            for team in teams {
                group.addTask {
                    async let next = try? client.nextEvents(teamID: team.id)
                    async let last = try? client.lastEvents(teamID: team.id)
                    let (n, l) = await (next, last)
                    return n == nil && l == nil ? nil : (n ?? []) + (l ?? [])
                }
            }
            var all: [[SportsEvent]] = []
            for await batch in group { if let batch { all.append(batch) } }
            return all
        }
        return batches.isEmpty ? nil : batches.flatMap { $0 }
    }
}

#else

/// tvOS has no notification alerts.
@MainActor
enum NotificationScheduler {
    static func install() {}
    static func requestAuthorization() async -> Bool { false }
}

extension AppModel {
    func scheduleNotificationRefresh(force: Bool = false) {}
    func announceResults(_ events: [SportsEvent]) async {}
    func refreshMatchResults() async {}
}
#endif
