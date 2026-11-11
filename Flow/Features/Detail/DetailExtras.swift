import SwiftUI
import FlowKit

extension DetailTextSize {
    /// nil leaves the system's own size alone.
    var dynamicTypeSize: DynamicTypeSize? {
        switch self {
        case .small: return .small
        case .standard: return nil
        case .large: return .xLarge
        case .extraLarge: return .xxxLarge
        }
    }
}

extension View {
    /// Scales a detail screen's text without touching the rest of the app.
    @ViewBuilder
    func detailTextSize(_ size: DetailTextSize) -> some View {
        if let type = size.dynamicTypeSize {
            dynamicTypeSize(type)
        } else {
            self
        }
    }
}

extension AppModel {
    /// With Episode Spoilers off, an aired episode's still and synopsis stay hidden until it's watched.
    func hidesSpoilers(_ show: MediaItem, _ episode: Episode) -> Bool {
        !settings.general.showEpisodeSpoilers
            && (episode.airDate ?? .distantFuture) <= Date()
            && !isEpisodeWatched(show, episode.ref)
    }
}


// MARK: - Index pieces shared by the title, person and collection pages

extension Theme.Typeface {
    /// A small muted caption above a value: mono semibold, uppercase when set with `detailCaps()`.
    static var detailKey: Font { custom(Theme.Face.monoSemiBold, 12, .caption) }
    /// A big condensed numeral: a rating, an episode number, a resolution.
    static func detailNumeral(_ size: CGFloat) -> Font { custom(Theme.Face.condensed, size, .title).monospacedDigit() }
}

extension View {
    /// Mono capitals with the website's tracking (.08em by default) at a font size of `size`.
    func detailCaps(_ em: CGFloat = 0.08, size: CGFloat = 12) -> some View {
        textCase(.uppercase).tracking(em * size * Theme.scale)
    }
}

/// True while the cell it is in is hovered, focused or pressed: text inside draws on-blue, because the cell's fill is blue.
private struct CellLitKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    var cellLit: Bool {
        get { self[CellLitKey.self] }
        set { self[CellLitKey.self] = newValue }
    }
}

/// A cell of a ruled grid, or a row of a ruled list: no chrome of its own (the grid draws the lines), and the whole cell
/// turns blue while hovered, focused (Apple TV) or pressed. Its content reads `cellLit` to swap muted and red text for
/// on-blue, since neither has contrast on the blue.
struct RuledCellStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        RuledCellBody(configuration: configuration)
    }
}

private struct RuledCellBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isFocused) private var focused
    @State private var hovering = false

    var body: some View {
        let lit = focused || hovering || configuration.isPressed
        configuration.label
            .environment(\.cellLit, lit)
            .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.fg)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(lit ? Theme.Palette.blue : Color.clear)
            .contentShape(Rectangle())
            .animation(Theme.Motion.hover, value: lit)
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

/// One cell of the list-actions row (Watchlist, Watched, Favourite, ...): bordered, sharing its borders with its
/// neighbours; the one that is on is inverted ink and carries a check, so "on" is never told by colour alone.
struct ListActionStyle: ButtonStyle {
    var on = false

    func makeBody(configuration: Configuration) -> some View {
        ListActionBody(configuration: configuration, on: on)
    }
}

private struct ListActionBody: View {
    let configuration: ButtonStyleConfiguration
    let on: Bool
    @Environment(\.isFocused) private var focused
    @Environment(\.isEnabled) private var enabled
    @State private var hovering = false

    var body: some View {
        let lit = enabled && (focused || hovering)
        let fill = lit ? Theme.Palette.blue : on ? Theme.Palette.fg : Theme.Palette.bg
        let ink = lit ? Theme.Palette.onBlue : on ? Theme.Palette.bg : Theme.Palette.fg
        configuration.label
            .font(Theme.Typeface.control)
            .controlText()
            .foregroundStyle(enabled ? ink : Theme.Palette.faint)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, Theme.Space.xs)
            .frame(maxWidth: .infinity, minHeight: 44 * Theme.scale)
            .background(fill)
            .overlay(Rectangle().strokeBorder(lit ? Theme.Palette.blue : Theme.Palette.fg, lineWidth: Theme.Rule.heavy))
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.7 : 1)
            .animation(Theme.Motion.hover, value: lit)
            .modifier(FocusLift(scale: 1.04))
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

/// The page's name, set as the website sets it: giant, uppercase, Archivo, tight. A longer title steps down, and one
/// with a long word steps down until the word fits on a line, so a word is never broken in two.
struct GiantTitle: View {
    let text: String
    /// The page's width, once it is known.
    var width: CGFloat = 0

    /// In points as drawn (Apple TV's scale included).
    private var pixels: CGFloat {
        let base = Theme.Typeface.giantSize * Theme.scale
        let page = width > 0 ? width : (Platform.isPhone ? 390 : 800)
        let usable = page - 2 * Theme.Space.gutter
        let longest = CGFloat(text.split(separator: " ").map(\.count).max() ?? 1)
        let count = text.count
        let byLength: CGFloat = count <= 14 ? 1 : count <= 24 ? 0.8 : 0.62
        // Archivo capitals run about 0.7 em wide.
        let byWord = usable / (0.7 * max(longest, 1))
        return max(base * 0.4, min(base * byLength, byWord))
    }

    var body: some View {
        let px = pixels
        Text(text)
            .font(Theme.Typeface.custom(Theme.Face.archivo, px / Theme.scale, .largeTitle))
            .textCase(.uppercase)
            .tracking(-0.03 * px)
            // The website sets it at 0.84 line height; a negative spacing pulls wrapped lines together.
            .lineSpacing(-0.14 * px)
            .foregroundStyle(Theme.Palette.fg)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The facts under a title as one mono line of capitals, a thin rule between the parts.
struct TitleFactsLine: View {
    let parts: [String]

    var body: some View {
        WrappingRow(spacing: Theme.Space.s, lineSpacing: Theme.Space.xxs) {
            ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
                HStack(spacing: Theme.Space.s) {
                    Text(part)
                        .font(Theme.Typeface.control)
                        .detailCaps(0.08, size: 13)
                        .foregroundStyle(Theme.Palette.fg)
                        .lineLimit(1)
                    if index < parts.count - 1 {
                        Rectangle().fill(Theme.Palette.rule).frame(width: Theme.Rule.thin, height: 14 * Theme.scale)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(parts.joined(separator: ", "))
    }
}

/// A page head: the giant title, then its facts line between a thin rule and the 2px rule that closes the head. The
/// rules run edge to edge; the text keeps the page's margin.
struct PageHead: View {
    let title: String
    var facts: [String] = []
    var width: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GiantTitle(text: title, width: width)
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.bottom, Theme.Space.m)
            if !facts.isEmpty {
                RuleLine(thin: true)
                TitleFactsLine(parts: facts)
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.vertical, Theme.Space.s)
            }
            RuleLine()
        }
    }
}

/// A section: a 2px rule, a red mono label (with a muted note at its right), then its content. A row that scrolls
/// sideways takes `paddedContent: false` and sets its own margin.
struct RuledSection<Content: View>: View {
    let title: String
    var note: String?
    var paddedContent = true
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                RuleLine()
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
                    SectionLabel(title)
                    Spacer(minLength: 0)
                    if let note {
                        Text(note)
                            .font(Theme.Typeface.caption)
                            .detailCaps()
                            .foregroundStyle(Theme.Palette.muted)
                            .lineLimit(1)
                    }
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            if paddedContent {
                content.padding(.horizontal, Theme.Space.gutter)
            } else {
                content
            }
        }
    }
}

/// Cells in rows that share 1px rules. `framed` draws the grid's own left and right edges under a thin top rule (About,
/// Cast); unframed leaves the sides open under the 2px rule (the ratings). Each cell gets the full height of its row
/// and its column's number.
struct RuledGrid<Item, Cell: View>: View {
    let items: [Item]
    let columns: Int
    var framed = true
    let cell: (Item, Int) -> Cell

    init(items: [Item], columns: Int, framed: Bool = true, @ViewBuilder cell: @escaping (Item, Int) -> Cell) {
        self.items = items
        self.columns = max(columns, 1)
        self.framed = framed
        self.cell = cell
    }

    private var rows: [[Item]] {
        stride(from: 0, to: items.count, by: columns).map { Array(items[$0..<min($0 + columns, items.count)]) }
    }

    var body: some View {
        let rows = rows
        VStack(spacing: 0) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: 0) {
                    ForEach(0..<columns, id: \.self) { c in
                        if c < rows[r].count {
                            cell(rows[r][c], c)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                                .overlay(alignment: .leading) {
                                    // Between cells (and, when framed, at the grid's left edge).
                                    if c > 0 || framed { Rectangle().fill(Theme.Palette.rule).frame(width: Theme.Rule.thin) }
                                }
                        } else {
                            Color.clear.frame(maxWidth: .infinity)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .ruledRow()
            }
        }
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.Palette.rule).frame(height: framed ? Theme.Rule.thin : Theme.Rule.heavy)
        }
        .overlay(alignment: .trailing) {
            if framed { Rectangle().fill(Theme.Palette.rule).frame(width: Theme.Rule.thin) }
        }
    }
}

extension Platform {
    /// How many cells a ruled grid of ordinary width has per row: a phone is too narrow for three names side by
    /// side, so it gets two; everything wider three.
    static var ruledColumns: Int { isPhone ? 2 : 3 }
}

/// Everything factual about a title in one ruled grid at the foot of its page: the essentials (release, runtime,
/// seasons, director, rating) always, the rest (status, language, country, money, companies, network) when
/// Settings → General → About is on.
struct AboutSection: View {
    let detail: MediaDetail
    var essentialsOnly = false
    var airDatesInLocalTimeZone = true

    private var rows: [(label: String, value: String)] {
        var rows: [(label: String, value: String)] = []
        let item = detail.item
        if let date = item.releaseDate {
            rows.append((item.type == .movie ? "Released" : "First Aired", AirDateFormatting.string(for: date, localTimeZone: airDatesInLocalTimeZone)))
        }
        if let runtime = item.runtimeMinutes, runtime > 0 { rows.append(("Runtime", TimeFormat.runtime(runtime))) }
        if let seasons = detail.numberOfSeasons { rows.append(("Seasons", String(seasons))) }
        let directors = detail.crew.filter { $0.role == "Director" || $0.role == "Creator" }.map(\.name)
        if !directors.isEmpty { rows.append((item.type == .movie ? (directors.count > 1 ? "Directors" : "Director") : "Created By", directors.joined(separator: ", "))) }
        if let certification = item.certification, !certification.isEmpty { rows.append(("Rated", certification)) }
        guard !essentialsOnly else { return rows }
        if let status = detail.item.status, !status.isEmpty { rows.append(("Status", Self.statusLabel(status))) }
        if let lang = detail.item.originalLanguage, !lang.isEmpty {
            rows.append(("Original Language", Locale.current.localizedString(forLanguageCode: lang) ?? lang))
        }
        let countries = (detail.originCountries ?? []).map { Locale.current.localizedString(forRegionCode: $0) ?? $0 }
        if !countries.isEmpty { rows.append((countries.count > 1 ? "Countries" : "Country", countries.joined(separator: ", "))) }
        if let budget = detail.budget, budget > 0 { rows.append(("Budget", CompactMoney.string(budget))) }
        if let revenue = detail.revenue, revenue > 0 { rows.append(("Revenue", CompactMoney.string(revenue))) }
        if let companies = detail.productionCompanies, !companies.isEmpty { rows.append(("Production", companies.joined(separator: ", "))) }
        if !detail.networks.isEmpty { rows.append((detail.networks.count > 1 ? "Networks" : "Network", detail.networks.joined(separator: ", "))) }
        return rows
    }

    var isEmpty: Bool { rows.isEmpty }

    /// TMDb says "Returning Series"; the row's label already says it's a show.
    static func statusLabel(_ status: String) -> String {
        status == "Returning Series" ? "Returning" : status
    }

    var body: some View {
        RuledSection(title: "About") {
            RuledGrid(items: rows, columns: Platform.ruledColumns) { row, _ in
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.label)
                        .font(Theme.Typeface.detailKey)
                        .detailCaps(0.08)
                        .foregroundStyle(Theme.Palette.muted)
                    Text(row.value)
                        .font(Theme.Typeface.body)
                        .foregroundStyle(Theme.Palette.fg)
                        .multilineTextAlignment(.leading)
                }
                .padding(.horizontal, Theme.Space.m)
                .padding(.vertical, Theme.Space.s)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// What viewers on TMDB and Trakt wrote, as ruled cards that open to the full text.
struct ReviewsSection: View {
    let reviews: [Review]
    let textSize: DetailTextSize
    @State private var selected: Review?

    private var cardWidth: CGFloat { 320 * Theme.scale }

    private var sources: String {
        Array(Set(reviews.map(\.source.name))).sorted().joined(separator: " & ")
    }

    var body: some View {
        RuledSection(title: "Reviews", note: "From \(sources)", paddedContent: false) {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : Theme.Space.s) {
                    ForEach(reviews) { review in
                        Button { selected = review } label: { ReviewCard(review: review).frame(width: cardWidth) }
                            .buttonStyle(CardButtonStyle())
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Platform.isTV ? 24 : 2)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollClipDisabled()
            .pagingArrows(ids: reviews.map(\.id), itemWidth: cardWidth + 14)
        }
        .sheet(item: $selected) { review in
            ReviewSheet(review: review).detailTextSize(textSize)
        }
    }
}

struct ReviewCard: View {
    let review: Review

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            ReviewByline(review: review)
            Text(review.text)
                .font(Theme.Typeface.reading)
                .foregroundStyle(Theme.Palette.fg)
                .lineLimit(5)
                .lineSpacing(3)
                .multilineTextAlignment(.leading)
        }
        .padding(Theme.Space.m)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Theme.Palette.bg)
        .ruleFrame()
        .contentShape(Rectangle())
    }
}

/// Initial, author, source and date, with the score and spoiler tags beside them.
private struct ReviewByline: View {
    let review: Review

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s) {
            Text(String(review.author.prefix(1)).uppercased())
                .font(Theme.Typeface.heading)
                .foregroundStyle(Theme.Palette.red)
                .frame(width: 36 * Theme.scale, height: 36 * Theme.scale)
                .overlay(Rectangle().strokeBorder(Theme.Palette.rule, lineWidth: Theme.Rule.thin))
                // The author's name follows; their initial on its own says nothing.
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(review.author)
                    .font(Theme.Typeface.custom(Theme.Face.condensed, 17, .headline))
                    .textCase(.uppercase)
                    .lineLimit(1)
                Text(meta)
                    .font(Theme.Typeface.caption)
                    .detailCaps()
                    .foregroundStyle(Theme.Palette.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 4) {
                if let rating = review.rating {
                    Text("\(rating)/10")
                        .font(Theme.Typeface.detailNumeral(20))
                        .foregroundStyle(Theme.Palette.red)
                        .accessibilityLabel("Rated \(rating) out of 10")
                }
                if review.spoiler {
                    Text("Spoilers")
                        .font(Theme.Typeface.micro)
                        .detailCaps(0.08, size: 11)
                        .foregroundStyle(Theme.Palette.warn)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .overlay(Rectangle().strokeBorder(Theme.Palette.warn, lineWidth: Theme.Rule.thin))
                }
            }
        }
    }

    private var meta: String {
        guard let date = review.date else { return review.source.name }
        return "\(review.source.name) · \(date.formatted(date: .abbreviated, time: .omitted))"
    }
}

struct ReviewSheet: View {
    let review: Review
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    ReviewByline(review: review)
                    RuleLine()
                    Text(review.text)
                        .font(Theme.Typeface.reading)
                        .lineSpacing(5)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.Space.m)
            }
            .background(Theme.Palette.bg)
            .flowPageTitle("Review")
            .inlineNavigationTitle()
            .sheetDismissButton("Close") { dismiss() }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The scores chosen in Settings → Metadata → Ratings Shown, in that order: each a big red condensed numeral with the
/// source's name under it in mono, in a ruled row of cells. A custom icon pack (Settings) still replaces the name.
struct RatingsRow: View {
    let ratings: Ratings
    /// The title, so a score can open its site's page when Tap a Rating is on.
    var item: MediaItem?
    @Environment(AppModel.self) private var model
    @State private var showAll = false

    private var metadata: MetadataSettings { model.settings.metadata }
    /// Only while a pack URL is set, so clearing the field brings the plain names straight back.
    private var iconPack: RatingIconPack? { metadata.ratingIconPackURL == nil ? nil : model.ratingIconPack }

    /// The sources with a score for this title, in the order chosen.
    private var shown: [RatingSource] { metadata.ratingsShown.filter { text(for: $0) != nil } }
    /// Four is as many as a phone holds in a row, and on an iPad a fifth or sixth would wrap and leave one score
    /// alone on a second line, so the rest sit behind More on both.
    private var limited: Bool { Platform.isPhone || Platform.isPad }
    private var visible: [RatingSource] { limited && !showAll ? Array(shown.prefix(4)) : shown }
    private var columns: Int { limited ? 4 : 5 }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            RuledGrid(items: visible, columns: columns, framed: false) { source, column in
                score(source, column: column)
            }
            if limited && !showAll && shown.count > 4 {
                Button("More Ratings") { withAnimation(Theme.Motion.enter) { showAll = true } }
                    .buttonStyle(QuietButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: metadata.ratingIconPackURL) { await model.loadRatingIconPack() }
    }

    @ViewBuilder
    private func score(_ source: RatingSource, column: Int) -> some View {
        if let value = text(for: source) {
            if let link = reviewsURL(for: source) {
                Button { model.openExternally(link) } label: { RatingCell(source: source, value: value, column: column, icon: iconPack?[source]) }
                    .buttonStyle(RuledCellStyle())
                    .accessibilityHint("Opens \(source.title)")
            } else {
                RatingCell(source: source, value: value, column: column, icon: iconPack?[source])
            }
        }
    }

    /// Nil when the source has no score for this title (MyAnimeList never does: Marquee has no score source for it).
    private func text(for source: RatingSource) -> String? {
        switch source {
        case .imdb: return ratings.imdb.map { String(format: "%.1f", $0) }
        case .tomatometer: return ratings.rottenTomatoes.map { "\($0)%" }
        case .popcornmeter: return ratings.popcorn.map { "\($0)%" }
        case .metacritic: return ratings.metacritic.map { "\($0)" }
        case .tmdb: return ratings.tmdb.flatMap { $0 > 0 ? String(format: "%.1f", $0) : nil }
        case .letterboxd: return ratings.letterboxd.map { String(format: "%.1f", $0) }
        case .trakt: return ratings.trakt.map { "\($0)%" }
        case .mal: return nil
        }
    }

    /// Apple TV can't open web pages.
    private func reviewsURL(for source: RatingSource) -> URL? {
        #if os(tvOS)
        return nil
        #else
        guard metadata.tapRatingOpensReviews, let item else { return nil }
        return RatingLinks.url(for: source, item: item)
        #endif
    }
}

private struct RatingCell: View {
    let source: RatingSource
    let value: String
    let column: Int
    let icon: URL?
    @Environment(\.cellLit) private var lit

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(Theme.Typeface.detailNumeral(34))
                .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.red)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let icon {
                RemoteImage(url: icon, contentMode: .fit, maxPixel: 96)
                    .frame(width: 24 * Theme.scale, height: 14 * Theme.scale, alignment: .leading)
            } else {
                Text(source.title)
                    .font(Theme.Typeface.micro)
                    .detailCaps(0.06, size: 11)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .foregroundStyle(lit ? Theme.Palette.onBlue : Theme.Palette.muted)
            }
        }
        .padding(.leading, column == 0 ? 0 : Theme.Space.s)
        .padding(.trailing, Theme.Space.xs)
        .padding(.vertical, Theme.Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(source.spokenScore(value))
    }
}

extension View {
    /// A light tap when a toggle flips (iOS 17+).
    @ViewBuilder
    func sensoryFeedbackIfAvailable<T: Equatable>(_ trigger: T) -> some View {
        #if os(iOS)
        sensoryFeedback(.selection, trigger: trigger)
        #else
        self
        #endif
    }
}

/// The streaming services, rentals and stores carrying the title in the viewer's region, as a ruled grid: a row for each
/// way to watch, a bordered logo for each service.
struct WhereToWatch: View {
    let availability: Availability
    @Environment(AppModel.self) private var model

    private var rows: [(kind: Availability.Kind, providers: [WatchProvider])] {
        let offers = availability.offers
        return [Availability.Kind.stream, .free, .rent, .buy].compactMap { kind in
            let list = offers.filter { $0.kind == kind }.map(\.provider)
            return list.isEmpty ? nil : (kind, list)
        }
    }

    var body: some View {
        RuledSection(title: "Where to Watch", note: "Data from JustWatch") {
            VStack(spacing: 0) {
                ForEach(rows, id: \.kind) { row in
                    Group {
                        if Platform.isPhone {
                            VStack(alignment: .leading, spacing: 0) {
                                kindLabel(row.kind).padding(.vertical, Theme.Space.s)
                                RuleLine(thin: true)
                                services(row.providers, kind: row.kind)
                            }
                        } else {
                            HStack(alignment: .top, spacing: 0) {
                                kindLabel(row.kind)
                                    .frame(width: 168 * Theme.scale, alignment: .leading)
                                    .frame(maxHeight: .infinity, alignment: .center)
                                Rectangle().fill(Theme.Palette.rule).frame(width: Theme.Rule.thin)
                                services(row.providers, kind: row.kind)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .ruledRow()
                }
            }
            .overlay(alignment: .top) { Rectangle().fill(Theme.Palette.rule).frame(height: Theme.Rule.thin) }
        }
    }

    private func kindLabel(_ kind: Availability.Kind) -> some View {
        Text(kind.label)
            .font(Theme.Typeface.control)
            .detailCaps(0.08, size: 13)
            .foregroundStyle(Theme.Palette.fg)
    }

    private func services(_ providers: [WatchProvider], kind: Availability.Kind) -> some View {
        WrappingRow(spacing: -Theme.Rule.thin, lineSpacing: -Theme.Rule.thin) {
            ForEach(providers, id: \.providerId) { provider in tile(provider, kind: kind) }
        }
        .padding(Platform.isTV ? Theme.Space.s : 0)
    }

    private func tile(_ provider: WatchProvider, kind: Availability.Kind) -> some View {
        Button {
            #if !os(tvOS)
            if let link = availability.link { model.openExternally(link) }
            #endif
        } label: {
            RemoteImage(url: TMDBImage.url(provider.logoPath, size: .posterSmall), maxPixel: 160, fallbackTitle: provider.providerName)
                .frame(width: 64 * Theme.scale, height: 64 * Theme.scale)
                .clipped()
                .overlay(Rectangle().strokeBorder(Theme.Palette.rule, lineWidth: Theme.Rule.thin))
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityLabel("\(provider.providerName), \(kind.label)")
    }
}
