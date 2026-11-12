import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins
import FlowKit
import VideoToolbox
import Network
#if canImport(UIKit)
import UIKit
#endif
#if canImport(AppKit)
import AppKit
#endif

#if canImport(UIKit)
typealias PlatformImage = UIImage
#else
typealias PlatformImage = NSImage
#endif

/// Whether the connection is metered (cellular, a personal hotspot, Low Data Mode), for Resolution on Cellular.
enum NetworkConditions {
    private static let monitor = NWPathMonitor()
    private static let lock = NSLock()
    nonisolated(unsafe) private static var expensive = false
    private static let started: Void = {
        monitor.pathUpdateHandler = { path in
            lock.withLock { expensive = path.isExpensive || path.isConstrained }
        }
        monitor.start(queue: DispatchQueue(label: "app.flow.network"))
    }()

    static var isExpensive: Bool {
        _ = started
        return lock.withLock { expensive }
    }
}

enum Platform {
    static var isPhone: Bool {
        #if os(iOS)
        UIDevice.current.userInterfaceIdiom == .phone
        #else
        false
        #endif
    }

    static var isPad: Bool {
        #if os(iOS)
        UIDevice.current.userInterfaceIdiom == .pad
        #else
        false
        #endif
    }

    static var isTV: Bool {
        #if os(tvOS)
        true
        #else
        false
        #endif
    }

    static var isMac: Bool {
        #if os(macOS)
        true
        #else
        false
        #endif
    }

    static var supportsDownloads: Bool { !isTV }

    /// External players offered here (none on Apple TV, whose apps can't be handed a link this way).
    static var externalPlayers: [ExternalPlayer] {
        #if os(iOS)
        ExternalPlayer.available(on: .iOS)
        #elseif os(macOS)
        ExternalPlayer.available(on: .macOS)
        #else
        []
        #endif
    }

    /// AV1 needs a hardware decoder (iPhone 15 Pro, M3 Macs and later); elsewhere AVPlayer can't play it.
    static let decodesAV1: Bool = VTIsHardwareDecodeSupported(CMVideoCodecType(0x6176_3031)) // 'av01'

    /// What this device is called in messages: "iPhone", "iPad", "Mac" or "Apple TV".
    static var deviceKind: String {
        #if os(tvOS)
        "Apple TV"
        #elseif os(macOS)
        "Mac"
        #else
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #endif
    }

    static var deviceName: String {
        #if os(macOS)
        Host.current().localizedName ?? "Mac"
        #else
        UIDevice.current.name
        #endif
    }

    /// Stable per-install identifier used by media servers to tell devices apart.
    static var deviceID: String {
        let key = "flow.deviceID"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: key)
        return id
    }

    /// Poster width for shelves, scaled per platform.
    static var posterWidth: CGFloat {
        #if os(tvOS)
        250
        #elseif os(macOS)
        160
        #else
        UIDevice.current.userInterfaceIdiom == .pad ? 160 : 106
        #endif
    }

    static var landscapeWidth: CGFloat {
        #if os(tvOS)
        480
        #elseif os(macOS)
        300
        #else
        UIDevice.current.userInterfaceIdiom == .pad ? 300 : 236
        #endif
    }

    static var horizontalPadding: CGFloat {
        #if os(tvOS)
        80
        #elseif os(macOS)
        24
        #else
        // A tablet's content would hug the edge below a centred top bar at the phone's margin.
        UIDevice.current.userInterfaceIdiom == .pad ? 24 : 18
        #endif
    }

    static func copyToPasteboard(_ string: String) {
        #if os(iOS)
        UIPasteboard.general.string = string
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(string, forType: .string)
        #endif
    }

    static func pasteboardString() -> String? {
        #if os(iOS)
        UIPasteboard.general.string
        #elseif os(macOS)
        NSPasteboard.general.string(forType: .string)
        #else
        nil
        #endif
    }

    static func haptic() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }
}

enum QRCode {
    static func image(for string: String, scale: CGFloat = 10) -> Image? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) else { return nil }
        let context = CIContext()
        guard let cg = context.createCGImage(output, from: output.extent) else { return nil }
        return Image(decorative: cg, scale: 1)
    }
}

/// Default keys baked in at build time through Config/*.xcconfig → Info.plist.
enum BundleKeys {
    static func value(_ key: String) -> String? {
        ConfiguredKey.usable(Bundle.main.object(forInfoDictionaryKey: key) as? String)
    }

    static var tmdb: String? { value("FlowTMDBAPIKey") }
    static var traktClientID: String? { value("FlowTraktClientID") }
    static var traktClientSecret: String? { value("FlowTraktClientSecret") }
    static var simklClientID: String? { value("FlowSimklClientID") }
    static var tvdb: String? { value("FlowTVDBAPIKey") }
    /// The Marquee Accounts Worker's host, from `FLOW_ACCOUNT_SERVER_HOST` in Config/Secrets.xcconfig; nil when the build names none.
    static var accountServerHost: String? { value("FlowAccountServerHost") }
}

extension AccentColorChoice {
    var color: Color {
        switch self {
        // White was the old default; Marquee's action blue takes its place.
        case .white: return Theme.Palette.blue
        case .blue: return .blue
        case .red: return .red
        case .orange: return .orange
        case .green: return .green
        case .purple: return .purple
        case .pink: return .pink
        case .teal: return .teal
        }
    }
}

extension AccentColorChoice {
    /// Switches turn on in the accent.
    var switchColor: Color { color }

    /// The app-wide tint: system controls, tab selection and toggles take it.
    var tint: Color? { color }
}

#if os(iOS)
/// Draws switches with a colour of their own, so the app's accent can be white.
struct FlowSwitchStyle: ToggleStyle {
    let tint: Color
    func makeBody(configuration: Configuration) -> some View {
        Toggle(configuration).toggleStyle(.switch).tint(tint)
    }
}
#endif

extension View {
    @ViewBuilder
    func switchTint(_ accent: AccentColorChoice) -> some View {
        #if os(iOS)
        self.toggleStyle(FlowSwitchStyle(tint: accent.switchColor))
        #else
        self
        #endif
    }
}

extension SubtitleColor {
    var color: Color {
        switch self {
        case .white: return .white
        case .yellow: return .yellow
        case .cyan: return .cyan
        case .green: return .green
        }
    }
}

extension View {
    /// Applies a modifier only on platforms where it exists.
    @ViewBuilder
    func inlineNavigationTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    /// A sheet's Cancel or Close button. tvOS leaves it out: the remote's Back button dismisses every
    /// sheet, and a text item in that spot draws white on the white glass of Flow's accent.
    @ViewBuilder
    func sheetDismissButton(_ title: String = "Cancel", action: @escaping () -> Void) -> some View {
        #if os(tvOS)
        self
        #else
        toolbar { ToolbarItem(placement: .cancellationAction) { Button(title, action: action) } }
        #endif
    }

    /// A sheet's Done. tvOS leaves it out for the same reasons as Cancel: Back closes the sheet.
    @ViewBuilder
    func sheetDoneButton(_ title: String = "Done", action: @escaping () -> Void) -> some View {
        #if os(tvOS)
        self
        #else
        toolbar { ToolbarItem(placement: .confirmationAction) { Button(title, action: action) } }
        #endif
    }

    /// A sheet's Save. On tvOS a toolbar item draws white on white and focus rarely reaches it, so the
    /// button sits under the form instead, where swiping down lands on it.
    @ViewBuilder
    func sheetSaveButton(_ title: String = "Save", disabled: Bool = false, action: @escaping () -> Void) -> some View {
        #if os(tvOS)
        safeAreaInset(edge: .bottom) {
            Button(title, action: action)
                .buttonStyle(PrimaryButtonStyle())
                .disabled(disabled)
                .padding(.vertical, Theme.Space.m)
        }
        #else
        toolbar { ToolbarItem(placement: .confirmationAction) { Button(title, action: action).disabled(disabled) } }
        #endif
    }

    @ViewBuilder
    func largeNavigationTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.large)
        #else
        self
        #endif
    }

    /// A bar that stays clear over a page's artwork, then fills in with the page's title once
    /// the title on the page itself has scrolled away beneath it.
    @ViewBuilder
    func collapsingNavigationTitle(_ title: String, collapsed: Bool) -> some View {
        #if os(iOS)
        self
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title)
                        .font(.headline)
                        .lineLimit(1)
                        .opacity(collapsed ? 1 : 0)
                        .offset(y: collapsed ? 0 : 6)
                        .accessibilityHidden(!collapsed)
                }
            }
            .collapsingBarBackground(collapsed)
        #else
        self
        #endif
    }

    #if os(iOS)
    /// On iOS 26 and later the bar has no background of its own; the system's scroll edge effect
    /// blurs whatever runs under it, and pages that start under the bar show it even before
    /// scrolling. Hold it back until the title collapses, and keep it soft like Apple's own apps.
    @ViewBuilder
    private func collapsingBarBackground(_ collapsed: Bool) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            self.toolbarBackground(.hidden, for: .navigationBar)
                .scrollEdgeEffectStyle(.soft, for: .top)
                .scrollEdgeEffectHidden(!collapsed, for: .top)
        } else {
            self.toolbarBackground(collapsed ? .visible : .hidden, for: .navigationBar)
        }
        #else
        self.toolbarBackground(collapsed ? .visible : .hidden, for: .navigationBar)
        #endif
    }
    #endif

    /// Hides the navigation bar background so content can run under it (iOS only).
    @ViewBuilder
    func transparentNavigationBar() -> some View {
        #if os(iOS)
        self.toolbarBackground(.hidden, for: .navigationBar)
        #else
        self
        #endif
    }
}

// MARK: - iOS 27

// Xcode 27 ships Swift 6.4. Everything here is behind `#if compiler(>=6.4)` and `#available(... 27 ...)`, so Xcode 16.4
// and 26.3 never see it and older systems get exactly what they had.
extension View {
    /// iOS 27: the navigation bar slides away while a long page scrolls down, and returns on the way back.
    @ViewBuilder
    func flowMinimizingToolbar() -> some View {
        #if os(iOS) && compiler(>=6.4)
        if #available(iOS 27.0, *) {
            self.toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
        } else {
            self
        }
        #else
        self
        #endif
    }

    /// iOS 27: swipe an item in a ScrollView for its quick actions (Mark Watched, Remove). Nothing earlier.
    @ViewBuilder
    func flowSwipeActions<Actions: View>(@ViewBuilder _ actions: () -> Actions) -> some View {
        #if os(iOS) && compiler(>=6.4)
        if #available(iOS 27.0, *) {
            self.swipeActions(edge: .trailing, allowsFullSwipe: false) { actions() }
        } else {
            self
        }
        #else
        self
        #endif
    }

    /// iOS 27: the container that lets the swipe actions above work on views outside a List.
    @ViewBuilder
    func flowSwipeActionsContainer() -> some View {
        #if os(iOS) && compiler(>=6.4)
        if #available(iOS 27.0, *) {
            self.swipeActionsContainer()
        } else {
            self
        }
        #else
        self
        #endif
    }

    /// iOS 27, iPad and Mac: the blue and red go quiet in a window that isn't the active one.
    @ViewBuilder
    func flowDimsWhenInactive() -> some View {
        #if (os(iOS) || os(macOS)) && compiler(>=6.4)
        if #available(iOS 27.0, macOS 27.0, *) {
            self.modifier(InactiveWindowDimming())
        } else {
            self
        }
        #else
        self
        #endif
    }
}

#if (os(iOS) || os(macOS)) && compiler(>=6.4)
@available(iOS 27.0, macOS 27.0, *)
private struct InactiveWindowDimming: ViewModifier {
    @Environment(\.appearsActive) private var appearsActive

    func body(content: Content) -> some View {
        content.saturation(appearsActive ? 1 : 0.3).opacity(appearsActive ? 1 : 0.7)
    }
}
#endif

/// Whether this system asks "Remove?" with an item-bound confirmation dialog (iOS 27); earlier systems remove straight away.
enum ItemDialogs {
    static var available: Bool {
        #if os(iOS) && compiler(>=6.4)
        if #available(iOS 27.0, *) { return true }
        #endif
        return false
    }
}

extension View {
    /// iOS 27: a confirmation dialog bound to the item it is about; nothing earlier (callers check `ItemDialogs.available`).
    @ViewBuilder
    func flowConfirmationDialog<Item: Identifiable, Actions: View>(_ title: String, item: Binding<Item?>,
                                                                   @ViewBuilder actions: @escaping (Item) -> Actions) -> some View {
        #if os(iOS) && compiler(>=6.4)
        if #available(iOS 27.0, *) {
            self.confirmationDialog(Text(title), item: item) { entry in actions(entry) }
        } else {
            self
        }
        #else
        self
        #endif
    }
}

/// The toolbar's one always-visible action: Settings, pinned to the trailing edge on iOS 27, a primary action before.
struct SettingsToolbarItem: ToolbarContent {
    let action: () -> Void

    var body: some ToolbarContent {
        #if os(iOS) && compiler(>=6.4)
        if #available(iOS 27.0, *) {
            ToolbarItem(placement: .topBarPinnedTrailing) { button }
        } else {
            ToolbarItem(placement: .primaryAction) { button }
        }
        #else
        ToolbarItem(placement: .primaryAction) { button }
        #endif
    }

    private var button: some View {
        // Ink on the toolbar: blue is for the next action, not for chrome.
        Button(action: action) { Image(systemName: "gearshape") }
            .accessibilityLabel("Settings")
            .tint(Theme.Palette.text)
    }
}

// MARK: - Forms on the film ground

extension View {
    /// The film ground behind a Form or List: the system's grey is hidden and the warm base shows through.
    @ViewBuilder
    func filmGround() -> some View {
        #if os(tvOS)
        // tvOS has no content background to hide: its forms already sit on the screen's own ground.
        background(Theme.Palette.ground)
        #else
        scrollContentBackground(.hidden)
            .background(Theme.Palette.ground)
        #endif
    }

    /// Apple TV settings lists: Title Case section titles like iOS (the system capitalises them). tvOS has no
    /// row or section spacing modifiers.
    @ViewBuilder
    fileprivate func tvListRhythm() -> some View {
        #if os(tvOS)
        textCase(nil)
        #else
        self
        #endif
    }

    /// Rows on paper with 1px ink dividers, so a group of settings reads as a ruled list. Apple TV keeps the system's
    /// own row and focus look, which a custom row background would replace; it gets taller rows instead.
    @ViewBuilder
    fileprivate func filmRows() -> some View {
        #if os(tvOS)
        // Taller rows, so a list read from across the room has air between its focus platters. The section headers
        // uppercase themselves inside the list, so the case reset has to be set on the sections, not outside the Form.
        listRowInsets(EdgeInsets(top: Theme.Space.s, leading: 20, bottom: Theme.Space.s, trailing: 20))
            .textCase(nil)
        #else
        listRowBackground(Theme.Palette.bg)
            .listRowSeparatorTint(Theme.Palette.rule)
        #endif
    }
}

/// A settings footer. On Apple TV the system's footer is small and dim for a screen read from a sofa, so it is set
/// larger, in secondary paper, with room above; elsewhere it is the system's own footer. Every Section footer in
/// the settings pages goes through this, so the ten-foot sizing lives in one place.
struct FilmFooter<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        // Muted mono, sentence case: the small print under a group.
        content
            .font(Theme.Typeface.caption)
            .foregroundStyle(Theme.Palette.muted)
            .textCase(nil)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            #if os(tvOS)
            .padding(.top, Theme.Space.xs)
            #endif
    }
}

/// A settings section header: the 2px rule that opens a group, then its name as a red mono label. The Form's own
/// header would uppercase and recolour a plain string, so the casing and styling live here. Every settings Section
/// header goes through this (or `Section(film:)`).
struct FilmSectionHeader: View {
    let title: String

    init(_ title: String) { self.title = title }

    var body: some View {
        // Inside a stack the header stays a custom view; a bare Text goes to the system's header label, which
        // capitalises it whatever textCase says.
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            RuleLine()
            SectionLabel(title)
        }
        .padding(.top, Theme.Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .textCase(nil)
    }
}

extension Section where Parent == FilmSectionHeader, Content: View, Footer == EmptyView {
    /// A titled section whose header is a `FilmSectionHeader`, in place of the string initialiser.
    init(film title: String, @ViewBuilder content: () -> Content) {
        self.init(content: content, header: { FilmSectionHeader(title) })
    }
}

extension View {
    /// Sheets with a lot in them (sources, settings) open as a small centred form on iPad, which cramps their lists.
    /// From iOS 18 they take the full page size; iPhone, Mac and earlier systems keep the system's sheet.
    @ViewBuilder
    func largeSheetOnPad() -> some View {
        #if os(iOS) && compiler(>=6.0)
        if #available(iOS 18.0, *) {
            if Platform.isPad { presentationSizing(.page) } else { self }
        } else {
            self
        }
        #else
        self
        #endif
    }

    /// A pushed page's title. Apple TV draws the system's title dim and centred, so it reads as disabled: there the
    /// navigation bar is hidden and the page sets its own large title in paper, lined up with its content (`inset`
    /// is the content's leading padding). Everywhere else this is the ordinary navigation title.
    @ViewBuilder
    func flowPageTitle(_ title: String, inset: CGFloat = Theme.Space.s) -> some View {
        #if os(tvOS)
        toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                PageTitle(title)
                    .padding(.horizontal, inset)
                    .padding(.top, Theme.Space.s)
            }
        #else
        navigationTitle(title)
        #endif
    }
}

#if os(tvOS)
/// A toggle as a row with its value on the right. The system draws a toggle in the app's tint on Apple TV, so unfocused
/// rows read blue; this draws the label in ink and the value in muted, and flips both to on-blue when the row is focused,
/// so blue stays for the focus and nothing else.
struct FilmToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: { FilmToggleRow(configuration: configuration) }
            .accessibilityAddTraits(.isToggle)
            .accessibilityValue(configuration.isOn ? "On" : "Off")
    }
}

private struct FilmToggleRow: View {
    let configuration: ToggleStyleConfiguration
    @Environment(\.isFocused) private var focused

    var body: some View {
        HStack {
            configuration.label.foregroundStyle(focused ? Theme.Palette.onBlue : Theme.Palette.fg)
            Spacer(minLength: Theme.Space.m)
            Text(configuration.isOn ? "On" : "Off")
                .font(Theme.Typeface.control)
                .foregroundStyle(focused ? Theme.Palette.onBlue.opacity(0.8) : Theme.Palette.muted)
        }
    }
}
#else
/// A square switch: a 2px ink frame with a square knob, filled blue when on. The system's round switch can't be
/// restyled, so settings rows draw their own; the whole row is the button, as with the system's.
struct FilmToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        FilmSwitchRow(configuration: configuration)
    }
}

private struct FilmSwitchRow: View {
    let configuration: ToggleStyleConfiguration
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let on = configuration.isOn
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: Theme.Space.m) {
                configuration.label
                    .frame(maxWidth: .infinity, alignment: .leading)
                ZStack(alignment: on ? .trailing : .leading) {
                    Rectangle().fill(on ? Theme.Palette.blue : Theme.Palette.bg)
                    Rectangle()
                        .fill(on ? Theme.Palette.onBlue : Theme.Palette.fg)
                        .frame(width: 14, height: 14)
                        .padding(3)
                }
                .frame(width: 46, height: 26)
                .overlay(Rectangle().strokeBorder(on ? Theme.Palette.blue : Theme.Palette.fg, lineWidth: Theme.Rule.heavy))
                .animation(Theme.Motion.state, value: on)
                .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .opacity(enabled ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(on ? "On" : "Off")
    }
}
#endif

/// A Picker whose chosen value is quiet secondary text. A menu picker draws its value in the tint, which would make
/// every setting look like the next action; the accent is kept for toggles that are on.
struct FilmPicker<SelectionValue: Hashable, Content: View>: View {
    let title: LocalizedStringKey
    @Binding var selection: SelectionValue
    let content: Content

    init(_ title: LocalizedStringKey, selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content) {
        self.title = title
        self._selection = selection
        self.content = content()
    }

    var body: some View {
        #if os(tvOS)
        Picker(title, selection: $selection) { content }
        #else
        Picker(title, selection: $selection) { content }
            .tint(Theme.Palette.muted)
        #endif
    }
}

/// A Form on paper with ruled rows and mono labels. A row background belongs to the rows and can't be set from
/// outside the form, so every settings page builds its form with this instead of the system Form.
struct FilmForm<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        Form { content.filmRows() }
            .tvListRhythm()
            #if os(macOS)
            // Grouped panels like System Settings, rather than the Mac's default two-column form.
            .formStyle(.grouped)
            #endif
            .filmGround()
            .font(Theme.Typeface.body)
            .toggleStyle(FilmToggleStyle())
    }
}

/// The same for a List: the settings pages that list things (servers, shelves, sources).
struct FilmList<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        List { content.filmRows() }
            .tvListRhythm()
            .filmGround()
            .font(Theme.Typeface.body)
            .toggleStyle(FilmToggleStyle())
    }
}

#if os(iOS)
/// UIKit controls SwiftUI can't restyle: segmented controls are paper with ink text and the selected
/// segment inverted, instead of the system grey.
enum FilmAppearance {
    static func install() {
        let control = UISegmentedControl.appearance()
        control.backgroundColor = Theme.Tones.bg.ui
        control.selectedSegmentTintColor = Theme.Tones.fg.ui
        control.setTitleTextAttributes([.foregroundColor: Theme.Tones.fg.ui], for: .normal)
        control.setTitleTextAttributes([.foregroundColor: Theme.Tones.bg.ui], for: .selected)
    }
}
#endif
