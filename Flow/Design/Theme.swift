import SwiftUI
import FlowKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Marquee's design tokens: the Index, as on the website (web/DESIGN.md). Paper and ink ruled with 2px lines, a giant
/// grotesque for titles, monospaced type for everything you press, one red that marks and one blue that acts. Both
/// themes are first-class and follow the system unless Settings → Appearance says otherwise; the player is always
/// dark (`darkScope()`). Nothing is rounded, shadowed or glassy outside the player: structure is rules, and a hover,
/// a press or the tvOS focus is shown by inversion (blue fill, on-blue text).
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
        static var section: CGFloat { Platform.isTV ? 64 : 40 }
    }

    /// Square, everywhere: only the video player rounds anything. The older names stay so call sites compile, and
    /// all read zero.
    enum Radius {
        static let none: CGFloat = 0
        /// The player's own panels and chips.
        static let player: CGFloat = Platform.isTV ? 18 : 10
        static let artwork: CGFloat = none
        static let frame: CGFloat = none
        static let control: CGFloat = none
        static let poster: CGFloat = none
        static let card: CGFloat = none
        static let tile: CGFloat = none
        static let hero: CGFloat = none
    }

    /// Line widths. A 2px rule opens a page, a section or a block and draws every control's border; 1px lines
    /// separate the rows inside; keyboard and tvOS focus is thicker than either so it is never read as a rule.
    enum Rule {
        static let heavy: CGFloat = 2 * (Platform.isTV ? 1.5 : 1)
        static let thin: CGFloat = Platform.isTV ? 2 : 1
        static let focus: CGFloat = 3 * (Platform.isTV ? 2 : 1)
    }

    /// A colour with a light and a dark value, resolved by the system's appearance (or Settings → Appearance).
    struct Tone: Sendable {
        let light: UInt32
        let dark: UInt32
        var color: Color { Color(light: light, dark: dark) }
        #if os(iOS) || os(tvOS)
        var ui: UIColor { UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) } }
        #endif
    }

    /// The website's tokens (web/src/styles/tokens.css), light then dark.
    enum Tones {
        static let bg = Tone(light: 0xFFFFFF, dark: 0x0A0A0A)
        static let fg = Tone(light: 0x0A0A0A, dark: 0xF2F2EE)
        static let red = Tone(light: 0xC9120A, dark: 0xFF5A4E)
        static let blue = Tone(light: 0x1A3DFF, dark: 0x8FA2FF)
        static let onBlue = Tone(light: 0xFFFFFF, dark: 0x0A0A0A)
        static let muted = Tone(light: 0x555555, dark: 0xB0B0AC)
        static let faint = Tone(light: 0x636363, dark: 0x8F8F8B)
        static let warn = Tone(light: 0xA64B00, dark: 0xFF9F43)
        static let tint1 = Tone(light: 0xF3F3F0, dark: 0x151515)
        static let tint2 = Tone(light: 0xE7E7E3, dark: 0x212121)
        static let tint3 = Tone(light: 0xD4D4CE, dark: 0x333333)
        /// Pressed blue: a little deeper in light, a little paler in dark.
        static let bluePressed = Tone(light: 0x0F2BD6, dark: 0xB4C1FF)
    }

    /// Red marks, blue acts. Nothing else is coloured but artwork.
    enum Palette {
        /// Paper: every screen's background.
        static let bg = Tones.bg.color
        /// Ink: text, rules, borders, the solid button, the current tab.
        static let fg = Tones.fg.color
        /// Markers, labels, numerals, progress, live; never body text.
        static let red = Tones.red.color
        /// Action: links, hover and focus fills, selection, switch tracks.
        static let blue = Tones.blue.color
        static let bluePressed = Tones.bluePressed.color
        /// Text and icons on a blue fill.
        static let onBlue = Tones.onBlue.color
        /// Secondary text and metadata.
        static let muted = Tones.muted.color
        /// Captions and placeholders; never body copy.
        static let faint = Tones.faint.color
        /// Degraded states: "may stutter".
        static let warn = Tones.warn.color
        /// Quiet fills for what is not there yet: tracks, skeletons, a hovered menu item. Nothing that holds
        /// content is tint-filled.
        static let tint1 = Tones.tint1.color
        static let tint2 = Tones.tint2.color
        static let tint3 = Tones.tint3.color
        /// Flat translucent ink for notices and chrome over video.
        static let overlay = Color(hex: 0x0A0A0A, opacity: 0.94)
        /// A rule or border: ink at full strength in both themes.
        static var rule: Color { fg }

        // Older names, mapped onto the Index so every screen compiles while it is converted.
        static let ground = bg
        static let canvas = bg
        static let panel = tint1
        static let elevated = tint1
        static let surface = tint1
        static let control = tint2
        static let surfaceStrong = tint2
        static let lineStrong = tint3
        static let edge = tint2
        static let line = fg
        static let hairline = fg
        static let text = fg
        static let textSecondary = muted
        static let textTertiary = faint
        static let print = muted
        static let stock = blue
        static let stockPressed = bluePressed
        static let onStock = onBlue
        static let spot = blue
        static let spotPressed = bluePressed
        static let onSpot = onBlue
        static let error = red
        static let gold = warn
        static let overPicture = overlay
    }

    /// Motion explains state and never decorates (web/DESIGN.md, Motion): an entrance eases out, an exit is quicker,
    /// a press is felt, and UI motion stays under 300 ms. Entrances and exits both decelerate; ease-in starts slow.
    enum Motion {
        static let hover = Animation.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.1)
        static let state = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.15)
        static let exit = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.16)
        /// Something already on screen that moves.
        static let move = Animation.timingCurve(0.645, 0.045, 0.355, 1, duration: 0.25)
        static let enter = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.3)
        // Older names.
        static let snappy = state
        static let gentle = enter
        static let fade = state
    }

    /// The four faces, by PostScript name (bundled in Resources/Fonts and registered via UIAppFonts and
    /// ATSApplicationFontsPath; a missing one falls back to the system font rather than failing).
    enum Face {
        static let archivo = "Archivo-Bold"
        static let mono = "IBMPlexMono"
        static let monoSemiBold = "IBMPlexMono-SmBld"
        static let condensedSemiBold = "IBMPlexSansCond-SmBld"
        static let condensed = "IBMPlexSansCond-Bold"
        static let serif = "IBMPlexSerif-Regular"
        static let serifSemiBold = "IBMPlexSerif-SemiBold"
        static let serifItalic = "IBMPlexSerif-Italic"
    }

    /// Archivo is the giant title alone; Plex Sans Condensed sets headings and big numbers; Plex Mono is the
    /// interface (anything you press, every label and number); Plex Serif is for sentences people read. Every size
    /// scales with Dynamic Type through its text style, and by `Theme.scale` on Apple TV.
    enum Typeface {
        static func custom(_ name: String, _ size: CGFloat, _ style: Font.TextStyle) -> Font {
            .custom(name, size: size * Theme.scale, relativeTo: style)
        }

        /// The page title's size: phones 56, iPad 88, Mac 80, Apple TV 106.
        static var giantSize: CGFloat { Platform.isPad ? 88 : Platform.isMac ? 80 : 56 }
        /// The giant uppercase page title.
        static var giant: Font { custom(Face.archivo, giantSize, .largeTitle) }
        static var display: Font { custom(Face.archivo, 36, .largeTitle) }
        /// A title page's name, a person's name.
        static var title: Font { custom(Face.condensed, 30, .title2) }
        /// A section's or a row's name.
        static var heading: Font { custom(Face.condensed, 22, .title3) }
        static var sectionTitle: Font { heading }
        /// Buttons and anything you press: mono semibold. Uppercase and track with `.controlText()`.
        static var headline: Font { custom(Face.monoSemiBold, 15, .headline) }
        static var control: Font { custom(Face.monoSemiBold, 13, .subheadline) }
        /// The name of a section above its list; red, uppercase, tracked: `SectionLabel`.
        static var label: Font { custom(Face.monoSemiBold, 13, .footnote) }
        /// Interface text.
        static var body: Font { custom(Face.mono, 15, .subheadline) }
        /// A line of facts under a title.
        static var caption: Font { custom(Face.mono, 12, .caption) }
        static var micro: Font { custom(Face.monoSemiBold, 11, .caption2) }
        /// Prose: overviews, reviews, biographies.
        static var reading: Font { custom(Face.serif, 17, .body) }
        static var readingStrong: Font { custom(Face.serifSemiBold, 17, .body) }
        static var readingItalic: Font { custom(Face.serifItalic, 17, .body) }
        /// A time, duration or resolution that should line up with its neighbours (Plex Mono is tabular already).
        static var time: Font { custom(Face.monoSemiBold, 15, .headline).monospacedDigit() }
        /// A big number with a label under it: ratings, stats.
        static var figure: Font { custom(Face.condensed, 24, .title3).monospacedDigit() }
        /// Small print: mono, tracked and uppercase through `.edgePrint()`.
        static var edgePrint: Font { micro.monospacedDigit() }
        /// A title set as text when a film has no logo art.
        static func artworkTitle(_ size: CGFloat) -> Font { .custom(Face.condensed, size: size, relativeTo: .title) }
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

    /// A colour that is `light` on a light appearance and `dark` on a dark one.
    init(light: UInt32, dark: UInt32) {
        #if os(macOS)
        self.init(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(hex: dark) : NSColor(hex: light)
        })
        #else
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
        #endif
    }
}

#if os(macOS)
extension NSColor {
    convenience init(hex: UInt32) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
#else
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
#endif

extension AppearanceChoice {
    /// What to hand `preferredColorScheme`: nil follows the system. Apple TV always follows it.
    var colorScheme: ColorScheme? {
        if Platform.isTV { return nil }
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
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

    /// Small print: uppercase and tracked. Pair with `Theme.Typeface.edgePrint` or `.label`.
    func edgePrint(tracking amount: CGFloat = 1.4) -> some View {
        textCase(.uppercase).tracking(amount)
    }

    /// Button and control text: uppercase with .06em tracking. Pair with `Theme.Typeface.control` or `.headline`.
    func controlText() -> some View {
        textCase(.uppercase).tracking(0.06 * 13 * Theme.scale)
    }

    /// The player and anything that sits on video is dark in both themes: every token resolves to its dark value.
    func darkScope() -> some View { environment(\.colorScheme, .dark) }

    /// A thin ink stroke that frames artwork.
    func hairline<S: InsettableShape>(_ shape: S, opacity: Double = 1) -> some View {
        overlay(shape.strokeBorder(Theme.Palette.rule.opacity(opacity), lineWidth: Theme.Rule.thin))
    }

    /// A 2px ink frame, as every control and artwork cell wears.
    func ruleFrame(_ color: Color = Theme.Palette.rule, width: CGFloat = Theme.Rule.heavy) -> some View {
        overlay(Rectangle().strokeBorder(color, lineWidth: width))
    }

    /// A 1px ink line under a row, the divider between the rows of a list.
    func ruledRow(_ color: Color = Theme.Palette.rule) -> some View {
        overlay(alignment: .bottom) { Rectangle().fill(color).frame(height: Theme.Rule.thin) }
    }

    /// Nothing casts a shadow; depth is order. Kept so call sites read the same.
    func artworkShadow(_ strength: Double = 1) -> some View { self }

    /// Marquee has no glass: a flat paper panel with the ink rule, or flat ink over video when given
    /// `Theme.Palette.overPicture`. (System bars on iOS 26 keep whatever the system draws.) Kept under its old name
    /// so every call site compiles while the screens are converted.
    func flowGlass<S: Shape>(_ shape: S, interactive: Bool = false, tint: Color? = nil) -> some View {
        background(tint ?? Theme.Palette.bg, in: shape)
            .overlay(shape.stroke(tint == nil ? Theme.Palette.rule : Color.clear, lineWidth: Theme.Rule.heavy))
    }
}

/// Used to group glass shapes so they blend; there is no glass now, so it is a plain container.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder var content: Content

    var body: some View { content }
}

// MARK: - Buttons

/// The inversion every control shares: blue with on-blue text while hovered (Mac, iPad pointer), focused (Apple TV)
/// or keyboard-focused. Pressed adds a 0.97 scale.
private struct IndexControl<Label: View>: View {
    enum Kind { case primary, secondary, quiet }
    let kind: Kind
    var square: Bool = false
    var compact: Bool = false
    let pressed: Bool
    @ViewBuilder var label: Label
    @Environment(\.isFocused) private var focused
    @Environment(\.isEnabled) private var enabled
    @State private var hovering = false

    private var inverted: Bool { enabled && (focused || hovering) }

    var body: some View {
        let size = (compact ? 44 : 48) * Theme.scale
        let ink: Color = {
            if !enabled { return Theme.Palette.faint }
            if inverted { return Theme.Palette.onBlue }
            return kind == .primary ? Theme.Palette.bg : Theme.Palette.fg
        }()
        let fill: Color = {
            if inverted { return pressed ? Theme.Palette.bluePressed : Theme.Palette.blue }
            if !enabled { return kind == .primary ? Theme.Palette.tint2 : .clear }
            switch kind {
            case .primary: return Theme.Palette.fg
            case .secondary: return Theme.Palette.bg
            case .quiet: return .clear
            }
        }()
        let border: Color = {
            if !enabled { return kind == .quiet ? .clear : Theme.Palette.tint3 }
            if inverted { return Theme.Palette.blue }
            return kind == .quiet ? .clear : Theme.Palette.fg
        }()
        label
            .font(square ? .system(size: (compact ? 15 : 17) * Theme.scale, weight: .semibold) : Theme.Typeface.control)
            .controlText()
            .foregroundStyle(ink)
            // A word is never broken across lines ("Detail / s" on Apple TV), and long ones shrink a little.
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .fixedSize(horizontal: !square, vertical: false)
            .frame(minWidth: size, minHeight: size)
            .padding(.horizontal, square ? 0 : Theme.Space.m + 2)
            .background(fill)
            .overlay(Rectangle().strokeBorder(border, lineWidth: Theme.Rule.heavy))
            .contentShape(Rectangle())
            .scaleEffect(pressed ? 0.97 : 1)
            .animation(Theme.Motion.hover, value: inverted)
            .animation(Theme.Motion.state, value: pressed)
            .modifier(FocusLift(scale: 1.04))
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

/// The one next action on a screen (Resume, Play, a source's Play): solid ink with paper text; blue on hover or focus.
struct PrimaryButtonStyle: ButtonStyle {
    /// A smaller button for use inside rows and panels, where the full-size one would dominate.
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        IndexControl(kind: .primary, compact: compact, pressed: configuration.isPressed) { configuration.label }
    }
}

/// Secondary controls: paper with the 2px ink border, blue on hover or focus. `circle` is the icon button, a square
/// (the name is from when it was round). Glass is gone; over video the player's dark scope makes it ink.
struct GlassButtonStyle: ButtonStyle {
    var circle = false
    /// Matches `PrimaryButtonStyle(compact:)`, so the two sit level in a row.
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        IndexControl(kind: .secondary, square: circle, compact: compact, pressed: configuration.isPressed) { configuration.label }
    }
}

typealias SecondaryButtonStyle = GlassButtonStyle

/// No border, for small actions and icons.
struct QuietButtonStyle: ButtonStyle {
    var square = false
    var compact = true

    func makeBody(configuration: Configuration) -> some View {
        IndexControl(kind: .quiet, square: square, compact: compact, pressed: configuration.isPressed) { configuration.label }
    }
}

/// A filter chip or one cell of segmented tabs: a bordered mono cell; the current one is inverted ink, never blue.
struct FilterChipStyle: ButtonStyle {
    var current = false

    func makeBody(configuration: Configuration) -> some View {
        FilterChipBody(configuration: configuration, current: current)
    }
}

private struct FilterChipBody: View {
    let configuration: ButtonStyleConfiguration
    let current: Bool
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    var body: some View {
        let lit = focused || hovering
        let fill = lit ? Theme.Palette.blue : current ? Theme.Palette.fg : Theme.Palette.bg
        let ink = lit ? Theme.Palette.onBlue : current ? Theme.Palette.bg : Theme.Palette.fg
        configuration.label
            .font(Theme.Typeface.control)
            .controlText()
            .foregroundStyle(ink)
            .lineLimit(1)
            .padding(.horizontal, Theme.Space.m)
            .frame(minHeight: 40 * Theme.scale)
            .background(fill)
            .overlay(Rectangle().strokeBorder(lit ? Theme.Palette.blue : Theme.Palette.fg, lineWidth: Theme.Rule.heavy))
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Theme.Motion.hover, value: lit)
            .animation(Theme.Motion.state, value: configuration.isPressed)
            .modifier(FocusLift(scale: 1.04))
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

/// Segmented tabs: bordered cells that share their borders, the current one inverted.
struct SegmentedTabs<Value: Hashable>: View {
    let options: [(value: Value, title: String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: -Theme.Rule.heavy) {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button(option.title) { selection = option.value }
                    .buttonStyle(FilterChipStyle(current: selection == option.value))
                    .accessibilityAddTraits(selection == option.value ? .isSelected : [])
            }
        }
    }
}

/// A list row: 1px ink divider under it, and the whole row inverts to blue while pressed, hovered or focused.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        RowBody(configuration: configuration)
    }
}

private struct RowBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    var body: some View {
        let lit = focused || hovering || configuration.isPressed
        configuration.label
            .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.fg)
            .padding(.vertical, Theme.Space.s)
            .padding(.horizontal, Theme.Space.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(lit ? Theme.Palette.blue : Color.clear)
            .contentShape(Rectangle())
            .ruledRow()
            .animation(Theme.Motion.hover, value: lit)
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

// MARK: - Page pieces

/// The name of a section above its list: red mono uppercase, `Browse by Genre`.
struct SectionLabel: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .font(Theme.Typeface.label)
            .textCase(.uppercase)
            .tracking(0.12 * 13 * Theme.scale)
            .foregroundStyle(Theme.Palette.red)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A plain rule: 2px by default, 1px between rows.
struct RuleLine: View {
    var thin = false
    var body: some View {
        Rectangle().fill(Theme.Palette.rule).frame(height: thin ? Theme.Rule.thin : Theme.Rule.heavy)
            .accessibilityHidden(true)
    }
}

/// A page's head: the giant uppercase Archivo title with the 2px rule under it, and an optional mono note at its right.
struct PageTitle: View {
    let title: String
    var note: String?

    init(_ title: String, note: String? = nil) {
        self.title = title
        self.note = note
    }

    var body: some View {
        let size = Theme.Typeface.giantSize * Theme.scale
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .lastTextBaseline, spacing: Theme.Space.m) {
                Text(title)
                    .font(Theme.Typeface.giant)
                    .textCase(.uppercase)
                    .tracking(-0.03 * size)
                    // The website sets it at 0.84 line height; a negative spacing pulls wrapped lines together.
                    .lineSpacing(-0.14 * size)
                    .foregroundStyle(Theme.Palette.fg)
                    .lineLimit(2)
                    .minimumScaleFactor(0.5)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if let note {
                    Text(note)
                        .font(Theme.Typeface.caption)
                        .textCase(.uppercase)
                        .tracking(0.06 * 12 * Theme.scale)
                        .foregroundStyle(Theme.Palette.muted)
                }
            }
            RuleLine()
        }
    }
}

/// The wordmark: MARQUEE in Plex Sans Condensed over a row of seven red bulbs, each rimmed in the lettering's colour
/// so the red reads on blue and on paper. Sized by `size` (the font size, as on the website); `color` is the lettering
/// and the rim (on-blue on the blue logo block).
struct Wordmark: View {
    var size: CGFloat = 28
    var color: Color = Theme.Palette.onBlue

    var body: some View {
        let em = size * Theme.scale
        // The bulbs are an overlay of the lettering, so their row is exactly as wide as the word.
        Text("MARQUEE")
            .font(.custom(Theme.Face.condensed, size: em))
            .tracking(0.03 * em)
            .lineLimit(1)
            .fixedSize()
            .padding(.bottom, 0.56 * em)
            .overlay(alignment: .bottom) {
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { index in
                        if index > 0 { Spacer(minLength: 0) }
                        ZStack {
                            Circle().fill(color)
                            Circle().fill(Theme.Palette.red).padding(0.07 * em)
                        }
                        .frame(width: 0.34 * em, height: 0.34 * em)
                    }
                }
                .padding(.horizontal, -0.07 * em)
            }
        .foregroundStyle(color)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Marquee")
    }
}
