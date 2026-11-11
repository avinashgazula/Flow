import SwiftUI
import FlowKit

/// What's new and what's next from the shows and films you follow, day by day.
struct CalendarView: View {
    @Environment(AppModel.self) private var model
    @State private var entries: [CalendarEntry]?
    #if !os(tvOS)
    @State private var icsURL: URL?
    #endif

    /// Air dates are calendar days, not instants: keep them in UTC so a 9pm local evening doesn't shift the day.
    static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private var today: Date {
        Self.utc.date(from: Calendar.current.dateComponents([.year, .month, .day], from: Date())) ?? Date()
    }

    private func day(of entry: CalendarEntry) -> Date { Self.utc.startOfDay(for: entry.date) }

    private var justAired: [CalendarEntry] {
        (entries ?? []).filter { day(of: $0) < today }.reversed()
    }

    private var upcomingDays: [CalendarDay] {
        let upcoming = (entries ?? []).filter { day(of: $0) >= today }
        let grouped = Dictionary(grouping: upcoming, by: day(of:))
        return grouped.keys.sorted().map { CalendarDay(date: $0, entries: grouped[$0] ?? []) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.l) {
                    BrowseHead("Upcoming", note: "New episodes and releases")
                    if let entries {
                        if entries.isEmpty {
                            BrowseEmpty(title: "Nothing Coming Up",
                                        message: "New episodes of the shows in your library, and films on your watchlist, appear here as their dates approach.")
                        } else {
                            dayToolbar(proxy)
                            if !justAired.isEmpty { justAiredSection }
                            ForEach(upcomingDays) { day in
                                daySection(day).id(day.date)
                            }
                        }
                    } else {
                        placeholder
                    }
                }
                .padding(.bottom, Theme.Space.xl)
            }
            .scrollIndicators(.hidden)
        }
        .browsePage("Upcoming")
        .task(id: model.contentVersion) {
            let loaded = await model.calendar()
            withAnimation(Theme.Motion.state) { entries = loaded }
        }
        .refreshable { entries = await model.calendar() }
        #if !os(tvOS)
        // One file with every upcoming event, as the website's Add All to Calendar. Aired entries are left out.
        .onChange(of: entries) { icsURL = CalendarExport.icsFile(for: upcomingDays.flatMap(\.entries)) }
        #endif
    }

    // MARK: Sections

    /// The day strip, with Add All to Calendar at its end.
    private func dayToolbar(_ proxy: ScrollViewProxy) -> some View {
        BrowseToolbar {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                #if !os(tvOS)
                if let icsURL {
                    HStack {
                        Spacer(minLength: 0)
                        ShareLink(item: icsURL) { Text("Add All to Calendar") }
                            .buttonStyle(FilterChipStyle())
                    }
                }
                #endif
                DayStrip(start: today, marked: Set(upcomingDays.map(\.date))) { date in
                    withAnimation(Theme.Motion.move) { proxy.scrollTo(date, anchor: .top) }
                }
            }
        }
    }

    private var justAiredSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            SectionHead("Just Aired", note: "The last seven days")
            VStack(spacing: 0) {
                ForEach(justAired) { entry in CalendarRow(entry: entry, dayLabel: relativeDay(day(of: entry))) }
            }
            .padding(.horizontal, Theme.Space.gutter)
        }
    }

    private func daySection(_ day: CalendarDay) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            SectionHead(relativeDay(day.date), note: fullDate(day.date))
            VStack(spacing: 0) {
                ForEach(day.entries) { entry in CalendarRow(entry: entry, dayLabel: nil) }
            }
            .padding(.horizontal, Theme.Space.gutter)
        }
    }

    private var placeholder: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            Rectangle().fill(Theme.Palette.tint1).frame(width: 140, height: 22)
            ForEach(0..<4, id: \.self) { _ in
                Rectangle().fill(Theme.Palette.tint1).frame(height: Platform.isTV ? 160 : 84)
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
        .shimmering()
        .accessibilityHidden(true)
    }

    // MARK: Dates

    private func relativeDay(_ date: Date) -> String {
        let days = Self.utc.dateComponents([.day], from: today, to: date).day ?? 0
        switch days {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case -1: return "Yesterday"
        case 2...6, -6 ... -2: return Self.format(date, "EEEE")
        default: return Self.format(date, "MMM d")
        }
    }

    private func fullDate(_ date: Date) -> String { Self.format(date, "EEEE, MMMM d") }

    static func format(_ date: Date, _ template: String) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }
}

struct CalendarDay: Identifiable {
    let date: Date
    let entries: [CalendarEntry]
    var id: Date { date }
}

/// Two weeks at a glance as ruled cells that share their borders; today is inverted, days with something on carry a
/// red dot and jump to their section.
private struct DayStrip: View {
    let start: Date
    let marked: Set<Date>
    let onSelect: (Date) -> Void

    // UTC like `start`: stepping in the local calendar drifts an hour across a daylight-saving change and misses the markers.
    private var days: [Date] { (0..<14).compactMap { CalendarView.utc.date(byAdding: .day, value: $0, to: start) } }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: -Theme.Rule.heavy) {
                ForEach(days, id: \.self) { date in
                    let isToday = date == start
                    let hasEntries = marked.contains(date)
                    Button { if hasEntries { onSelect(date) } } label: {
                        VStack(spacing: 4) {
                            Text(CalendarView.format(date, "EEE"))
                                .font(Theme.Typeface.micro)
                                .textCase(.uppercase)
                                .tracking(0.6)
                                .rowInk(Theme.Palette.muted)
                            Text(CalendarView.format(date, "d"))
                                .font(Theme.Typeface.figure)
                                .rowInk(hasEntries ? Theme.Palette.fg : Theme.Palette.muted)
                            Rectangle()
                                .frame(width: 5 * Theme.scale, height: 5 * Theme.scale)
                                .rowInk(Theme.Palette.red)
                                .opacity(hasEntries ? 1 : 0)
                        }
                        .frame(width: 54 * Theme.scale, height: 76 * Theme.scale)
                    }
                    .buttonStyle(DayCellStyle(today: isToday))
                    .accessibilityLabel(CalendarView.format(date, "EEEE MMMM d") + (hasEntries ? ", has new episodes" : ""))
                }
            }
            .padding(.vertical, Platform.isTV ? Theme.Space.xs : 0)
        }
        .scrollClipDisabled()
        // Fixed-size day cells: their text grows only as far as it fits. VoiceOver reads the full date.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

/// A day cell: a 2px frame; ink-filled for today, blue while hovered or focused.
private struct DayCellStyle: ButtonStyle {
    let today: Bool

    func makeBody(configuration: Configuration) -> some View {
        DayCellBody(configuration: configuration, today: today)
    }
}

private struct DayCellBody: View {
    let configuration: ButtonStyleConfiguration
    let today: Bool
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    var body: some View {
        let lit = focused || hovering || configuration.isPressed
        let fill = lit ? Theme.Palette.blue : today ? Theme.Palette.fg : Theme.Palette.bg
        configuration.label
            // Today's ink fill reads like the blue one: on-blue marks on it.
            .environment(\.rowLit, lit || today)
            .background(fill)
            .overlay(Rectangle().strokeBorder(lit ? Theme.Palette.blue : Theme.Palette.fg, lineWidth: Theme.Rule.heavy))
            .contentShape(Rectangle())
            .animation(Theme.Motion.hover, value: lit)
            .modifier(FocusLift(scale: 1.04))
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

/// One episode or film as a ruled row: its still, then what it is and when. Aired episodes play straight away.
private struct CalendarRow: View {
    let entry: CalendarEntry
    /// Set for entries listed outside their own day heading (Just Aired).
    let dayLabel: String?
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if entry.hasAired {
                Button { Task { await model.play(entry.item, episode: entry.episode) } } label: { content }
            } else {
                NavigationLink(value: Route.detail(entry.item, zoom: "calendar-\(entry.id)")) { content }
            }
        }
        .buttonStyle(BrowseRowStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.spoken(model: model, day: dayLabel))
        .accessibilityAddTraits(.isButton)
        .contextMenu {
            Button { model.navigate(to: .detail(entry.item)) } label: { Label("Go to Details", systemImage: "info.circle") }
            #if !os(tvOS)
            if !entry.hasAired { AddToCalendarButton(item: entry.item, episode: entry.episode, date: entry.date) }
            #endif
            MediaContextMenu(item: entry.item)
        }
    }

    private var stillWidth: CGFloat { Platform.isPhone ? 112 : 144 * Theme.scale }

    private var content: some View {
        HStack(spacing: Theme.Space.m) {
            RowThumb(url: TMDBImage.url(entry.episode?.stillPath, size: .still) ?? entry.item.smallBackdropURL ?? entry.item.tmdbPosterURL,
                     title: entry.item.title, width: stillWidth, height: stillWidth * 9 / 16)
            VStack(alignment: .leading, spacing: 2) {
                if let label = entry.label {
                    Text(label)
                        .font(Theme.Typeface.micro)
                        .textCase(.uppercase)
                        .tracking(0.08 * 11 * Theme.scale)
                        .rowInk(Theme.Palette.red)
                }
                Text(entry.item.title).font(Theme.Typeface.heading).textCase(.uppercase).lineLimit(1)
                Text(entry.meta)
                    .font(Theme.Typeface.caption)
                    .rowInk(Theme.Palette.muted)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 0)
            if let dayLabel {
                Text(dayLabel).font(Theme.Typeface.caption).textCase(.uppercase).rowInk(Theme.Palette.muted).lineLimit(1)
            }
            RowChevron()
        }
    }
}

@MainActor
private extension CalendarEntry {
    /// What is special about it, if anything: a premiere, a film's release day, or a new episode.
    var label: String? {
        guard let episode else { return hasAired ? "Out Now" : "Release" }
        if episode.number == 1 { return episode.season == 1 ? "Series Premiere" : "Season Premiere" }
        return hasAired ? "New" : nil
    }

    /// The line under the title: an episode's code and name, or a film's year and genre.
    var meta: String {
        if let episode { return "\(episode.code) · \(episode.title)" }
        return item.shortMeta
    }

    func isWatched(in model: AppModel) -> Bool {
        guard let episode else { return false }
        return model.isEpisodeWatched(item, episode.ref)
    }

    func spoken(model: AppModel, day: String?) -> String {
        var extra: [String] = []
        if let label { extra.append(label) }
        if let day { extra.append(day) }
        if isWatched(in: model) { extra.append("watched") }
        return Reel.spokenListing(title: item.title, episode: episode?.ref, extra: extra)
    }
}
