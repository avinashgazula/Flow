import SwiftUI
import Charts
import FlowKit

/// "Your Year in Flow": watching statistics computed from the tracker's history.
struct StatsView: View {
    /// How much history to pull; a Trakt account can hold far more than anyone's stats need.
    private static let historyLimit = 2000
    /// Titles to look up for runtimes and genres, most recent first. Anything beyond uses default runtimes.
    private static let hydrateLimit = 300
    /// Titles looked up for the first, quick pass.
    private static let quickHydrateLimit = 40

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var period: StatsPeriod = .thisYear
    @State private var entries: [HistoryEntry] = []
    @State private var items: [MediaKey: MediaItem] = [:]
    @State private var stats: WatchStats?
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.section) {
                periodPicker
                if loading {
                    placeholder
                } else if entries.isEmpty {
                    ContentUnavailableView("No History Yet", systemImage: "chart.bar",
                                           description: Text("Watch something, or connect Trakt or Simkl in Settings → Account, and your stats appear here."))
                        .padding(.top, Theme.Space.xxl)
                } else if let stats, !stats.isEmpty {
                    content(stats)
                } else {
                    ContentUnavailableView("Nothing Watched", systemImage: "chart.bar",
                                           description: Text("There's no history for \(period.title.lowercased()). Try another period."))
                        .padding(.top, Theme.Space.xxl)
                }
            }
            .padding(.vertical, Theme.Space.m)
            .padding(.bottom, Theme.Space.xl)
        }
        .scrollIndicators(.hidden)
        .flowPageTitle("Stats", inset: Theme.Space.gutter)
        .task(id: model.contentVersion) { await load() }
        .onChange(of: period) { _, _ in
            withAnimation(Theme.Motion.gentle) { recompute() }
        }
    }

    // MARK: Loading

    private func load() async {
        // The history the library already synced paints first, from a handful of lookups. The full pull
        // (up to 2000 plays over the network, then 300 title lookups) refines it a moment later, instead
        // of the page sitting on a placeholder until all of that finishes.
        if entries.isEmpty, !model.history.isEmpty {
            await show(model.history, hydrating: Self.quickHydrateLimit)
        }
        let fetched = (try? await model.tracker.history(limit: Self.historyLimit)) ?? []
        await show(fetched.isEmpty ? model.history : fetched, hydrating: Self.hydrateLimit)
    }

    private func show(_ history: [HistoryEntry], hydrating limit: Int) async {
        guard !Task.isCancelled else { return }
        var seen = Set<MediaKey>()
        let keys = history.map(\.key).filter { seen.insert($0).inserted }
        let hydrated = await model.hydrate(keys, limit: limit)
        // Cancelled (the library refreshed or the page went away): partial, and a newer task is coming.
        guard !Task.isCancelled else { return }
        entries = history
        items = Dictionary(hydrated.compactMap { item in item.key.map { ($0, item) } }, uniquingKeysWith: { a, _ in a })
        recompute()
        loading = false
    }

    private func recompute() {
        stats = WatchStats(period: period, entries: entries, items: items)
    }

    // MARK: Sections

    @ViewBuilder private var periodPicker: some View {
        #if os(tvOS)
        HStack(spacing: Theme.Space.s) {
            ForEach(StatsPeriod.allCases) { option in
                ActionChip(title: option.title, systemImage: Self.icon(for: option), active: period == option) { period = option }
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.vertical, Theme.Space.xs)
        #else
        Picker("Period", selection: $period) {
            ForEach(StatsPeriod.allCases) { option in Text(option.title).tag(option) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal, Theme.Space.gutter)
        #endif
    }

    private static func icon(for period: StatsPeriod) -> String {
        switch period {
        case .thisYear: return "calendar"
        case .last30Days: return "calendar.badge.clock"
        case .allTime: return "infinity"
        }
    }

    private func content(_ stats: WatchStats) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.section) {
            hero(stats)
            histogram(stats)
            if !stats.topGenres.isEmpty { genres(stats) }
            mostWatched(stats)
            habits(stats)
        }
    }

    private func hero(_ stats: WatchStats) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                Text(Self.lead(for: period))
                    .font(Theme.Typeface.body)
                    .foregroundStyle(Theme.Palette.textSecondary)
                Text(WatchStats.durationText(minutes: stats.totalMinutes))
                    .font(Theme.Typeface.display)
                    .displayTracking()
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .contentTransition(.numericText())
            }
            .accessibilityElement(children: .combine)
            tiles {
                StatTile(value: stats.filmsWatched.formatted(), label: "Films")
                StatTile(value: stats.episodesWatched.formatted(), label: "Episodes")
                StatTile(value: stats.showsWatched.formatted(), label: "Shows")
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
    }

    private func histogram(_ stats: WatchStats) -> some View {
        let unit = Self.chartUnit(stats.histogramGranularity)
        let crowded = stats.histogram.count > 12
        return VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>(Self.histogramTitle(stats.histogramGranularity))
            Chart(stats.histogram) { bucket in
                BarMark(x: .value("Date", bucket.start, unit: unit), y: .value("Hours", Double(bucket.minutes) / 60))
                    .foregroundStyle(bucket.isCurrent ? Color.accentColor : Color.white.opacity(0.35))
                    .cornerRadius(4)
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: unit, count: crowded ? 3 : 1)) { value in
                    AxisValueLabel(centered: true) {
                        if let date = value.as(Date.self) { Text(date, format: Self.axisFormat(stats.histogramGranularity, crowded: crowded)) }
                    }
                    .foregroundStyle(Theme.Palette.textSecondary)
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { value in
                    AxisGridLine().foregroundStyle(Theme.Palette.hairline)
                    AxisValueLabel {
                        if let hours = value.as(Double.self) { Text("\(Int(hours))h") }
                    }
                    .foregroundStyle(Theme.Palette.textTertiary)
                }
            }
            .frame(height: 180 * Theme.scale)
            .padding(Theme.Space.m)
            .background(Theme.Palette.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .padding(.horizontal, Theme.Space.gutter)
            .statFocus()
        }
    }

    private static func chartUnit(_ granularity: WatchStats.Granularity) -> Calendar.Component {
        switch granularity {
        case .week: return .weekOfYear
        case .month: return .month
        case .year: return .year
        }
    }

    private static func histogramTitle(_ granularity: WatchStats.Granularity) -> String {
        switch granularity {
        case .week: return "Hours by Week"
        case .month: return "Hours by Month"
        case .year: return "Hours by Year"
        }
    }

    private static func axisFormat(_ granularity: WatchStats.Granularity, crowded: Bool) -> Date.FormatStyle {
        switch granularity {
        case .week: return .dateTime.month(.abbreviated).day()
        case .month: return crowded ? .dateTime.month(.abbreviated) : .dateTime.month(.narrow)
        case .year: return .dateTime.year()
        }
    }

    private func genres(_ stats: WatchStats) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>("Top Genres")
            VStack(spacing: Theme.Space.m) {
                ForEach(Array(stats.topGenres.enumerated()), id: \.element.id) { index, genre in
                    GenreBar(genre: genre, opacity: 0.9 - 0.14 * Double(index))
                }
            }
            .padding(Theme.Space.m)
            .background(Theme.Palette.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .padding(.horizontal, Theme.Space.gutter)
            .statFocus()
        }
    }

    @ViewBuilder
    private func mostWatched(_ stats: WatchStats) -> some View {
        let shows = stats.mostWatchedShows.compactMap { count in
            items[count.key].map { RankedShow(item: $0, episodes: count.episodes) }
        }
        if !shows.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHeader<Route>("Most Watched")
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
                        ForEach(shows) { show in
                            VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                                PosterFilmCard(item: show.item, context: "stats")
                                Text(show.episodes == 1 ? "1 episode" : "\(show.episodes) episodes")
                                    .font(Theme.Typeface.caption)
                                    .foregroundStyle(Theme.Palette.textSecondary)
                            }
                            .frame(width: Platform.posterWidth, alignment: .leading)
                        }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.vertical, Platform.isTV ? 36 : 6)
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .scrollClipDisabled()
                .pagingArrows(ids: shows.map(\.id), itemWidth: Platform.posterWidth + 14)
            }
        }
    }

    private func habits(_ stats: WatchStats) -> some View {
        tiles {
            StatTile(value: Self.days(stats.longestStreak), label: "Longest Streak", detail: streakRange(stats))
            StatTile(value: Self.weekdayName(stats.busiestWeekday), label: "Favourite Day", detail: "Most watch time")
        }
        .padding(.horizontal, Theme.Space.gutter)
    }

    private func streakRange(_ stats: WatchStats) -> String? {
        guard let start = stats.longestStreakStart, let end = stats.longestStreakEnd, stats.longestStreak > 1 else { return nil }
        let format: Date.FormatStyle = period == .allTime ? .dateTime.month(.abbreviated).day().year() : .dateTime.month(.abbreviated).day()
        return "\(start.formatted(format)) – \(end.formatted(format))"
    }

    private static func lead(for period: StatsPeriod) -> String {
        switch period {
        case .thisYear: return "This year you've watched"
        case .last30Days: return "In the last 30 days you've watched"
        case .allTime: return "In total you've watched"
        }
    }

    private static func days(_ count: Int) -> String { count == 1 ? "1 day" : "\(count) days" }

    private static func weekdayName(_ weekday: Int?) -> String {
        let symbols = Calendar.current.weekdaySymbols
        guard let weekday, symbols.indices.contains(weekday - 1) else { return "–" }
        return symbols[weekday - 1]
    }

    /// A row of tiles; stacked at accessibility text sizes, where three across would truncate.
    private func tiles<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: Theme.Space.s))
            : AnyLayout(HStackLayout(spacing: Theme.Space.s))
        return layout { content() }
    }

    // MARK: Loading placeholder

    private var placeholder: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.Palette.surface).frame(width: 260 * Theme.scale, height: 44 * Theme.scale)
            HStack(spacing: Theme.Space.s) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.Palette.surface).frame(height: 84 * Theme.scale)
                }
            }
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.Palette.surface).frame(height: 230 * Theme.scale)
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.Palette.surface).frame(height: 200 * Theme.scale)
        }
        .padding(.horizontal, Theme.Space.gutter)
        .shimmering()
        .accessibilityHidden(true)
    }
}

private struct RankedShow: Identifiable {
    let item: MediaItem
    let episodes: Int
    var id: String { item.id }
}

/// One headline number on a glass tile.
private struct StatTile: View {
    let value: String
    let label: String
    var detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
            Text(label)
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.textSecondary)
                .lineLimit(1)
            Text(value)
                .font(Theme.Typeface.title)
                .displayTracking()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
            if let detail {
                Text(detail)
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.textTertiary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Space.m)
        .background(Theme.Palette.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .accessibilityElement(children: .combine)
        .statFocus()
    }
}

/// A genre's name, its share as a percentage, and a bar.
private struct GenreBar: View {
    let genre: WatchStats.GenreShare
    /// Higher-ranked genres are brighter.
    let opacity: Double

    private var percent: String { genre.share.formatted(.percent.precision(.fractionLength(0))) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(genre.name).font(Theme.Typeface.headline).lineLimit(1)
                Spacer(minLength: Theme.Space.s)
                Text(percent).font(Theme.Typeface.body).monospacedDigit().foregroundStyle(Theme.Palette.textSecondary)
            }
            Capsule()
                .fill(Theme.Palette.surfaceStrong)
                .frame(height: 8 * Theme.scale)
                .overlay(alignment: .leading) {
                    GeometryReader { proxy in
                        Capsule()
                            .fill(Color.white.opacity(opacity))
                            .frame(width: max(8 * Theme.scale, proxy.size.width * min(1, genre.share)))
                    }
                }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(genre.name), \(percent)")
    }
}

private extension View {
    /// Apple TV scrolls by moving focus, so content that isn't focusable would be skipped past; the cards take focus and lift gently.
    @ViewBuilder func statFocus() -> some View {
        #if os(tvOS)
        modifier(StatFocusLift()).focusable()
        #else
        self
        #endif
    }
}

#if os(tvOS)
private struct StatFocusLift: ViewModifier {
    @Environment(\.isFocused) private var focused

    func body(content: Content) -> some View {
        content
            .scaleEffect(focused ? 1.03 : 1)
            .shadow(color: .black.opacity(focused ? 0.45 : 0), radius: 20, y: 12)
            .animation(Theme.Motion.snappy, value: focused)
    }
}
#endif
