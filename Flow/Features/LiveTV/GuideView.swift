import SwiftUI
import FlowKit

/// Timeline programme guide: channels down the side, time across the top, a line for "now".
struct GuideView: View {
    let channels: [Channel]
    let epg: EPG
    let onPlay: (Channel) -> Void

    @State private var start = GuideView.roundedNow()

    private let hours: Double = 6
    private var pointsPerMinute: CGFloat { Platform.isTV ? 12 : (Platform.isPhone ? 4.2 : 6) }
    private var rowHeight: CGFloat { Platform.isTV ? 120 : 64 }
    private var channelColumn: CGFloat { Platform.isTV ? 260 : (Platform.isPhone ? 92 : 150) }
    private var timelineWidth: CGFloat { CGFloat(hours * 60) * pointsPerMinute }

    static func roundedNow() -> Date {
        let now = Date().timeIntervalSince1970
        return Date(timeIntervalSince1970: (now / 1800).rounded(.down) * 1800 - 1800)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            ScrollView(.vertical) {
                HStack(alignment: .top, spacing: 0) {
                    channelsColumn
                    ScrollView(.horizontal, showsIndicators: false) {
                        ZStack(alignment: .topLeading) {
                            VStack(alignment: .leading, spacing: 0) {
                                timeHeader
                                ForEach(channels) { channel in
                                    programmeRow(channel, now: context.date)
                                        .frame(height: rowHeight)
                                }
                            }
                            nowLine(context.date)
                        }
                        .frame(width: timelineWidth, alignment: .leading)
                    }
                    .scrollClipDisabled()
                }
            }
        }
    }

    // MARK: Parts

    private var channelsColumn: some View {
        VStack(spacing: 0) {
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
        .background(Theme.Palette.canvas.opacity(0.85))
        .zIndex(1)
    }

    private var timeHeader: some View {
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

    private func programmeRow(_ channel: Channel, now: Date) -> some View {
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
                Button { if live { onPlay(channel) } } label: {
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
                .offset(x: x)
            }
        }
        .frame(width: timelineWidth, alignment: .leading)
    }

    private func nowLine(_ now: Date) -> some View {
        let x = CGFloat(now.timeIntervalSince(start) / 60) * pointsPerMinute
        return VStack(spacing: 0) {
            Circle().fill(Color.red).frame(width: 8, height: 8)
            Rectangle().fill(Color.red).frame(width: 1.5)
        }
        .offset(x: x - 4, y: 30)
        .allowsHitTesting(false)
    }
}

/// Channel logo, or its initials on a plate when there's no logo.
struct ChannelBadge: View {
    let channel: Channel
    let size: CGFloat

    var body: some View {
        Group {
            if channel.logoURL != nil {
                RemoteImage(url: channel.logoURL, contentMode: .fit, maxPixel: 300)
                    .padding(6)
            } else {
                Text(channel.name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined())
                    .font(.system(size: size * 0.38, weight: .heavy).width(.condensed))
                    .foregroundStyle(.white.opacity(0.88))
            }
        }
        .frame(width: size * 1.6, height: size)
        .background(Theme.Palette.surfaceStrong, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.Palette.hairline))
    }
}
