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
        18
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
}

extension AccentColorChoice {
    var color: Color {
        switch self {
        // White was the old default; the programme's own spot pink takes its place as Flow's accent.
        case .white: return Theme.Palette.spot
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
