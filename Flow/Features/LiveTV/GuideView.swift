import SwiftUI
import FlowKit

/// Timeline programme guide as a ruled grid: channels down the side, time across the top, programmes as ruled cells
/// (what is on now is ink-filled) and a red line for "now". `header` scrolls with it, above the grid.
struct GuideView<Header: View>: View {
    let channels: [Channel]
    let epg: EPG
    let onPlay: (Channel) -> Void
    @ViewBuilder var header: Header

    @State private var inspecting: GuideSelection?

    private let hours: Double = 6
    private var pointsPerMinute: CGFloat { Platform.isTV ? 12 : (Platform.isPhone ? 4.2 : 6) }
    private var rowHeight: CGFloat { Platform.isTV ? 120 : 64 }
    private var channelColumn: CGFloat { Platform.isTV ? 260 : (Platform.isPhone ? 92 : 150) }
    private var timelineWidth: CGFloat { CGFloat(hours * 60) * pointsPerMinute }
    private var headerHeight: CGFloat { 34 * Theme.scale }

    static func roundedNow(_ date: Date = Date()) -> Date {
        let now = date.timeIntervalSince1970
        return Date(timeIntervalSince1970: (now / 1800).rounded(.down) * 1800 - 1800)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            // Derived from the clock so a guide left open for hours keeps "now" inside the window.
            let start = Self.roundedNow(context.date)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    header
                    HStack(alignment: .top, spacing: 0) {
                        channelsColumn
                        ScrollView(.horizontal, showsIndicators: false) {
                            ZStack(alignment: .topLeading) {
                                // Lazy: a few thousand channels would otherwise each look up their schedule every minute.
                                LazyVStack(alignment: .leading, spacing: 0) {
                                    timeHeader(start: start)
                                    ForEach(channels) { channel in
                                        programmeRow(channel, start: start, now: context.date)
                                            .frame(height: rowHeight)
                                            .ruledRow()
                                    }
                                }
                                nowLine(context.date, start: start)
                            }
                            .frame(width: timelineWidth, alignment: .leading)
                        }
                        .scrollClipDisabled()
                    }
                    .padding(.leading, Theme.Space.gutter)
                }
                .padding(.bottom, Theme.Space.xl)
            }
            .scrollIndicators(.hidden)
        }
        .sheet(item: $inspecting) { selection in
            ProgrammeSheet(selection: selection) { onPlay(selection.channel) }
        }
    }

    // MARK: Parts

    private var channelsColumn: some View {
        LazyVStack(spacing: 0) {
            // Fixed width: a bare Color.clear is greedy and would take half the row from the timeline.
            Color.clear.frame(width: channelColumn, height: headerHeight)
                .overlay(alignment: .bottom) { RuleLine() }
            ForEach(channels) { channel in
                Button { onPlay(channel) } label: {
                    VStack(spacing: 4) {
                        ChannelBadge(channel: channel, size: rowHeight * 0.42)
                        if !Platform.isPhone {
                            Text(channel.name)
                                .font(Theme.Typeface.micro)
                                .rowInk(Theme.Palette.muted)
                                .lineLimit(1)
                                .padding(.horizontal, Theme.Space.xxs)
                        }
                    }
                    .frame(width: channelColumn, height: rowHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(GuideChannelStyle())
                .accessibilityLabel("Play \(channel.name)")
            }
        }
        // A lazy stack takes all the width it's offered; pinned, the timeline starts right beside it.
        .frame(width: channelColumn)
        .overlay(alignment: .trailing) { Rectangle().fill(Theme.Palette.rule).frame(width: Theme.Rule.heavy) }
        .background(Theme.Palette.bg)
        .zIndex(1)
    }

    private func timeHeader(start: Date) -> some View {
        HStack(spacing: 0) {
            ForEach(0..<Int(hours * 2), id: \.self) { i in
                let date = start.addingTimeInterval(Double(i) * 1800)
                Text(date.formatted(date: .omitted, time: .shortened))
                    .font(Theme.Typeface.micro)
                    .foregroundStyle(Theme.Palette.muted)
                    .lineLimit(1)
                    .frame(width: 30 * pointsPerMinute, alignment: .leading)
                    .padding(.leading, 6)
                    .frame(height: headerHeight)
                    .overlay(alignment: .leading) { Rectangle().fill(Theme.Palette.rule).frame(width: Theme.Rule.thin) }
            }
        }
        .frame(height: headerHeight, alignment: .center)
        .overlay(alignment: .bottom) { RuleLine() }
    }

    private func programmeRow(_ channel: Channel, start: Date, now: Date) -> some View {
        let end = start.addingTimeInterval(hours * 3600)
        let programmes = epg.schedule(for: channel.epgID, from: start, hours: hours)
        return ZStack(alignment: .leading) {
            if programmes.isEmpty {
                Text("No guide information")
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.faint)
                    .padding(.leading, 12)
                    .frame(width: timelineWidth, height: rowHeight, alignment: .leading)
                    .background(Theme.Palette.tint1)
            }
            ForEach(programmes) { programme in
                let visibleStart = max(programme.start, start)
                let visibleEnd = min(programme.end, end)
                let x = CGFloat(visibleStart.timeIntervalSince(start) / 60) * pointsPerMinute
                let width = max(2, CGFloat(visibleEnd.timeIntervalSince(visibleStart) / 60) * pointsPerMinute)
                let live = programme.isAiring(at: now)
                Button { if live { onPlay(channel) } else { inspecting = GuideSelection(channel: channel, programme: programme) } } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(programme.title).font(Theme.Typeface.control).lineLimit(1)
                        Text("\(programme.start.formatted(date: .omitted, time: .shortened)) – \(programme.end.formatted(date: .omitted, time: .shortened))")
                            .font(Theme.Typeface.micro).rowInk(Theme.Palette.muted).lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .frame(width: width, height: rowHeight, alignment: .leading)
                    .overlay(alignment: .bottomLeading) {
                        if live {
                            Rectangle().fill(Theme.Palette.red)
                                .frame(width: max(0, width * programme.progress(at: now)), height: 3 * Theme.scale)
                        }
                    }
                }
                .buttonStyle(GuideCellStyle(live: live))
                .contextMenu {
                    if live { Button { onPlay(channel) } label: { Label("Watch Now", systemImage: "play.fill") } }
                    Button { inspecting = GuideSelection(channel: channel, programme: programme) } label: { Label("Details", systemImage: "info.circle") }
                }
                .offset(x: x)
            }
        }
        .frame(width: timelineWidth, alignment: .leading)
    }

    /// A red line down the grid at the current time, with a square flag at its head.
    private func nowLine(_ now: Date, start: Date) -> some View {
        let x = CGFloat(now.timeIntervalSince(start) / 60) * pointsPerMinute
        return VStack(spacing: 0) {
            Rectangle().fill(Theme.Palette.red).frame(width: 9, height: 9)
            Rectangle().fill(Theme.Palette.red).frame(width: 2)
        }
        .offset(x: x - 4, y: headerHeight - 9)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A programme cell: a 1px ink frame; ink-filled when it is on now; blue while hovered or focused.
private struct GuideCellStyle: ButtonStyle {
    let live: Bool

    func makeBody(configuration: Configuration) -> some View {
        GuideCellBody(configuration: configuration, live: live)
    }
}

private struct GuideCellBody: View {
    let configuration: ButtonStyleConfiguration
    let live: Bool
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    var body: some View {
        let lit = focused || hovering || configuration.isPressed
        let inverted = lit || live
        configuration.label
            .environment(\.rowLit, inverted)
            .foregroundStyle(inverted ? Theme.Palette.onBlue : Theme.Palette.fg)
            .background(lit ? Theme.Palette.blue : live ? Theme.Palette.fg : Theme.Palette.bg)
            .overlay(Rectangle().strokeBorder(lit ? Theme.Palette.blue : Theme.Palette.fg, lineWidth: lit && Platform.isTV ? Theme.Rule.focus : Theme.Rule.thin))
            .contentShape(Rectangle())
            .animation(Theme.Motion.hover, value: lit)
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

/// A channel cell in the guide's fixed column: paper, blue while hovered, pressed or focused.
private struct GuideChannelStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        GuideChannelBody(configuration: configuration)
    }
}

private struct GuideChannelBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    var body: some View {
        let lit = focused || hovering || configuration.isPressed
        configuration.label
            .environment(\.rowLit, lit)
            .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.fg)
            .background(lit ? Theme.Palette.blue : Color.clear)
            .ruledRow()
            .animation(Theme.Motion.hover, value: lit)
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

/// Channel logo, or its initials on a quiet plate when there's no logo. A square frame 1.6 times as wide as tall.
struct ChannelBadge: View {
    let channel: Channel
    let size: CGFloat

    var body: some View {
        Group {
            if channel.logoURL != nil {
                RemoteImage(url: channel.logoURL, contentMode: .fit, maxPixel: 300)
                    .padding(6)
                    .background(Theme.Palette.tint2)
            } else {
                Theme.Palette.tint2
                    .overlay {
                        Text(Self.initials(channel.name))
                            .font(.custom(Theme.Face.condensed, size: size * 0.38))
                            .foregroundStyle(Theme.Palette.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                    }
            }
        }
        .frame(width: size * 1.6, height: size)
        .clipped()
        .overlay(Rectangle().strokeBorder(Theme.Palette.rule, lineWidth: Theme.Rule.thin))
        .accessibilityHidden(true)
    }

    private static func initials(_ name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}

struct GuideSelection: Identifiable {
    let channel: Channel
    let programme: Programme
    var id: String { "\(channel.id)-\(programme.id)" }
}

/// One programme's details as a ruled panel: what it is, when, and a way in if it's on now.
private struct ProgrammeSheet: View {
    let selection: GuideSelection
    let watch: () -> Void
    @Environment(\.dismiss) private var dismiss

    private var programme: Programme { selection.programme }

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 30)) { context in
                let live = programme.isAiring(at: context.date)
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Space.m) {
                        RuleLine()
                        HStack(spacing: Theme.Space.s) {
                            ChannelBadge(channel: selection.channel, size: Platform.isTV ? 64 : 36)
                            SectionLabel(selection.channel.name)
                            if live {
                                Text("Live")
                                    .font(Theme.Typeface.micro)
                                    .textCase(.uppercase)
                                    .tracking(0.12 * 11 * Theme.scale)
                                    .foregroundStyle(Theme.Palette.bg)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Theme.Palette.red)
                            }
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(programme.title).font(Theme.Typeface.title).textCase(.uppercase)
                            if let subtitle = programme.subtitle, !subtitle.isEmpty {
                                Text(subtitle).font(Theme.Typeface.body).foregroundStyle(Theme.Palette.muted)
                            }
                        }
                        Text(timing(at: context.date))
                            .font(Theme.Typeface.caption)
                            .foregroundStyle(Theme.Palette.muted)
                        if live {
                            RedBar(value: programme.progress(at: context.date))
                        }
                        RuleLine(thin: true)
                        if let category = programme.category, !category.isEmpty {
                            Text(category)
                                .font(Theme.Typeface.micro)
                                .textCase(.uppercase)
                                .tracking(0.08 * 11 * Theme.scale)
                                .foregroundStyle(Theme.Palette.red)
                        }
                        if let description = programme.description, !description.isEmpty {
                            Text(description).font(Theme.Typeface.reading)
                        }
                        if live {
                            Button {
                                dismiss()
                                watch()
                            } label: { Label("Watch Now", systemImage: "play.fill").frame(maxWidth: .infinity) }
                            .buttonStyle(PrimaryButtonStyle())
                            .padding(.top, Theme.Space.s)
                        }
                    }
                    .frame(maxWidth: 640, alignment: .leading)
                    .padding(Theme.Space.gutter)
                }
            }
            .background(Theme.Palette.bg.ignoresSafeArea())
            .inlineNavigationTitle()
            .sheetDoneButton { dismiss() }
        }
        .presentationDetents([.medium, .large])
    }

    private func timing(at now: Date) -> String {
        let day = Calendar.current.isDateInToday(programme.start) ? "" : programme.start.formatted(.dateTime.weekday(.wide)) + " · "
        let range = "\(programme.start.formatted(date: .omitted, time: .shortened)) – \(programme.end.formatted(date: .omitted, time: .shortened))"
        let minutes = Int(programme.end.timeIntervalSince(programme.start) / 60)
        if programme.start > now {
            let until = Int(programme.start.timeIntervalSince(now) / 60)
            let starts = until < 60 ? "Starts in \(max(1, until)) min" : "Starts in \(until / 60) h \(until % 60) min"
            return day + range + " · " + starts
        }
        if programme.end <= now { return day + range + " · Ended" }
        let left = Int(programme.end.timeIntervalSince(now) / 60)
        return range + " · \(max(1, left)) min left of \(minutes)"
    }
}
