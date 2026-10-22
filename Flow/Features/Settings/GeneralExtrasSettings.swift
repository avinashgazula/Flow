import SwiftUI
import FlowKit
#if canImport(UIKit)
import UIKit
#endif

// Self-contained sections of Settings → General: app icon, navigation and notifications.

#if os(iOS)
/// Switches between the bundled app icons. Icons can't be loaded as images, so the tiles use
/// the previews in the asset catalog (regenerate both with scripts/make-icons.py).
@MainActor
enum AppIconSwitcher {
    /// The alternate icon's name in the asset catalog; the dark icon is the primary one.
    static let lightName = "AppIcon-Light"

    /// Applies `choice`; false when the system refused.
    static func apply(_ choice: AppIconChoice) async -> Bool {
        let app = UIApplication.shared
        guard app.supportsAlternateIcons else { return false }
        do {
            try await app.setAlternateIconName(choice == .light ? lightName : nil)
            return true
        } catch {
            return false
        }
    }

    /// Brings the icon in line with the setting, e.g. after it arrived from iCloud.
    static func sync(_ choice: AppIconChoice) async {
        let current: AppIconChoice = UIApplication.shared.alternateIconName == lightName ? .light : .dark
        if current != choice { _ = await apply(choice) }
    }
}

struct AppIconSection: View {
    @Environment(AppModel.self) private var model

    private let choices: [AppIconChoice] = [.light, .dark]

    var body: some View {
        Section("App Icon") {
            HStack(spacing: Theme.Space.xl) {
                ForEach(choices) { tile($0) }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Space.xs)
        }
    }

    private func tile(_ choice: AppIconChoice) -> some View {
        let selected = model.settings.general.appIcon == choice
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        return Button { select(choice) } label: {
            VStack(spacing: Theme.Space.xs) {
                Image(choice == .light ? "IconPreviewLight" : "IconPreviewDark")
                    .resizable()
                    .frame(width: 72, height: 72)
                    .clipShape(shape)
                    .hairline(shape)
                Text(choice.title).font(.footnote)
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.tint)
                    .opacity(selected ? 1 : 0)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(choice.title) icon")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func select(_ choice: AppIconChoice) {
        let previous = model.settings.general.appIcon
        guard choice != previous else { return }
        model.settings.general.appIcon = choice
        Task { @MainActor in
            if await !AppIconSwitcher.apply(choice) { model.settings.general.appIcon = previous }
        }
    }
}
#endif

/// Where the app opens and how its tabs are arranged.
struct NavigationSettingsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Section {
            Picker("Opening Tab", selection: $model.settings.general.startTab) {
                ForEach(model.settings.general.orderedTabs) { Text($0.title).tag($0) }
            }
            NavigationLink("Tab Order") { TabOrderView() }
        } header: {
            Text("Navigation")
        } footer: {
            Text("Opening Tab is where the app opens on launch. Tab Order sets how the tabs are arranged.")
        }
    }
}

/// Drag to reorder (always in edit mode on iPhone and iPad); Apple TV and the Mac also get Move Up / Move Down.
struct TabOrderView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let tabs = model.settings.general.orderedTabs
        FilmList {
            Section {
                ForEach(tabs) { tab in
                    row(tab, in: tabs)
                }
                .onMove { from, to in
                    var moved = tabs
                    moved.move(fromOffsets: from, toOffset: to)
                    model.settings.general.tabOrder = moved
                }
            }
            Section {
                Button("Reset to Default") { model.settings.general.tabOrder = AppTab.allCases }
                    .disabled(tabs == AppTab.allCases)
            }
        }
        .navigationTitle("Tab Order")
        #if os(iOS)
        .environment(\.editMode, .constant(.active))
        #endif
    }

    @ViewBuilder
    private func row(_ tab: AppTab, in tabs: [AppTab]) -> some View {
        #if os(iOS)
        Label(tab.title, systemImage: tab.systemImage)
        #else
        Button { } label: { Label(tab.title, systemImage: tab.systemImage) }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Move Up", systemImage: "arrow.up") { move(tab, by: -1, in: tabs) }
                    .disabled(tabs.first == tab)
                Button("Move Down", systemImage: "arrow.down") { move(tab, by: 1, in: tabs) }
                    .disabled(tabs.last == tab)
            }
        #endif
    }

    #if !os(iOS)
    private func move(_ tab: AppTab, by offset: Int, in tabs: [AppTab]) {
        guard let index = tabs.firstIndex(of: tab), tabs.indices.contains(index + offset) else { return }
        var moved = tabs
        moved.swapAt(index, index + offset)
        model.settings.general.tabOrder = moved
    }
    #endif
}

#if !os(tvOS)
/// Local notifications for new episodes and followed teams' matches. Each switch asks for permission the first time.
struct NotificationsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section {
            Toggle("Episode Notifications", isOn: binding(\.episodeNotifications))
            Toggle("Match Starting", isOn: binding(\.matchStartNotifications))
            Toggle("Match Results", isOn: binding(\.matchResultNotifications))
        } header: {
            Text("Notifications")
        } footer: {
            Text("Get notified when a new episode of a show you're watching airs. Match Starting alerts you 10 minutes before any followed team plays. Match Results sends the final score, and arrives while Flow is running.")
        }
    }

    /// Turning one on asks for permission; if it's refused the switch goes back off.
    private func binding(_ keyPath: WritableKeyPath<GeneralSettings, Bool>) -> Binding<Bool> {
        Binding(
            get: { model.settings.general[keyPath: keyPath] },
            set: { on in
                model.settings.general[keyPath: keyPath] = on
                guard on else { return }
                Task { @MainActor in
                    if await NotificationScheduler.requestAuthorization() {
                        model.scheduleNotificationRefresh(force: true)
                    } else {
                        model.settings.general[keyPath: keyPath] = false
                        model.showToast("Allow notifications for Flow in Settings to turn this on")
                    }
                }
            }
        )
    }
}
#endif
