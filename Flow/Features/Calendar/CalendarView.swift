import SwiftUI
import FlowKit

/// What's new and what's next from the shows and films you follow, day by day.
struct CalendarView: View {
    @Environment(AppModel.self) private var model
    @State private var entries: [CalendarEntry]?

    /// Air dates are calendar days, not instants: keep them in UTC so a 9pm local evening doesn't shift the day.
    private static let utc: Calendar = {
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
                    ForEach(justAired) { entry in CalendarCard(entry: entry, dateLabel: relativeDay(day(of: entry))) }
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

    private var days: [Date] { (0..<14).compactMap { Calendar(identifier: .gregorian).date(byAdding: .day, value: $0, to: start) } }

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
                                .foregroundStyle(isToday ? Color.black.opacity(0.6) : Theme.Palette.textTertiary)
                            Text(CalendarView.format(date, "d"))
                                .font(.system(.title3, weight: .semibold).monospacedDigit())
                                .foregroundStyle(isToday ? Color.black : (hasEntries ? Color.white : Theme.Palette.textSecondary))
                            Circle()
                                .fill(isToday ? Color.black : Color.white)
                                .frame(width: 4 * Theme.scale, height: 4 * Theme.scale)
                                .opacity(hasEntries ? 1 : 0)
                        }
                        .frame(width: 46 * Theme.scale, height: 72 * Theme.scale)
                        .background {
                            let shape = RoundedRectangle(cornerRadius: 14 * Theme.scale, style: .continuous)
                            if isToday { shape.fill(.white) } else { shape.fill(Theme.Palette.surface).overlay(shape.strokeBorder(Theme.Palette.hairline)) }
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
    }
}

/// iPhone: a still beside the show, episode and badge.
private struct CalendarRow: View {
    let entry: CalendarEntry

    var body: some View {
        NavigationLink(value: Route.detail(entry.item)) {
            HStack(spacing: Theme.Space.s) {
                CalendarStill(entry: entry, width: 128)
                VStack(alignment: .leading, spacing: 3) {
                    Text(entry.item.title).font(.system(.subheadline, weight: .semibold)).lineLimit(1)
                    Text(subtitle(for: entry))
                        .font(.system(.footnote))
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    CalendarBadge(entry: entry)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.Palette.textTertiary)
            }
            .padding(Theme.Space.xs)
            .background(Theme.Palette.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).strokeBorder(Theme.Palette.hairline))
            .contentShape(Rectangle())
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { MediaContextMenu(item: entry.item) }
    }
}

/// iPad, Mac, TV and Just Aired: a wide still with the details beneath. Aired episodes play straight away.
private struct CalendarCard: View {
    let entry: CalendarEntry
    let dateLabel: String?
    @Environment(AppModel.self) private var model

    private var width: CGFloat { Platform.landscapeWidth }

    var body: some View {
        Group {
            if entry.hasAired {
                Button { Task { await model.play(entry.item, episode: entry.episode) } } label: { content }
            } else {
                NavigationLink(value: Route.detail(entry.item)) { content }
            }
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu {
            Button { model.navigate(to: .detail(entry.item)) } label: { Label("Go to Details", systemImage: "info.circle") }
            MediaContextMenu(item: entry.item)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            CalendarStill(entry: entry, width: width)
                .overlay {
                    if entry.hasAired {
                        Image(systemName: "play.fill")
                            .font(.system(size: 15 * Theme.scale, weight: .bold))
                            .frame(width: 38 * Theme.scale, height: 38 * Theme.scale)
                            .flowGlass(Circle())
                    }
                }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(entry.item.title).font(Theme.Typeface.headline).lineLimit(1)
                    Spacer(minLength: 0)
                    if let dateLabel { Text(dateLabel).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary) }
                }
                Text(subtitle(for: entry)).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                CalendarBadge(entry: entry)
            }
            .frame(width: width, alignment: .leading)
        }
    }
}

private struct CalendarStill: View {
    let entry: CalendarEntry
    let width: CGFloat
    @Environment(AppModel.self) private var model

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.poster, style: .continuous) }

    var body: some View {
        RemoteImage(url: TMDBImage.url(entry.episode?.stillPath, size: .still) ?? entry.item.smallBackdropURL ?? entry.item.posterURL,
                    maxPixel: Int(width * 2.5), fallbackTitle: entry.item.title)
            .frame(width: width, height: width * 9 / 16)
            .clipShape(shape)
            .hairline(shape)
            .overlay(alignment: .bottomTrailing) {
                if let episode = entry.episode, model.isEpisodeWatched(entry.item, episode.ref) {
                    WatchedCheck().scaleEffect(0.85).padding(6)
                }
            }
            .artworkShadow(0.4)
    }
}

private struct CalendarBadge: View {
    let entry: CalendarEntry

    var body: some View {
        if let text {
            Text(text.uppercased())
                .font(Theme.Typeface.micro).kerning(0.6)
                .foregroundStyle(tint)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(tint.opacity(0.16), in: Capsule())
                .padding(.top, 2)
        }
    }

    private var text: String? {
        guard let episode = entry.episode else { return entry.hasAired ? "Out Now" : "Release" }
        if episode.number == 1 { return episode.season == 1 ? "Series Premiere" : "Season Premiere" }
        return entry.hasAired ? "New" : nil
    }

    private var tint: Color { entry.episode == nil ? Theme.Palette.gold : (entry.isPremiere ? .pink : .white) }
}

private func subtitle(for entry: CalendarEntry) -> String {
    if let episode = entry.episode { return "S\(episode.season) · E\(episode.number)  \(episode.title)" }
    return [entry.item.year.map(String.init), entry.item.genres.first?.name].compactMap { $0 }.joined(separator: " · ")
}
