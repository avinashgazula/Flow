import SwiftUI
import FlowKit

/// Timeline programme guide: channels down the side, time across the top, a line for "now".
struct GuideView: View {
    let channels: [Channel]
    let epg: EPG
    let onPlay: (Channel) -> Void

    @State private var inspecting: GuideSelection?

    private let hours: Double = 6
    private var pointsPerMinute: CGFloat { Platform.isTV ? 12 : (Platform.isPhone ? 4.2 : 6) }
    private var rowHeight: CGFloat { Platform.isTV ? 120 : 64 }
    private var channelColumn: CGFloat { Platform.isTV ? 260 : (Platform.isPhone ? 92 : 150) }
    private var timelineWidth: CGFloat { CGFloat(hours * 60) * pointsPerMinute }

    static func roundedNow(_ date: Date = Date()) -> Date {
        let now = date.timeIntervalSince1970
        return Date(timeIntervalSince1970: (now / 1800).rounded(.down) * 1800 - 1800)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            // Derived from the clock so a guide left open for hours keeps "now" inside the window.
            let start = Self.roundedNow(context.date)
            ScrollView(.vertical) {
                HStack(alignment: .top, spacing: 0) {
                    channelsColumn
                    ScrollView(.horizontal, showsIndicators: false) {
                        ZStack(alignment: .topLeading) {
                            // Behind the programmes: it shows through their glass without crossing out titles and times.
                            nowLine(context.date, start: start)
                            // Lazy: a few thousand channels would otherwise each look up their schedule every minute.
                            LazyVStack(alignment: .leading, spacing: 0) {
                                timeHeader(start: start)
                                ForEach(channels) { channel in
                                    programmeRow(channel, start: start, now: context.date)
                                        .frame(height: rowHeight)
                                }
                            }
                        }
                        .frame(width: timelineWidth, alignment: .leading)
                    }
                    .scrollClipDisabled()
                }
            }
        }
        .sheet(item: $inspecting) { selection in
            ProgrammeSheet(selection: selection) { onPlay(selection.channel) }
        }
    }

    // MARK: Parts

    private var channelsColumn: some View {
        LazyVStack(spacing: 0) {
            // Fixed width: a bare Color.clear is greedy and would take half the row from the timeline.
            Color.clear.frame(width: channelColumn, height: 34)
            ForEach(channels) { channel in
                Button { onPlay(channel) } label: {
                    VStack(spacing: 4) {
                        ChannelBadge(channel: channel, size: rowHeight * 0.52)
                        if !Platform.isPhone {
                            Text(channel.name).font(Theme.Typeface.caption).lineLimit(1).foregroundStyle(Theme.Palette.textSecondary)
                        }
                    }
                    .frame(width: channelColumn, height: rowHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(CardButtonStyle())
                .accessibilityLabel("Play \(channel.name)")
            }
        }
        // A lazy stack takes all the width it's offered; pinned, the timeline starts right beside it.
        .frame(width: channelColumn)
        .background(Theme.Palette.canvas.opacity(0.85))
        .zIndex(1)
    }

    private func timeHeader(start: Date) -> some View {
        HStack(spacing: 0) {
            ForEach(0..<Int(hours * 2), id: \.self) { i in
                let date = start.addingTimeInterval(Double(i) * 1800)
                Text(date.formatted(date: .omitted, time: .shortened))
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.textTertiary)
                    .frame(width: 30 * pointsPerMinute, alignment: .leading)
                    .padding(.leading, 6)
            }
        }
        .frame(height: 34, alignment: .center)
    }

    private func programmeRow(_ channel: Channel, start: Date, now: Date) -> some View {
        let end = start.addingTimeInterval(hours * 3600)
        let programmes = epg.schedule(for: channel.epgID, from: start, hours: hours)
        return ZStack(alignment: .leading) {
            if programmes.isEmpty {
                Text("No guide information")
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.textTertiary)
                    .padding(.leading, 12)
                    .frame(width: timelineWidth, height: rowHeight - 6, alignment: .leading)
                    .background(Theme.Palette.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            ForEach(programmes) { programme in
                let visibleStart = max(programme.start, start)
                let visibleEnd = min(programme.end, end)
                let x = CGFloat(visibleStart.timeIntervalSince(start) / 60) * pointsPerMinute
                let width = max(2, CGFloat(visibleEnd.timeIntervalSince(visibleStart) / 60) * pointsPerMinute - 4)
                let live = programme.isAiring(at: now)
                Button { if live { onPlay(channel) } else { inspecting = GuideSelection(channel: channel, programme: programme) } } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(programme.title).font(.system(size: 13 * Theme.scale, weight: .semibold)).lineLimit(1)
                        Text("\(programme.start.formatted(date: .omitted, time: .shortened)) – \(programme.end.formatted(date: .omitted, time: .shortened))")
                            .font(.system(.caption2)).foregroundStyle(Theme.Palette.textTertiary).lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .frame(width: width, height: rowHeight - 6, alignment: .leading)
                    .background(live ? Color.white.opacity(0.16) : Theme.Palette.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(alignment: .bottomLeading) {
                        if live {
                            Capsule().fill(.white).frame(width: max(0, (width - 20) * programme.progress(at: now)), height: 2)
                                .padding(.horizontal, 10).padding(.bottom, 5)
                        }
                    }
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.Palette.hairline))
                }
                .buttonStyle(CardButtonStyle())
                .contextMenu {
                    if live { Button { onPlay(channel) } label: { Label("Watch Now", systemImage: "play.fill") } }
                    Button { inspecting = GuideSelection(channel: channel, programme: programme) } label: { Label("Details", systemImage: "info.circle") }
                }
                .offset(x: x)
            }
        }
        .frame(width: timelineWidth, alignment: .leading)
    }

    private func nowLine(_ now: Date, start: Date) -> some View {
        let x = CGFloat(now.timeIntervalSince(start) / 60) * pointsPerMinute
        return VStack(spacing: 0) {
            Circle().fill(Color.red).frame(width: 8, height: 8)
            Rectangle().fill(Color.red).frame(width: 1.5)
        }
        .offset(x: x - 4, y: 30)
        .allowsHitTesting(false)
    }
}

/// Channel logo, or its initials on a tinted plate when there's no logo.
struct ChannelBadge: View {
    let channel: Channel
    let size: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        Group {
            if channel.logoURL != nil {
                RemoteImage(url: channel.logoURL, contentMode: .fit, maxPixel: 300)
                    .padding(6)
                    .background(Theme.Palette.surfaceStrong)
            } else {
                Monogram(name: channel.name, fontSize: size * 0.38, condensed: true)
            }
        }
        .frame(width: size * 1.6, height: size)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Theme.Palette.hairline))
    }
}

struct GuideSelection: Identifiable {
    let channel: Channel
    let programme: Programme
    var id: String { "\(channel.id)-\(programme.id)" }
}

/// One programme's details: what it is, when, and a way in if it's on now.
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
                        HStack(spacing: Theme.Space.s) {
                            ChannelBadge(channel: selection.channel, size: Platform.isTV ? 64 : 36)
                            Text(selection.channel.name).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textSecondary)
                            if live {
                                Text("LIVE").font(.system(size: 11 * Theme.scale, weight: .heavy)).foregroundStyle(.white)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color.red, in: Capsule())
                            }
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(programme.title).font(Theme.Typeface.title)
                            if let subtitle = programme.subtitle, !subtitle.isEmpty {
                                Text(subtitle).font(Theme.Typeface.body).foregroundStyle(Theme.Palette.textSecondary)
                            }
                        }
                        Text(timing(at: context.date))
                            .font(Theme.Typeface.caption)
                            .foregroundStyle(Theme.Palette.textSecondary)
                        if live {
                            ProgressView(value: programme.progress(at: context.date)).tint(.white)
                        }
                        if let category = programme.category, !category.isEmpty {
                            Text(category.uppercased()).font(.system(size: 11 * Theme.scale, weight: .semibold)).tracking(0.6)
                                .foregroundStyle(Theme.Palette.textTertiary)
                        }
                        if let description = programme.description, !description.isEmpty {
                            Text(description).font(Theme.Typeface.body)
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
