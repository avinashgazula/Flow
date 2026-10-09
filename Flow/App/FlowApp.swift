import SwiftUI
import Combine
import FlowKit

extension Notification.Name {
    /// Posted when demo mode is entered or left; the app rebuilds its model.
    static let flowModeChanged = Notification.Name("flow.modeChanged")
}

@main
struct FlowApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(model.settings.general.accent.color)
                .preferredColorScheme(.dark)
                .onOpenURL { url in model.handle(url: url) }
                .task(id: ObjectIdentifier(model)) {
                    await model.start()
                    IntentInbox.drain(into: model)
                }
                .onReceive(NotificationCenter.default.publisher(for: IntentInbox.arrived)) { _ in IntentInbox.drain(into: model) }
                .task(id: ObjectIdentifier(model)) {
                    if ScreenshotTour.isRequested { await ScreenshotTour.run(model) }
                }
                .onReceive(NotificationCenter.default.publisher(for: .flowModeChanged)) { _ in model = AppModel() }
                .onContinueUserActivity(SystemIntegration.titleActivity) { activity in
                    if let key = SystemIntegration.key(from: activity) { model.open(key) }
                }
                #if !os(tvOS)
                .onContinueUserActivity("com.apple.corespotlightitem") { activity in
                    if let key = SystemIntegration.key(from: activity) { model.open(key) }
                }
                #endif
        }
        #if os(macOS)
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Sync Now") { Task { await model.refreshLibrary(force: true) } }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
            }
        }
        #endif

        #if os(macOS)
        Settings {
            NavigationStack {
                SettingsRootView()
                    .flowDestinations()
            }
            .environment(model)
            .frame(minWidth: 640, minHeight: 560)
            .preferredColorScheme(.dark)
        }
        #endif
    }
}

extension AppModel {
    /// flow://setup?d=… imports a shared setup; flow://title/movie/603 opens a title.
    func handle(url: URL) {
        guard url.scheme == SetupShare.urlScheme else { return }
        if let key = SystemIntegration.key(from: url) {
            if url.host == "play" { Task { await playTitle(key) } } else { open(key) }
            return
        }
        switch url.host {
        case "continue": Task { await resumeLatest() }
        case "upcoming":
            activePlayback?.stop()
            selectedTab = .library
            paths[.library] = [.calendar]
        case "search":
            selectedTab = .search
            searchText = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? ""
        default:
            pendingImport = url.absoluteString
        }
    }

    /// From a widget or the Top Shelf: open the title, then play it (resuming if there's progress).
    func playTitle(_ key: MediaKey) async {
        guard let catalog, let item = try? await catalog.item(key) else { return }
        open(key)
        await play(item)
    }

    /// Picks up the most recent thing in Continue Watching, exactly where it was left.
    func resumeLatest() async {
        guard let entry = continueWatching.first, let item = await hydrate([entry.key]).first else {
            showToast("Nothing to continue")
            return
        }
        await play(item)
    }
}
