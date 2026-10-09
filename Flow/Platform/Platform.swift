import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins
import FlowKit
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
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty || trimmed.hasPrefix("$(") ? nil : trimmed
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
        case .white: return .white
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
    /// Switches can't use a white accent: their knob is white. They turn green instead, as in Settings.
    var switchColor: Color { self == .white ? .green : color }

    /// The app-wide tint. On tvOS a white tint would make focused toolbar buttons white on white,
    /// so the system's own focus colours are used instead.
    var tint: Color? {
        #if os(tvOS)
        return self == .white ? nil : color
        #else
        return color
        #endif
    }
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

    @ViewBuilder
    func largeNavigationTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.large)
        #else
        self
        #endif
    }

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
