import SwiftUI

/// Flow's design tokens: tonight's programme. Two inks, a deep blue that owns every surface and one
/// fluorescent pink spot, set in San Francisco. The spot marks only the next action, focus, the current
/// selection and "now"; artwork stays small and framed, and nothing on content is glass or glow.
enum Theme {
    /// tvOS is viewed from ten feet away; everything scales up.
    static let scale: CGFloat = Platform.isTV ? 1.9 : 1

    enum Space {
        static let xxs: CGFloat = 4 * Theme.scale
        static let xs: CGFloat = 8 * Theme.scale
        static let s: CGFloat = 12 * Theme.scale
        static let m: CGFloat = 16 * Theme.scale
        static let l: CGFloat = 24 * Theme.scale
        static let xl: CGFloat = 32 * Theme.scale
        static let xxl: CGFloat = 48 * Theme.scale
        /// Leading/trailing page margin.
        static var gutter: CGFloat { Platform.horizontalPadding }
        /// Gap between sections on Home: more above a heading than below it.
        static var section: CGFloat { Platform.isTV ? 64 : 36 }
    }

    enum Radius {
        /// Small artwork in a listing, printed-looking: posters, episode stills, portraits.
        static let artwork: CGFloat = Platform.isTV ? 8 : 6
        /// Framed stills and panels.
        static let frame: CGFloat = Platform.isTV ? 20 : 12
        static let control: CGFloat = Platform.isTV ? 16 : 10
        // Older names, kept so every screen reads the same two radii.
        static let poster: CGFloat = artwork
        static let card: CGFloat = frame
        static let tile: CGFloat = frame
        static let hero: CGFloat = frame
    }

    enum Palette {
        /// ink-900: every screen's background.
        static let ground = Color(hex: 0x0D1431)
        /// ink-800: sheets, panels, the selected listing's band.
        static let panel = Color(hex: 0x141D42)
        /// ink-700: secondary buttons, inputs, segmented controls, progress tracks.
        static let control = Color(hex: 0x1D2853)
        /// ink-600: dividers when truly needed.
        static let lineStrong = Color(hex: 0x2A3668)
        /// A hairline between rows, used sparingly: space separates first.
        static let line = Color(hex: 0xD6DEFF, opacity: 0.12)
        /// Paper: primary text (16:1 on the ground).
        static let text = Color(hex: 0xF3F1EA)
        /// The blue-tinted second ink: secondary text and meta (8.5:1).
        static let textSecondary = Color(hex: 0xA7B0D8)
        /// Captions and labels under numbers (4.9:1; never for body copy).
        static let textTertiary = Color(hex: 0x7983B5)
        /// The spot: the next action, focus, selection and "now" (5.9:1 on the ground).
        static let spot = Color(hex: 0xFF4DA6)
        static let spotPressed = Color(hex: 0xE63E93)
        /// Text and icons on a spot fill (5.9:1).
        static let onSpot = Color(hex: 0x0D1431)
        /// Degraded states: "may stutter".
        static let warn = Color(hex: 0xFFC453)
        /// Errors and failures, distinct from the spot.
        static let error = Color(hex: 0xFF6B57)

        // Older names, mapped onto the programme's inks.
        static let canvas = ground
        static let elevated = panel
        static let surface = panel
        static let surfaceStrong = control
        static let hairline = line
        static let gold = warn
        /// The fill behind panels, notices and buttons that float over video: flat ink at 86%, no blur.
        static let overPicture = Color(hex: 0x0D1431, opacity: 0.86)
    }

    /// State changes only: short and eased out.
    enum Motion {
        static let snappy = Animation.easeOut(duration: 0.18)
        static let gentle = Animation.easeOut(duration: 0.22)
        static let fade = Animation.easeOut(duration: 0.2)
    }

    /// Built on system text styles so everything follows Dynamic Type (and tvOS's own sizes).
    /// Times, durations, sizes, ratings and counts add `.monospacedDigit()` so columns line up.
    enum Typeface {
        static var display: Font { .system(.largeTitle, weight: .bold) }
        static var title: Font { .system(.title2, weight: .bold) }
        static var sectionTitle: Font { Platform.isTV ? .system(.headline, weight: .semibold) : .system(.title3, weight: .semibold) }
        static var headline: Font { .system(.headline, weight: .semibold) }
        static var body: Font { .system(.subheadline) }
        static var caption: Font { .system(.caption, weight: .medium) }
        static var micro: Font { .system(.caption2, weight: .semibold) }
        /// The time column of a listing: when it ends, or its resolution.
        static var time: Font { Font.system(.headline, weight: .semibold).monospacedDigit() }
        /// A figure with a label under it (ratings, stats).
        static var figure: Font { Font.system(.title3, weight: .semibold).monospacedDigit() }
        /// A title set as text when a film has no logo art: system, by weight and size only.
        static func artworkTitle(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold) }
    }
}

extension Color {
    /// 0xRRGGBB in sRGB.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

extension View {
    /// A tab's root page title. On tvOS the tab bar already names the page, so the navigation bar
    /// (a grey title above tiny toolbar circles) is hidden and the page keeps its actions inline.
    @ViewBuilder func tabRootTitle(_ title: String) -> some View {
        #if os(tvOS)
        toolbar(.hidden, for: .navigationBar)
        #else
        navigationTitle(title)
        #endif
    }

    /// Section/page title styling with optical tracking.
    func displayTracking() -> some View { tracking(-0.4) }

    /// A thin inner stroke that separates artwork from the ground.
    func hairline<S: InsettableShape>(_ shape: S, opacity: Double = 1) -> some View {
        overlay(shape.strokeBorder(Theme.Palette.hairline.opacity(opacity), lineWidth: 1))
    }

    /// Artwork casts no shadow: depth belongs to the tvOS focus lift alone. Kept so call sites read the same.
    func artworkShadow(_ strength: Double = 1) -> some View { self }

    /// A flat ink fill in a shape: the programme has no glass. Floating panels pass `Theme.Palette.overPicture`
    /// so they stay readable over video; everything else gets the control ink. Name kept for its many callers.
    func flowGlass<S: Shape>(_ shape: S, interactive: Bool = false, tint: Color? = nil) -> some View {
        background(tint ?? Theme.Palette.control, in: shape)
    }
}

/// Used to group glass shapes; with no glass left it is a plain container. Kept so call sites read the same.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder var content: Content

    var body: some View { content }
}

/// The one next action (Resume, Play, a source's Play): the spot colour with ink text.
struct PrimaryButtonStyle: ButtonStyle {
    /// A smaller button for use inside rows and panels, where the full-size one would dominate.
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        PrimaryButtonBody(configuration: configuration, compact: compact)
    }
}

private struct PrimaryButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let compact: Bool
    @Environment(\.isFocused) private var focused
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
        configuration.label
            .font(compact ? .system(.subheadline, weight: .semibold) : Theme.Typeface.headline)
            .foregroundStyle(Theme.Palette.onSpot)
            // Wraps between words at large text sizes, never inside one ("Pla / y").
            .multilineTextAlignment(.center)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, compact ? Theme.Space.m : Theme.Space.l)
            .frame(minHeight: (compact ? 44 : 52) * Theme.scale)
            .background(configuration.isPressed ? Theme.Palette.spotPressed : Theme.Palette.spot, in: shape)
            // Already spot-coloured, so on Apple TV focus is a paper ring and the lift.
            .overlay { if focused { shape.strokeBorder(Theme.Palette.text, lineWidth: 4) } }
            .opacity(enabled ? 1 : 0.4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
            .modifier(FocusLift(scale: 1.04))
    }
}

/// Secondary controls: the control ink, square-shouldered or round. On Apple TV the focused one fills with the spot.
struct GlassButtonStyle: ButtonStyle {
    var circle = false
    /// Matches `PrimaryButtonStyle(compact:)`, so the two sit level in a row.
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        SecondaryButtonBody(configuration: configuration, circle: circle, compact: compact)
    }
}

private struct SecondaryButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let circle: Bool
    let compact: Bool
    @Environment(\.isFocused) private var focused
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        if circle {
            chrome(Circle())
        } else {
            chrome(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
    }

    private func chrome<S: Shape>(_ shape: S) -> some View {
        let size = (compact ? 44 : 52) * Theme.scale
        let fill: Color = focused ? Theme.Palette.spot : (configuration.isPressed ? Theme.Palette.lineStrong : Theme.Palette.control)
        return configuration.label
            .font(.system(size: (compact ? 15 : 17) * Theme.scale, weight: .semibold))
            .foregroundStyle(focused ? Theme.Palette.onSpot : Theme.Palette.text)
            .frame(minWidth: size, minHeight: size)
            .padding(.horizontal, circle ? 0 : Theme.Space.m)
            .background(fill, in: shape)
            .contentShape(shape)
            .opacity(enabled ? 1 : 0.4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
            .modifier(FocusLift(scale: 1.04))
    }
}
