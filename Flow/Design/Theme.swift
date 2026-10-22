import SwiftUI

/// Flow's design tokens: Film Stock. Every title is a reel of film Flow knows about, so artwork wears an
/// edge strip (perforations that fill as you watch, edge print with the facts), set on warm film-base black
/// with one film-stock yellow. Liquid Glass is the navigation and control layer that floats above; content
/// (frames, strips, lists, labels) stays matte. Yellow marks only the next action, focus, selection, the
/// watched perforations and the time left.
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
        /// A frame's top corners (the strip below squares off into the same shape): stills, posters, portraits.
        static let artwork: CGFloat = Platform.isTV ? 8 : 6
        /// Panels: the film-can label, sheets, the About table.
        static let frame: CGFloat = Platform.isTV ? 14 : 8
        static let control: CGFloat = Platform.isTV ? 16 : 10
        // Older names, kept so every screen reads the same radii.
        static let poster: CGFloat = artwork
        static let card: CGFloat = frame
        static let tile: CGFloat = frame
        static let hero: CGFloat = frame
    }

    enum Palette {
        /// base: every screen's background, a warm film-base black.
        static let ground = Color(hex: 0x15120F)
        /// base-2: panels, sheets, the film-can label.
        static let panel = Color(hex: 0x1F1B17)
        /// base-3: secondary buttons, inputs, segmented controls, tracks.
        static let control = Color(hex: 0x2A251F)
        /// base-4: unwatched perforations, strong dividers.
        static let lineStrong = Color(hex: 0x3A342C)
        /// The edge strip band, darker than the ground it sits on.
        static let edge = Color(hex: 0x0D0B09)
        /// A hairline, used sparingly.
        static let line = Color(hex: 0xFFECC8, opacity: 0.10)
        /// Paper: primary text (16:1 on the ground).
        static let text = Color(hex: 0xF4EFE6)
        /// Secondary text (9.2:1).
        static let textSecondary = Color(hex: 0xBFB5A6)
        /// Captions and labels (5.1:1; never for body copy).
        static let textTertiary = Color(hex: 0x8D8476)
        /// Edge print on the strip (12.5:1 on the edge).
        static let print = Color(hex: 0xD9CDB6)
        /// Film-stock yellow: the next action, focus, selection, the watched perforations, the time left.
        static let stock = Color(hex: 0xF6B40E)
        static let stockPressed = Color(hex: 0xDDA00A)
        /// Text and icons on a yellow fill (10:1).
        static let onStock = Color(hex: 0x15120F)
        /// Live and errors.
        static let red = Color(hex: 0xF25C45)
        /// Degraded states: "may stutter".
        static let warn = Color(hex: 0xFF9F43)

        // Older names, mapped onto Film Stock.
        static let spot = stock
        static let spotPressed = stockPressed
        static let onSpot = onStock
        static let error = red
        static let canvas = ground
        static let elevated = panel
        static let surface = panel
        static let surfaceStrong = control
        static let hairline = line
        static let gold = warn
        /// Tint for the glass that floats over video (notices, panels, controls): ground ink, half strength.
        static let overPicture = Color(hex: 0x15120F, opacity: 0.5)
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
        /// A time, duration or resolution that should line up with its neighbours.
        static var time: Font { Font.system(.headline, weight: .semibold).monospacedDigit() }
        /// A figure with a label under it (ratings, stats).
        static var figure: Font { Font.system(.title3, weight: .semibold).monospacedDigit() }
        /// Edge print: condensed and tabular. Only on edge strips, film-can labels and small format labels;
        /// `.edgePrint()` adds the uppercase and the tracking.
        static var edgePrint: Font { Font.system(.caption2, weight: .semibold).width(.condensed).monospacedDigit() }
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

    /// The edge-print voice: uppercase and tracked. Pair with `Theme.Typeface.edgePrint`.
    func edgePrint(tracking amount: CGFloat = 1.4) -> some View {
        textCase(.uppercase).tracking(amount)
    }

    /// A thin inner stroke that separates artwork from the ground.
    func hairline<S: InsettableShape>(_ shape: S, opacity: Double = 1) -> some View {
        overlay(shape.strokeBorder(Theme.Palette.hairline.opacity(opacity), lineWidth: 1))
    }

    /// Artwork casts no shadow: depth belongs to the tvOS focus lift alone. Kept so call sites read the same.
    func artworkShadow(_ strength: Double = 1) -> some View { self }

    /// Liquid Glass on systems that have it (the navigation and control layer: buttons and panels that float above
    /// content or video); below 26, flat base-2. Pass `Theme.Palette.overPicture` for glass over video.
    @ViewBuilder
    func flowGlass<S: Shape>(_ shape: S, interactive: Bool = false, tint: Color? = nil) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, macOS 26.0, tvOS 26.0, *) {
            self.glassEffect(Self.glass(interactive: interactive, tint: tint), in: shape)
        } else {
            flatPanel(shape, tint: tint)
        }
        #else
        flatPanel(shape, tint: tint)
        #endif
    }

    /// Below 26 there is no glass: a flat base panel, the control ink for plain buttons.
    private func flatPanel<S: Shape>(_ shape: S, tint: Color?) -> some View {
        background(tint == nil ? Theme.Palette.control : Theme.Palette.panel.opacity(0.94), in: shape)
    }
}

#if compiler(>=6.2)
@available(iOS 26.0, macOS 26.0, tvOS 26.0, *)
private extension View {
    static func glass(interactive: Bool, tint: Color?) -> Glass {
        var glass = Glass.regular
        if let tint { glass = glass.tint(tint) }
        if interactive { glass = glass.interactive() }
        return glass
    }
}
#endif

/// Groups glass shapes so they blend into each other on iOS 26; a plain container elsewhere.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder var content: Content

    var body: some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, macOS 26.0, tvOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
        #else
        content
        #endif
    }
}

/// The one next action (Resume, Play, a source's Play): film-stock yellow with ink text. On 26 and later it is
/// glass tinted yellow, like `.glassProminent`; below, a flat yellow fill.
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
        surface(shape) {
            configuration.label
                .font(compact ? .system(.subheadline, weight: .semibold) : Theme.Typeface.headline)
                .foregroundStyle(Theme.Palette.onStock)
                // Wraps between words at large text sizes, never inside one ("Pla / y").
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, compact ? Theme.Space.m : Theme.Space.l)
                .frame(minHeight: (compact ? 44 : 52) * Theme.scale)
        }
        // Already yellow, so on Apple TV focus is a paper ring and the lift.
        .overlay { if focused { shape.strokeBorder(Theme.Palette.text, lineWidth: 4) } }
        .opacity(enabled ? 1 : 0.4)
        .scaleEffect(configuration.isPressed ? 0.98 : 1)
        .animation(Theme.Motion.snappy, value: configuration.isPressed)
        .modifier(FocusLift(scale: 1.04))
    }

    @ViewBuilder
    private func surface<Content: View>(_ shape: RoundedRectangle, @ViewBuilder content: () -> Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, macOS 26.0, tvOS 26.0, *) {
            content().glassEffect(.regular.tint(Theme.Palette.stock).interactive(), in: shape)
        } else {
            content().background(configuration.isPressed ? Theme.Palette.stockPressed : Theme.Palette.stock, in: shape)
        }
        #else
        content().background(configuration.isPressed ? Theme.Palette.stockPressed : Theme.Palette.stock, in: shape)
        #endif
    }
}

/// Secondary controls: glass on 26 and later, the control ink below; round or squared. On Apple TV the
/// focused one fills with the stock yellow.
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

    @ViewBuilder
    private func chrome<S: Shape>(_ shape: S) -> some View {
        let size = (compact ? 44 : 52) * Theme.scale
        let label = configuration.label
            // Words take the primary button's type so a Resume and Details pair matches on every platform
            // (the headline style is 13 pt on a Mac and larger on Apple TV); icons keep their fixed size.
            .font(circle ? .system(size: (compact ? 15 : 17) * Theme.scale, weight: .semibold)
                  : compact ? .system(.subheadline, weight: .semibold) : Theme.Typeface.headline)
            .foregroundStyle(focused ? Theme.Palette.onStock : Theme.Palette.text)
            // A word is never broken across lines ("Detail / s" on Apple TV).
            .lineLimit(1)
            .fixedSize(horizontal: !circle, vertical: false)
            .frame(minWidth: size, minHeight: size)
            .padding(.horizontal, circle ? 0 : Theme.Space.m)
            .contentShape(shape)
        Group {
            if focused {
                label.background(Theme.Palette.stock, in: shape)
            } else {
                label.flowGlass(shape, interactive: true)
            }
        }
        .opacity(enabled ? 1 : 0.4)
        .scaleEffect(configuration.isPressed ? 0.98 : 1)
        .animation(Theme.Motion.snappy, value: configuration.isPressed)
        .modifier(FocusLift(scale: 1.04))
    }
}
