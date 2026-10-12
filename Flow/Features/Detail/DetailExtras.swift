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

/// Status, language, country, money and the companies behind a title, as a grouped list.
/// Everything factual about a title in one table at the foot of its page: the essentials (release,
/// runtime, seasons, director, rating) always, the rest (status, language, country, money, companies,
/// network) when Settings → General → About is on.
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
        let rows = rows
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>("About")
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    if index > 0 { Divider().overlay(Theme.Palette.hairline) }
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
                        Text(row.label).foregroundStyle(Theme.Palette.textSecondary)
                        Spacer(minLength: Theme.Space.m)
                        Text(row.value)
                            .foregroundStyle(.white.opacity(0.9))
                            .multilineTextAlignment(.trailing)
                    }
                    .font(Theme.Typeface.body)
                    .padding(.horizontal, Theme.Space.m)
                    .padding(.vertical, Theme.Space.s)
                    .accessibilityElement(children: .combine)
                }
            }
            .background(Theme.Palette.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous))
            .hairline(RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous))
            .frame(maxWidth: 760 * Theme.scale, alignment: .leading)
            .padding(.horizontal, Theme.Space.gutter)
        }
    }
}

/// What viewers on TMDB and Trakt wrote, as cards that open to the full text.
struct ReviewsSection: View {
    let reviews: [Review]
    let textSize: DetailTextSize
    @State private var selected: Review?

    private var cardWidth: CGFloat { 320 * Theme.scale }

    private var sources: String {
        Array(Set(reviews.map(\.source.name))).sorted().joined(separator: " & ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("Reviews").font(Theme.Typeface.sectionTitle).displayTracking()
                Text("· From \(sources)").font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Theme.Space.gutter)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
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
                .font(Theme.Typeface.body)
                .foregroundStyle(Theme.Palette.textSecondary)
                .lineLimit(5)
                .lineSpacing(2)
                .multilineTextAlignment(.leading)
        }
        .padding(Theme.Space.m)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Theme.Palette.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .hairline(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }
}

/// Initial, author, source and date, with the score and spoiler tags beside them.
private struct ReviewByline: View {
    let review: Review

    var body: some View {
        HStack(spacing: Theme.Space.s) {
            Text(String(review.author.prefix(1)).uppercased())
                .font(.system(.subheadline, weight: .bold))
                .frame(width: 36 * Theme.scale, height: 36 * Theme.scale)
                .background(Theme.Palette.surfaceStrong, in: Circle())
                // The author's name follows; their initial on its own says nothing.
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(review.author).font(.system(.subheadline, weight: .semibold)).lineLimit(1)
                Text(meta).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary).lineLimit(1)
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 4) {
                if let rating = review.rating {
                    Text("\u{2605} \(rating)/10")
                        .font(Theme.Typeface.micro)
                        .foregroundStyle(Theme.Palette.gold)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Theme.Palette.surfaceStrong, in: Capsule())
                        .accessibilityLabel("Rated \(rating) out of 10")
                }
                if review.spoiler {
                    Text("Spoilers")
                        .font(Theme.Typeface.micro)
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.orange.opacity(0.18), in: Capsule())
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
                    Text(review.text)
                        .font(Theme.Typeface.body)
                        .lineSpacing(3)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.Space.m)
            }
            .navigationTitle("Review")
            .inlineNavigationTitle()
            .sheetDismissButton("Close") { dismiss() }
        }
        .presentationDetents([.medium, .large])
        .preferredColorScheme(.dark)
    }
}
