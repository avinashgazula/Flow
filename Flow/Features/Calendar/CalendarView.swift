import SwiftUI
import FlowKit

/// What's new and what's next from the shows and films you follow, day by day.
struct CalendarView: View {
    @Environment(AppModel.self) private var model
    @State private var entries: [CalendarEntry]?

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
                VStack(alignment: .leading, spacing: Theme.Space.section) {
                    if let entries {
                        if entries.isEmpty {
                            ContentUnavailableView("Nothing Coming Up", systemImage: "calendar",
                                                   description: Text("New episodes of the shows in your library, and films on your watchlist, appear here as their dates approach."))
                                .padding(.top, Theme.Space.xxl)
                        } else {
                            DayStrip(start: today, marked: Set(upcomingDays.map(\.date))) { date in
                                withAnimation(Theme.Motion.gentle) { proxy.scrollTo(date, anchor: .top) }
                            }
                            if !justAired.isEmpty { justAiredSection }
                            ForEach(upcomingDays) { day in
                                daySection(day).id(day.date)
                            }
                        }
                    } else {
                        placeholder
                    }
                }
                .padding(.vertical, Theme.Space.m)
                .padding(.bottom, Theme.Space.xl)
            }
            .scrollIndicators(.hidden)
        }
        .background(AmbientBackground(url: upcomingDays.first?.entries.first?.item.smallBackdropURL, intensity: 0.55))
        .navigationTitle("Upcoming")
        .task(id: model.contentVersion) {
            let loaded = await model.calendar()
            withAnimation(Theme.Motion.fade) { entries = loaded }
        }
        .refreshable { entries = await model.calendar() }
    }

    // MARK: Sections

    private var justAiredSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            header("Just Aired", detail: "The last seven days")
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 16) {
                    ForEach(justAired) { entry in CalendarCard(entry: entry, dateLabel: relativeDay(day(of: entry)), upcoming: false) }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Platform.isTV ? 36 : 4)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollClipDisabled()
        }
    }

    @ViewBuilder
    private func daySection(_ day: CalendarDay) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            header(relativeDay(day.date), detail: fullDate(day.date))
            if Platform.isPhone {
                VStack(spacing: Theme.Space.s) {
                    ForEach(day.entries) { entry in CalendarRow(entry: entry) }
                }
                .padding(.horizontal, Theme.Space.gutter)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 16) {
                        ForEach(day.entries) { entry in CalendarCard(entry: entry, dateLabel: nil) }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.vertical, Platform.isTV ? 36 : 4)
                }
                .scrollClipDisabled()
            }
        }
    }

    private func header(_ title: String, detail: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
            Text(title).font(Theme.Typeface.sectionTitle).displayTracking()
            Text(detail).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Space.gutter)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var placeholder: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.Palette.surface).frame(width: 140, height: 22)
            ForEach(0..<4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.Palette.surface).frame(height: Platform.isTV ? 160 : 84)
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
        .shimmering()
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

/// Two weeks at a glance; days with something on carry a dot and jump to their section.
private struct DayStrip: View {
    let start: Date
    let marked: Set<Date>
    let onSelect: (Date) -> Void

    // UTC like `start`: stepping in the local calendar drifts an hour across a daylight-saving change and misses the markers.
    private var days: [Date] { (0..<14).compactMap { CalendarView.utc.date(byAdding: .day, value: $0, to: start) } }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.xs) {
                ForEach(days, id: \.self) { date in
                    let isToday = date == start
                    let hasEntries = marked.contains(date)
                    Button { if hasEntries { onSelect(date) } } label: {
                        VStack(spacing: 4) {
                            Text(CalendarView.format(date, "EEE").uppercased())
                                .font(Theme.Typeface.micro).kerning(0.6)
                                .foregroundStyle(isToday ? Theme.Palette.onStock.opacity(0.7) : Theme.Palette.textTertiary)
                            Text(CalendarView.format(date, "d"))
                                .font(.system(.title3, weight: .semibold).monospacedDigit())
                                .foregroundStyle(isToday ? Theme.Palette.onStock : (hasEntries ? Theme.Palette.text : Theme.Palette.textSecondary))
                            Circle()
                                .fill(isToday ? Theme.Palette.onStock : Theme.Palette.text)
                                .frame(width: 4 * Theme.scale, height: 4 * Theme.scale)
                                .opacity(hasEntries ? 1 : 0)
                        }
                        .frame(width: 46 * Theme.scale, height: 72 * Theme.scale)
                        .background {
                            let shape = RoundedRectangle(cornerRadius: 14 * Theme.scale, style: .continuous)
                            if isToday { shape.fill(Theme.Palette.stock) } else { shape.fill(Theme.Palette.surface).overlay(shape.strokeBorder(Theme.Palette.hairline)) }
                        }
                    }
                    .buttonStyle(CardButtonStyle())
                    .accessibilityLabel(CalendarView.format(date, "EEEE MMMM d") + (hasEntries ? ", has new episodes" : ""))
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Platform.isTV ? 24 : 0)
        }
        .scrollClipDisabled()
        // Fixed-size day chips: their text grows only as far as it fits. VoiceOver reads the full date.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

/// iPhone: a framed still beside the show and episode.
private struct CalendarRow: View {
    let entry: CalendarEntry

    var body: some View {
        NavigationLink(value: Route.detail(entry.item, zoom: "calendar-\(entry.id)")) {
            HStack(spacing: Theme.Space.s) {
                CalendarFrame(entry: entry).frame(width: 128).zoomSource("calendar-\(entry.id)")
                VStack(alignment: .leading, spacing: 3) {
                    Text(entry.item.title).font(.system(.subheadline, weight: .semibold)).lineLimit(1)
                    Text(entry.meta)
                        .font(.system(.footnote))
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.Palette.textTertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.spoken(model: model, day: nil))
        .accessibilityAddTraits(.isButton)
        .contextMenu {
            #if !os(tvOS)
            AddToCalendarButton(item: entry.item, episode: entry.episode, date: entry.date)
            #endif
            MediaContextMenu(item: entry.item)
        }
    }

    @Environment(AppModel.self) private var model
}

/// iPad, Mac, TV and Just Aired: a framed still with the show and episode beneath. Aired episodes play straight away.
private struct CalendarCard: View {
    let entry: CalendarEntry
    let dateLabel: String?
    /// Just Aired cards are in the past: nothing to put in a calendar.
    var upcoming = true
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if entry.hasAired {
                Button { Task { await model.play(entry.item, episode: entry.episode) } } label: { content }
            } else {
                NavigationLink(value: Route.detail(entry.item)) { content }
            }
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .contextMenu {
            Button { model.navigate(to: .detail(entry.item)) } label: { Label("Go to Details", systemImage: "info.circle") }
            #if !os(tvOS)
            if upcoming { AddToCalendarButton(item: entry.item, episode: entry.episode, date: entry.date) }
            #endif
            MediaContextMenu(item: entry.item)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            CalendarFrame(entry: entry, day: dateLabel).frame(width: Platform.landscapeWidth)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.item.title).font(Theme.Typeface.headline).lineLimit(1)
                Text(entry.meta)
                    .font(.system(.subheadline).monospacedDigit())
                    .foregroundStyle(Theme.Palette.textSecondary)
                    .lineLimit(1)
            }
            .frame(width: Platform.landscapeWidth, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.spoken(model: model, day: dateLabel))
    }
}

/// The still as a film frame: the episode, its label and the day are printed on the strip, nothing over the art.
private struct CalendarFrame: View {
    let entry: CalendarEntry
    var day: String?
    @Environment(AppModel.self) private var model

    var body: some View {
        FilmFrame(art: .stillImage(url: TMDBImage.url(entry.episode?.stillPath, size: .still) ?? entry.item.smallBackdropURL ?? entry.item.tmdbPosterURL,
                                   title: entry.item.title),
                  strip: .calendar(episodeCode: entry.episode?.code, label: entry.label, day: day, hasAired: entry.hasAired,
                                   watched: entry.isWatched(in: model)))
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

    /// The line under the title: the episode's name, or a film's year and genre.
    var meta: String {
        if let episode { return episode.title }
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
