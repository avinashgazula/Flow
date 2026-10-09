import SwiftUI

/// Flow's design tokens. One canvas (black), one accent, artwork provides the colour.
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
        /// Gap between shelf rows on Home.
        static var section: CGFloat { Platform.isTV ? 64 : 36 }
    }

    enum Radius {
        static let poster: CGFloat = Platform.isTV ? 18 : 12
        static let card: CGFloat = Platform.isTV ? 22 : 16
        static let tile: CGFloat = Platform.isTV ? 26 : 20
        static let hero: CGFloat = Platform.isTV ? 36 : 30
        static let control: CGFloat = Platform.isTV ? 20 : 14
    }

    enum Palette {
        static let canvas = Color.black
        static let elevated = Color(white: 0.07)
        static let surface = Color.white.opacity(0.07)
        static let surfaceStrong = Color.white.opacity(0.12)
        static let hairline = Color.white.opacity(0.09)
        static let textSecondary = Color.white.opacity(0.62)
        static let textTertiary = Color.white.opacity(0.38)
        static let gold = Color(red: 0.96, green: 0.80, blue: 0.42)
    }

    enum Motion {
        static let snappy = Animation.spring(response: 0.32, dampingFraction: 0.82)
        static let gentle = Animation.spring(response: 0.55, dampingFraction: 0.86)
        static let fade = Animation.easeOut(duration: 0.28)
    }

    /// Built on system text styles so everything follows Dynamic Type (and tvOS's own sizes).
    enum Typeface {
        static var display: Font { .system(.largeTitle, weight: .bold) }
        static var title: Font { .system(.title2, weight: .bold) }
        static var sectionTitle: Font { Platform.isTV ? .system(.headline, weight: .bold) : .system(.title3, weight: .bold) }
        static var headline: Font { .system(.headline, weight: .semibold) }
        static var body: Font { .system(.subheadline) }
        static var caption: Font { .system(.caption, weight: .medium) }
        static var micro: Font { .system(.caption2, weight: .bold) }
        /// Title treatment when a film has no logo art: heavy, condensed, tight.
        static func artworkTitle(_ size: CGFloat) -> Font { .system(size: size, weight: .heavy).width(.condensed) }
    }
}

extension View {
    /// Section/page title styling with optical tracking.
    func displayTracking() -> some View { tracking(-0.4) }

    /// A thin inner stroke that separates artwork from the black canvas.
    func hairline<S: InsettableShape>(_ shape: S, opacity: Double = 1) -> some View {
        overlay(shape.strokeBorder(Theme.Palette.hairline.opacity(opacity), lineWidth: 1))
    }

    /// Soft elevation used for artwork.
    func artworkShadow(_ strength: Double = 1) -> some View {
        shadow(color: .black.opacity(0.45 * strength), radius: 14 * Theme.scale, x: 0, y: 8 * Theme.scale)
    }

    /// Liquid Glass on systems that have it, a material elsewhere.
    @ViewBuilder
    func flowGlass<S: Shape>(_ shape: S, interactive: Bool = false, tint: Color? = nil) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, macOS 26.0, tvOS 26.0, *) {
            self.glassEffect(Self.glass(interactive: interactive, tint: tint), in: shape)
        } else {
            self.background(.ultraThinMaterial, in: shape)
                .overlay(shape.stroke(Theme.Palette.hairline, lineWidth: 1))
        }
        #else
        self.background(.ultraThinMaterial, in: shape)
            .overlay(shape.stroke(Theme.Palette.hairline, lineWidth: 1))
        #endif
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

/// Primary call-to-action: a bright pill that reads first on any artwork.
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Typeface.headline)
            .foregroundStyle(.black)
            .padding(.horizontal, Theme.Space.l)
            .frame(minHeight: 52 * Theme.scale)
            .background(Color.white, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
            .modifier(FocusLift())
    }
}

/// Secondary controls: glass circles and capsules.
struct GlassButtonStyle: ButtonStyle {
    var circle = false

    func makeBody(configuration: Configuration) -> some View {
        let label = configuration.label
            .font(.system(size: 17 * Theme.scale, weight: .semibold))
            .foregroundStyle(.white)
            .frame(minWidth: 52 * Theme.scale, minHeight: 52 * Theme.scale)
            .padding(.horizontal, circle ? 0 : Theme.Space.m)
            .contentShape(Capsule())
        return Group {
            if circle {
                label.flowGlass(Circle(), interactive: true)
            } else {
                label.flowGlass(Capsule(), interactive: true)
            }
        }
        .scaleEffect(configuration.isPressed ? 0.94 : 1)
        .animation(Theme.Motion.snappy, value: configuration.isPressed)
        .modifier(FocusLift())
    }
}
