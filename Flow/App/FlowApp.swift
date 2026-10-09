import SwiftUI
import FlowKit

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
                .task { await model.start() }
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
    /// flow://setup?d=… imports a shared setup.
    func handle(url: URL) {
        guard url.scheme == SetupShare.urlScheme else { return }
        pendingImport = url.absoluteString
    }
}
