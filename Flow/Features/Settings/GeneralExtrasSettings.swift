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
        Section(film: "App Icon") {
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
                Text(choice.title).font(Theme.Typeface.caption)
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Theme.Palette.blue)
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

/// The colour theme, as rows that each show their own four colours: a menu can't draw swatches. The change applies at
/// once because every colour token reads the choice (`ThemeState`). Appearance still chooses between a theme's light and
/// dark sides.
struct ThemeSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section {
            ForEach(ThemeChoice.allCases) { row($0) }
        } header: {
            FilmSectionHeader("Theme")
        } footer: { FilmFooter {
            Text("Admit One marks and acts in the red of the ticket icon. Index marks in red and acts in blue. Opening Night marks in red and acts in gold. Each has a light and a dark side; Appearance picks between them.")
        } }
    }

    private func row(_ choice: ThemeChoice) -> some View {
        let selected = model.settings.general.theme == choice
        return Button { model.settings.general.theme = choice } label: { ThemeRow(choice: choice, selected: selected) }
        #if !os(tvOS)
        .buttonStyle(.plain)
        #endif
        .id("theme-\(choice.rawValue)")
        .accessibilityLabel(choice.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// One theme: its paper, ink, mark and action colours in a ruled strip, then its name. Apple TV draws a button's label in
/// the app's tint, so the row sets ink itself and flips to on-spot when focused, as `TypefaceRow` does.
private struct ThemeRow: View {
    let choice: ThemeChoice
    let selected: Bool
    @Environment(\.isFocused) private var focused
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let tokens = ThemePalette.tokens(choice, dark: colorScheme == .dark)
        HStack(spacing: Theme.Space.m) {
            HStack(spacing: 0) {
                // By position: Admit One's mark and action are one colour, so the values aren't unique.
                ForEach(Array([tokens.bg, tokens.fg, tokens.mark, tokens.spot].enumerated()), id: \.offset) { _, hex in
                    Color(hex: hex).frame(width: 14 * Theme.scale)
                }
            }
            .frame(height: 24 * Theme.scale)
            // The paper swatch is nearly the page's own colour, so the strip is framed in ink.
            .overlay(Rectangle().strokeBorder(Theme.Palette.fg, lineWidth: Theme.Rule.thin))
            .accessibilityHidden(true)
            Text(choice.title)
                .font(Theme.Typeface.interface(.regular, 15, .subheadline))
                #if os(tvOS)
                .foregroundStyle(focused ? Theme.Palette.onSpot : Theme.Palette.fg)
                #endif
            Spacer()
            if selected {
                #if os(tvOS)
                Image(systemName: "checkmark").foregroundStyle(focused ? Theme.Palette.onSpot : Color.accentColor)
                #else
                Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
                #endif
            }
        }
        .contentShape(Rectangle())
    }
}

/// The typeface of buttons, rows, settings and body text. A menu can't show each name in its own face, so the choices
/// are rows; a change applies at once because the design tokens read the choice (`InterfaceFace`).
struct TypefaceSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section {
            ForEach(FontChoice.allCases) { row($0) }
        } header: {
            FilmSectionHeader("Typeface")
        } footer: { FilmFooter {
            Text("Sets the type of buttons, lists, settings and notes. Page titles, headings and reading text keep their own faces; small capitals and figures stay in Mono.")
        } }
    }

    private func row(_ choice: FontChoice) -> some View {
        let selected = model.settings.general.font == choice
        return Button { model.settings.general.font = choice } label: { TypefaceRow(choice: choice, selected: selected) }
        #if !os(tvOS)
        .buttonStyle(.plain)
        #endif
        .id("typeface-\(choice.rawValue)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// One typeface, its name set in that face. Apple TV draws a button's label in the app's tint, so the row sets ink itself
/// and flips to on-blue when focused, as `FilmToggleStyle` does: blue stays for the focus.
private struct TypefaceRow: View {
    let choice: FontChoice
    let selected: Bool
    @Environment(\.isFocused) private var focused

    var body: some View {
        HStack {
            Text(choice.title)
                .font(Theme.Typeface.interface(.regular, 15, .subheadline, choice: choice))
                #if os(tvOS)
                .foregroundStyle(focused ? Theme.Palette.onBlue : Theme.Palette.fg)
                #endif
            Spacer()
            if selected {
                #if os(tvOS)
                Image(systemName: "checkmark").foregroundStyle(focused ? Theme.Palette.onBlue : Color.accentColor)
                #else
                Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
                #endif
            }
        }
        .contentShape(Rectangle())
    }
}

/// Where the app opens and how its tabs are arranged.
struct NavigationSettingsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Section {
            FilmPicker("Opening Tab", selection: $model.settings.general.startTab) {
                ForEach(model.settings.general.orderedTabs) { Text($0.title).tag($0) }
            }
            NavigationLink("Tab Order") { TabOrderView() }
        } header: {
            FilmSectionHeader("Navigation")
        } footer: { FilmFooter {
            Text("Opening Tab is where the app opens on launch. Tab Order sets how the tabs are arranged.")
        } }
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
        .flowPageTitle("Tab Order")
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
            FilmSectionHeader("Notifications")
        } footer: { FilmFooter {
            Text("Get notified when a new episode of a show you're watching airs. Match Starting alerts you 10 minutes before any followed team plays. Match Results sends the final score, and arrives while Marquee is running.")
        } }
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
                        model.showToast("Allow notifications for Marquee in Settings to turn this on")
                    }
                }
            }
        )
    }
}
#endif
