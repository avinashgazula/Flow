import AppIntents
import SwiftUI
import FlowKit

/// Shortcuts, Siri and Spotlight actions hand their destination to the running app through here.
@MainActor
enum IntentInbox {
    static let arrived = Notification.Name("flow.intentArrived")
    private static var pending: URL?

    static func deliver(_ url: URL) {
        pending = url
        NotificationCenter.default.post(name: arrived, object: nil)
    }

    /// Called when the model is ready, and whenever an intent arrives while it already is.
    static func drain(into model: AppModel) {
        guard let url = pending else { return }
        pending = nil
        model.handle(url: url)
    }

    static func link(_ path: String, query: [URLQueryItem] = []) -> URL {
        var components = URLComponents()
        components.scheme = SetupShare.urlScheme
        components.host = path
        components.queryItems = query.isEmpty ? nil : query
        return components.url!
    }
}

struct ContinueWatchingIntent: AppIntent {
    static var title: LocalizedStringResource { "Continue Watching" }
    static var description: IntentDescription { IntentDescription("Resumes the last thing you were watching, right where you left off.") }
    static var openAppWhenRun: Bool { true }

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentInbox.deliver(IntentInbox.link("continue"))
        return .result()
    }
}

struct OpenUpcomingIntent: AppIntent {
    static var title: LocalizedStringResource { "Show Upcoming Episodes" }
    static var description: IntentDescription { IntentDescription("Opens the calendar of new episodes and releases from your library.") }
    static var openAppWhenRun: Bool { true }

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentInbox.deliver(IntentInbox.link("upcoming"))
        return .result()
    }
}

struct SearchFlowIntent: AppIntent {
    static var title: LocalizedStringResource { "Search Flow" }
    static var description: IntentDescription { IntentDescription("Searches for movies, shows and people.") }
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Search For", requestValueDialog: "What would you like to watch?")
    var query: String

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentInbox.deliver(IntentInbox.link("search", query: [URLQueryItem(name: "q", value: query)]))
        return .result()
    }
}

#if !os(tvOS)
struct FlowShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ContinueWatchingIntent(),
                    phrases: ["Continue watching in \(.applicationName)", "Resume \(.applicationName)"],
                    shortTitle: "Continue Watching", systemImageName: "play.fill")
        AppShortcut(intent: OpenUpcomingIntent(),
                    phrases: ["What's new in \(.applicationName)", "Show upcoming episodes in \(.applicationName)"],
                    shortTitle: "Upcoming", systemImageName: "calendar")
        AppShortcut(intent: SearchFlowIntent(),
                    phrases: ["Search \(.applicationName)", "Find something to watch in \(.applicationName)"],
                    shortTitle: "Search", systemImageName: "magnifyingglass")
    }
}
#endif
