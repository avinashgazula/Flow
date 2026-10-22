import SwiftUI

/// Rows grouped the way iOS groups a table: one flat panel, hairlines between rows (each row
/// draws its own with `tableDivider`). Apple TV keeps rows apart, since a focused row lifts out of
/// its neighbours. Used by the source picker, Live TV and Sports.
struct GroupedTable<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        #if os(tvOS)
        LazyVStack(spacing: Theme.Space.s) { content }
        #else
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous)
        LazyVStack(spacing: 0) { content }
            .background(Theme.Palette.surface, in: shape)
            .clipShape(shape)
            .hairline(shape)
        #endif
    }
}

/// Pressing a row highlights it like a table cell; on the Mac it highlights on hover; Apple TV lifts the
/// focused row a little (rows fill themselves with the spot via `tvRowSurface`).
struct TableRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        TableRowBody(label: configuration.label, pressed: configuration.isPressed)
    }
}

private struct TableRowBody<Label: View>: View {
    let label: Label
    let pressed: Bool
    @State private var hovering = false
    @Environment(\.isFocused) private var focused

    var body: some View {
        #if os(tvOS)
        label
            .scaleEffect(focused ? 1.02 : 1)
            .shadow(color: .black.opacity(focused ? 0.35 : 0), radius: 24, y: 8)
            .animation(Theme.Motion.snappy, value: focused)
        #else
        label
            .background(pressed ? Theme.Palette.lineStrong : hovering ? Theme.Palette.control : Color.clear)
            .contentShape(Rectangle())
            #if os(macOS)
            .onHover { hovering = $0 }
            #endif
        #endif
    }
}

extension View {
    /// The hairline between two rows of a `GroupedTable`, from `inset` across. Nothing on Apple TV.
    @ViewBuilder
    func tableDivider(_ shown: Bool, inset: CGFloat) -> some View {
        #if os(tvOS)
        self
        #else
        overlay(alignment: .top) {
            if shown { TableHairline().padding(.leading, inset) }
        }
        #endif
    }

    /// A focused Apple TV row's own surface: the spot when focused, the panel otherwise. Nothing elsewhere.
    @ViewBuilder
    func tvRowSurface(focused: Bool) -> some View {
        #if os(tvOS)
        background(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(focused ? Theme.Palette.spot : Theme.Palette.panel))
        #else
        self
        #endif
    }
}

private struct TableHairline: View {
    @Environment(\.displayScale) private var displayScale
    var body: some View {
        Rectangle().fill(Theme.Palette.hairline).frame(height: 1 / max(displayScale, 1))
    }
}
