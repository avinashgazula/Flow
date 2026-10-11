import SwiftUI
import FlowKit

/// Gathers sources from every provider in parallel and lists them in ranked order.
struct SourcePickerView: View {
    let request: PlaybackRequest
    var forDownload = false
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var raw: [StreamSource] = []
    @State private var pending: [String: String] = [:]
    @State private var failures: [String: String] = [:]
    @State private var finished = false
    @State private var reloadToken = 0
    @State private var autoPlayed = false

    private var ranked: [StreamSource] {
        SourceRanker.rank(raw, settings: model.settings.sources, resolutionCap: model.resolutionCap, decodesAV1: Platform.decodesAV1,
                          decodesLosslessAudio: MatroskaRemuxer.audioDecoders != nil, prefersHDR: model.settings.playback.preferHDR,
                          preferredAudioLanguage: model.settings.playback.preferredAudioLanguage)
    }

    /// The source auto-play would start: the first playable one in ranked order. Only called out when there is a choice to make.
    private func bestMatch(in list: [StreamSource]) -> StreamSource? {
        list.count > 1 ? list.first(where: \.isPlayable) : nil
    }

    private func grouped(_ list: [StreamSource]) -> [(SourceCategory, [StreamSource])] {
        let order = model.settings.sources.categoryOrder
        let groups = Dictionary(grouping: list, by: \.category)
        return order.compactMap { cat in groups[cat].map { (cat, $0) } }
    }

    var body: some View {
        let list = ranked
        let best = bestMatch(in: list)
        let groups = grouped(list.filter { $0.id != best?.id })
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.l) {
                    header(count: list.count)
                    providerStatus
                    if list.isEmpty && !finished {
                        VStack(spacing: Theme.Space.s) {
                            ForEach(0..<3, id: \.self) { _ in SourceRowPlaceholder() }
                        }
                        .shimmering()
                        .accessibilityHidden(true)
                    } else if list.isEmpty {
                        ContentUnavailableView {
                            Label("No Sources", systemImage: "play.slash")
                        } description: {
                            Text(model.sourceProviders().isEmpty
                                 ? "Add a media server, WebDAV share, IPTV provider or stream add-on in Settings."
                                 : "None of your sources have this title yet.")
                        }
                        .padding(.top, Theme.Space.xl)
                    }
                    if let best {
                        BestMatchCard(source: best, appearance: model.settings.sources.appearance, forDownload: forDownload) { choose(best) }
                            .contextMenu { sourceMenu(best) }
                    }
                    ForEach(groups, id: \.0) { category, sources in
                        VStack(alignment: .leading, spacing: Theme.Space.s) {
                            if groups.count > 1 {
                                Text(category.displayName.uppercased())
                                    .font(Theme.Typeface.micro).kerning(1.2)
                                    .foregroundStyle(Theme.Palette.textTertiary)
                            } else if best != nil {
                                Text("More Sources".uppercased())
                                    .font(Theme.Typeface.micro).kerning(1.2)
                                    .foregroundStyle(Theme.Palette.textTertiary)
                            }
                            // By position: the demotions can leave one provider's sources in two separate runs.
                            ForEach(Array(Self.byProvider(sources).enumerated()), id: \.offset) { _, group in
                                // The provider's name once, over its sources, rather than as every row's title.
                                if providerHeaders, let first = group.first {
                                    HStack(spacing: 6) {
                                        Text(first.providerName).font(.system(.subheadline, weight: .semibold))
                                        Text("\(group.count)").font(.system(.subheadline).monospacedDigit()).foregroundStyle(Theme.Palette.textTertiary)
                                    }
                                    .padding(.top, Theme.Space.xs)
                                    .accessibilityElement(children: .combine)
                                }
                                ForEach(group) { source in
                                    Button { choose(source) } label: {
                                        SourceRow(source: source, appearance: model.settings.sources.appearance, providerShownAbove: providerHeaders)
                                    }
                                    .buttonStyle(SourceRowButtonStyle())
                                    .disabled(!source.isActionable)
                                    .contextMenu { sourceMenu(source) }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.bottom, Theme.Space.xxl)
                .animation(Theme.Motion.gentle, value: list.map(\.id))
            }
            .safeAreaInset(edge: .top, spacing: 0) { controls }
            .background(AmbientBackground(url: request.item.smallBackdropURL ?? request.item.tmdbPosterURL, intensity: 0.7))
            #if !os(macOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
            .task(id: reloadToken) { await gather() }
        }
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 640)
        #endif
    }

    /// Glass circles over the artwork instead of a navigation bar: search again at the leading edge, close at the trailing one.
    /// tvOS leaves out Close: the remote's Back button dismisses every sheet.
    private var controls: some View {
        HStack {
            Button { reloadToken += 1 } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(GlassButtonStyle(circle: true))
                .disabled(!finished)
                .opacity(finished ? 1 : 0.4)
                .accessibilityLabel("Search Again")
            Spacer()
            #if !os(tvOS)
            Button { dismiss() } label: { Image(systemName: "xmark") }
                .buttonStyle(GlassButtonStyle(circle: true))
                #if os(macOS)
                .keyboardShortcut(.cancelAction)
                #endif
                .accessibilityLabel("Close")
            #endif
        }
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.vertical, Theme.Space.xs)
    }

    private func header(count: Int) -> some View {
        HStack(alignment: .center, spacing: Theme.Space.m) {
            RemoteImage(url: request.item.posterURL, maxPixel: 300, fallbackTitle: request.item.title, fallbackURL: request.item.tmdbPosterURL)
                .frame(width: 64 * Theme.scale, height: 96 * Theme.scale)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .hairline(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(request.item.title).font(Theme.Typeface.title).displayTracking().lineLimit(2)
                if let ep = request.episode {
                    Text("\(ep.code) · \(ep.title)").font(Theme.Typeface.body).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                }
                Text(finished ? "\(count) source\(count == 1 ? "" : "s")" : "Finding sources…")
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.textTertiary)
                    .contentTransition(.numericText())
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var providerStatus: some View {
        if !pending.isEmpty || !failures.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Space.xs) {
                    ForEach(pending.sorted { $0.value < $1.value }, id: \.key) { _, name in
                        HStack(spacing: 6) { ProgressView().scaleEffect(0.6); Text(name) }
                            .statusChip()
                    }
                    ForEach(failures.sorted { $0.key < $1.key }, id: \.key) { id, error in
                        Label(providerName(id), systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .statusChip()
                            .help(error)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    /// Long-press / right-click: the same pick as a tap, and the release's file name, which rows keep out of sight.
    @ViewBuilder
    private func sourceMenu(_ source: StreamSource) -> some View {
        Button { choose(source) } label: {
            Label(forDownload ? "Download" : "Play", systemImage: forDownload ? "arrow.down.to.line" : "play.fill")
        }
        .disabled(!source.isActionable)
        #if !os(tvOS)
        if let filename = source.filename {
            Button { Platform.copyToPasteboard(filename) } label: { Label("Copy File Name", systemImage: "doc.on.doc") }
        }
        #endif
    }

    /// With rows titled by provider (the default), the provider heads its group instead.
    private var providerHeaders: Bool { model.settings.sources.appearance.titleDisplay == .provider }

    /// Consecutive runs of one provider's sources, in ranked order.
    static func byProvider(_ sources: [StreamSource]) -> [[StreamSource]] {
        var groups: [[StreamSource]] = []
        for source in sources {
            if groups.last?.first?.providerID == source.providerID { groups[groups.count - 1].append(source) } else { groups.append([source]) }
        }
        return groups
    }

    private func providerName(_ id: String) -> String {
        model.sourceProviders().first { $0.providerID == id }?.providerName ?? id
    }

    private func gather() async {
        let providers = model.sourceProviders()
        // A title opened from a library asks that library first, and the rest only if it has nothing (Settings → Sources).
        let library = model.settings.sources.playFromLibraryOnly
            ? request.libraryProviderID.flatMap { id in providers.first { $0.providerID == id } } : nil
        // The first search starts from what the detail page already found, then refreshes; Search Again starts clean.
        var prefetched = reloadToken == 0 ? model.prefetchedSources.sources(for: request) : nil
        if let library, let own = prefetched?.filter({ $0.providerID == library.providerID }), !own.isEmpty { prefetched = own }
        raw = prefetched ?? []
        failures = [:]
        finished = false
        let live = prefetched == nil
        var fresh: [StreamSource]
        if let library {
            fresh = await collect([library], live: live)
            if fresh.isEmpty { fresh = await collect(providers.filter { $0.providerID != library.providerID }, live: live) }
        } else {
            fresh = await collect(providers, live: live)
        }
        guard !Task.isCancelled else { return }
        // Keep the prefetched list if the refresh came back empty only because providers failed.
        if prefetched != nil, !fresh.isEmpty || failures.isEmpty { raw = fresh }
        finished = true
        maybeAutoPlay(final: true)
    }

    /// Everything the providers found; with `live`, rows appear as each provider answers.
    private func collect(_ providers: [SourceProvider], live: Bool) async -> [StreamSource] {
        var found: [StreamSource] = []
        for await update in SourceAggregator.stream(providers, request: request, timeout: model.settings.sources.timeoutSeconds) {
            switch update {
            case .loading(let id, let name): pending[id] = name
            case .loaded(let id, let sources):
                pending[id] = nil
                found += sources
                if live { raw += sources }
            case .failed(let id, _, let error):
                pending[id] = nil
                failures[id] = error
            case .finished: break
            }
        }
        return found
    }

    /// With "auto-play first source" on, start as soon as every provider answered.
    private func maybeAutoPlay(final: Bool = false) {
        guard final, !forDownload, !autoPlayed, model.settings.sources.autoPlayFirstSource,
              let first = ranked.first(where: \.isPlayable) else { return }
        autoPlayed = true
        choose(first)
    }

    private func choose(_ source: StreamSource) {
        // A pick made while the search was still running must not be followed by an auto-play when it ends.
        autoPlayed = true
        if forDownload {
            if let error = DownloadManager.shared.start(source: source, request: request, location: model.settings.downloads.location) {
                model.showToast(error)
            } else {
                model.showToast("Downloading \(request.displayTitle)")
                dismiss()
            }
        } else {
            // The rest of the list, in order, is where the player turns if this one won't start.
            let fallbacks = ranked.filter { $0.isPlayable && $0.id != source.id }
            model.startPlayback(source, request: request, alternatives: fallbacks)
        }
    }
}

/// The source Flow ranks first, larger than a row, with the one button most people want.
struct BestMatchCard: View {
    let source: StreamSource
    let appearance: SourceAppearance
    var forDownload = false
    let action: () -> Void

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous) }
    private var summary: SourceSummary { SourceSummary(source: source, appearance: appearance, providerShownElsewhere: true) }
    private var verb: String { forDownload ? "Download" : "Play" }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                    Text("Best Match".uppercased()).kerning(1.2)
                }
                .font(Theme.Typeface.micro)
                .foregroundStyle(Theme.Palette.gold)
                HStack(spacing: Theme.Space.m) {
                    ResolutionBlock(source: source, growth: 1.2)
                    VStack(alignment: .leading, spacing: 4) {
                        SourcePrimaryLine(title: summary.title, size: summary.size, font: .system(.title3, weight: .bold))
                        if let subtitle {
                            Text(subtitle)
                                .font(Theme.Typeface.body)
                                .foregroundStyle(Theme.Palette.textSecondary)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                SourceBadgeRow(source: source, appearance: appearance)
            }
            .contentShape(Rectangle())
            .onTapGesture(perform: action)
            // The button below speaks for the whole card.
            .accessibilityHidden(true)
            Button(action: action) {
                Label(verb, systemImage: forDownload ? "arrow.down.to.line" : "play.fill")
                    // Full width, except on Apple TV, where a full-width button grows past the card when focused.
                    .frame(maxWidth: Platform.isTV ? nil : .infinity)
                    .frame(minWidth: Platform.isTV ? 360 : nil)
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityLabel("\(verb) best match, \(summary.accessibilityLabel)")
        }
        .padding(Theme.Space.m)
        .background(LinearGradient(colors: [Theme.Palette.gold.opacity(0.16), Color.white.opacity(0.05)], startPoint: .topLeading, endPoint: .bottomTrailing), in: shape)
        .overlay(shape.strokeBorder(Theme.Palette.gold.opacity(0.28), lineWidth: 1))
    }

    /// The card isn't under a provider's heading, so the provider's name leads.
    private var subtitle: String? {
        let parts = [source.providerName, summary.detail].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

struct SourceRow: View {
    let source: StreamSource
    let appearance: SourceAppearance
    /// The provider's name heads the group, so the row leads with what tells its sources apart.
    var providerShownAbove = false

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous) }
    private var summary: SourceSummary { SourceSummary(source: source, appearance: appearance, providerShownElsewhere: providerShownAbove) }

    var body: some View {
        HStack(alignment: appearance.showRawText ? .top : .center, spacing: Theme.Space.m) {
            ResolutionBlock(source: source, growth: appearance.compact ? 0.85 : 1)
            VStack(alignment: .leading, spacing: appearance.compact ? 2 : 4) {
                SourcePrimaryLine(title: summary.title, size: summary.size, font: Theme.Typeface.headline)
                if appearance.showRawText {
                    let lines = summary.rawLines
                    if !lines.isEmpty {
                        Text(lines.joined(separator: "\n"))
                            .font(.system(.footnote))
                            .foregroundStyle(Theme.Palette.textSecondary)
                            .lineLimit(appearance.compact ? 3 : 8)
                            .multilineTextAlignment(.leading)
                    }
                } else if let detail = summary.detail {
                    Text(detail)
                        .font(Theme.Typeface.body)
                        .foregroundStyle(Theme.Palette.textSecondary)
                        .lineLimit(1)
                }
                SourceBadgeRow(source: source, appearance: appearance)
                    .padding(.top, appearance.compact ? 0 : 2)
                if !source.isPlayable, case .torrent = source.location {
                    Label("Needs a debrid-enabled add-on", systemImage: "exclamationmark.circle").font(Theme.Typeface.caption).foregroundStyle(.orange)
                }
            }
            Spacer(minLength: 0)
            if source.isActionable {
                Image(systemName: "chevron.right")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Theme.Palette.textTertiary)
            }
        }
        .padding(.horizontal, Theme.Space.m)
        .padding(.vertical, appearance.compact ? Theme.Space.s : Theme.Space.m)
        .background(Theme.Palette.surface, in: shape)
        .hairline(shape)
        .contentShape(shape)
        .opacity(source.isActionable ? 1 : 0.55)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary.accessibilityLabel)
    }
}

// MARK: - Pieces shared by the rows and the Best Match card

private extension StreamSource {
    /// Opens outside Flow (a link): nothing to stream, but the row still does something when picked.
    var isExternal: Bool {
        if case .external = location { return true }
        return false
    }

    var isActionable: Bool { isPlayable || isExternal }
    var resolutionLabel: String? { traits.resolution == .unknown ? nil : traits.resolution.label }
    var qualityLabel: String? { traits.quality == .unknown ? nil : traits.quality.rawValue }
    var sizeLabel: String? { traits.sizeBytes.map { StreamParser.formatBytes($0) } }
}

/// The words a source is shown with, worked out from the user's Source Appearance settings.
private struct SourceSummary {
    let source: StreamSource
    let appearance: SourceAppearance
    /// The provider's name is already on screen (a group heading, the card's subtitle).
    let providerShownElsewhere: Bool

    private var traits: StreamTraits { source.traits }
    /// The resolution has its own block, so a provider-led row's title is the release type ("WEB-DL").
    private var qualityLeads: Bool { appearance.titleDisplay == .provider && providerShownElsewhere }

    var size: String? { appearance.showSize ? source.sizeLabel : nil }

    var title: String? {
        switch appearance.titleDisplay {
        case .provider where providerShownElsewhere:
            return source.qualityLabel ?? (size == nil ? (source.filename ?? source.providerName) : nil)
        case .provider: return source.providerName
        case .filename: return source.filename ?? source.providerName
        case .addonName: return source.title.components(separatedBy: "\n").first ?? source.providerName
        }
    }

    /// Languages first; the release type too when the title isn't it already.
    var detail: String? {
        let languages = traits.languages.isEmpty ? nil : traits.languages.joined(separator: " · ")
        let parts = [qualityLeads ? nil : source.qualityLabel, languages, traits.releaseGroup?.uppercased()].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The add-on's own text minus the first line (usually its name).
    var rawLines: [String] {
        var lines = (source.detail ?? source.title).components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if lines.first == title { lines.removeFirst() }
        return lines
    }

    /// "1080p WEB-DL, 3.98 GB, English, Dolby Vision"
    var accessibilityLabel: String {
        var parts: [String] = []
        let release = [source.resolutionLabel, source.qualityLabel].compactMap { $0 }.joined(separator: " ")
        if !release.isEmpty { parts.append(release) }
        if !providerShownElsewhere { parts.append(source.providerName) }
        if let size = source.sizeLabel { parts.append(size) }
        if !traits.languages.isEmpty { parts.append(traits.languages.joined(separator: " and ")) }
        parts += (traits.hdr + [traits.audioCodec].compactMap { $0 }).compactMap { PremiumBadge.spoken($0) }
        if traits.isCached == true && source.category == .addons { parts.append("Cached") }
        if !source.isPlayable, case .torrent = source.location { parts.append("Needs a debrid-enabled add-on") }
        if parts.isEmpty { parts.append(title ?? source.providerName) }
        return parts.joined(separator: ", ")
    }
}

/// The badges worth a colour: Dolby Vision and HDR, and the object-based or lossless audio formats.
private enum PremiumBadge {
    static let hdr: [String: String] = ["DV": "Dolby Vision", "HDR10+": "HDR10 Plus", "HDR": "HDR", "HLG": "HLG"]
    static let audio: [String: String] = ["Atmos": "Atmos", "TrueHD Atmos": "TrueHD Atmos", "TrueHD": "TrueHD", "DTS-HD MA": "DTS-HD Master Audio", "DTS:X": "DTS X"]

    static func isPremium(_ badge: String) -> Bool { spoken(badge) != nil }
    static func spoken(_ badge: String) -> String? { hdr[badge] ?? audio[badge] }
}

/// "WEB-DL · 3.98 GB": the title gives way (truncates) before the size does.
private struct SourcePrimaryLine: View {
    let title: String?
    let size: String?
    let font: Font

    var body: some View {
        HStack(spacing: 6) {
            if let title {
                Text(title).lineLimit(1).truncationMode(.middle)
            }
            if let size {
                Text(title == nil ? size : "· \(size)")
                    .monospacedDigit()
                    .foregroundStyle(Theme.Palette.textSecondary)
                    .layoutPriority(1)
            }
        }
        .font(font)
    }
}

/// The resolution as a rounded square: 4K and above carry a faint gold, the rest stay quiet.
private struct ResolutionBlock: View {
    let source: StreamSource
    var growth: CGFloat = 1
    @ScaledMetric(relativeTo: .headline) private var side: CGFloat = 52 * Theme.scale

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous) }
    private var emphasised: Bool { source.traits.resolution >= .uhd1440 }

    var body: some View {
        Group {
            if let label = source.resolutionLabel {
                Text(label)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                    .padding(.horizontal, 4)
            } else {
                Image(systemName: "film").font(.system(.subheadline, weight: .semibold))
            }
        }
        .foregroundStyle(emphasised ? Theme.Palette.gold : source.traits.resolution >= .hd1080 ? Color.white : Theme.Palette.textSecondary)
        .frame(width: side * growth, height: side * growth)
        .background(emphasised ? Theme.Palette.gold.opacity(0.14) : Theme.Palette.surfaceStrong, in: shape)
        .overlay(shape.strokeBorder(emphasised ? Theme.Palette.gold.opacity(0.35) : Theme.Palette.hairline, lineWidth: 1))
        .accessibilityHidden(true)
    }
}

/// Two tiers: Dolby Vision, HDR and the premium audio formats keep their colour; codecs, channel counts and "Cached" stay quiet.
private struct SourceBadgeRow: View {
    let source: StreamSource
    let appearance: SourceAppearance

    private var badges: [String] {
        guard appearance.badgePack != .none else { return [] }
        var out = source.traits.badges
        // The resolution block already leads with it.
        if source.traits.resolution != .unknown, !out.isEmpty { out.removeFirst() }
        out = out.filter(PremiumBadge.isPremium) + out.filter { !PremiumBadge.isPremium($0) }
        if appearance.badgePack == .minimal { out = Array(out.prefix(2)) }
        if source.traits.isCached == true && source.category == .addons { out.append("Cached") }
        return out
    }

    var body: some View {
        let shown = badges
        if !shown.isEmpty {
            WrappingRow(spacing: 6 * Theme.scale, lineSpacing: 6 * Theme.scale) {
                ForEach(shown, id: \.self) { badge in chip(badge) }
            }
        }
    }

    private func chip(_ badge: String) -> some View {
        let shape = RoundedRectangle(cornerRadius: 5 * Theme.scale, style: .continuous)
        let premium = PremiumBadge.isPremium(badge)
        return Text(badge)
            .font(premium ? Theme.Typeface.micro : .system(.caption2, weight: .semibold))
            .padding(.horizontal, 7 * Theme.scale).padding(.vertical, 3 * Theme.scale)
            .foregroundStyle(premium ? Color.white : Theme.Palette.textSecondary)
            .background(premium ? premiumFill(badge) : Color.white.opacity(0.05), in: shape)
            .overlay { if !premium { shape.strokeBorder(Theme.Palette.hairline, lineWidth: 1) } }
    }

    private func premiumFill(_ badge: String) -> Color {
        guard appearance.badgePack == .colored else { return Color.white.opacity(0.2) }
        return PremiumBadge.hdr[badge] != nil
            ? Color(red: 0.62, green: 0.4, blue: 0.95).opacity(0.85)
            : Color(red: 0.15, green: 0.65, blue: 0.7).opacity(0.8)
    }
}

/// A row-shaped stand-in while the first providers answer.
private struct SourceRowPlaceholder: View {
    @ScaledMetric(relativeTo: .headline) private var side: CGFloat = 52 * Theme.scale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
        HStack(spacing: Theme.Space.m) {
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .fill(Theme.Palette.surfaceStrong)
                .frame(width: side, height: side)
            VStack(alignment: .leading, spacing: 8 * Theme.scale) {
                Capsule().fill(Theme.Palette.surfaceStrong).frame(width: 150 * Theme.scale, height: 12 * Theme.scale)
                Capsule().fill(Theme.Palette.surface).frame(width: 96 * Theme.scale, height: 10 * Theme.scale)
                HStack(spacing: 6 * Theme.scale) {
                    Capsule().fill(Theme.Palette.surface).frame(width: 34 * Theme.scale, height: 16 * Theme.scale)
                    Capsule().fill(Theme.Palette.surface).frame(width: 42 * Theme.scale, height: 16 * Theme.scale)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.m)
        .background(Theme.Palette.surface, in: shape)
        .hairline(shape)
    }
}

/// Rows are wide, so they press and focus more gently than poster cards do.
private struct SourceRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(SourceRowFocus())
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .brightness(configuration.isPressed ? -0.04 : 0)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
    }
}

/// tvOS focus effect for a full-width row: a small lift and a shadow. No-op elsewhere.
private struct SourceRowFocus: ViewModifier {
    @Environment(\.isFocused) private var focused

    func body(content: Content) -> some View {
        #if os(tvOS)
        content
            .scaleEffect(focused ? 1.03 : 1)
            .shadow(color: .black.opacity(focused ? 0.5 : 0), radius: 24, y: 14)
            .brightness(focused ? 0.06 : 0)
            .animation(Theme.Motion.snappy, value: focused)
        #else
        content
        #endif
    }
}

private extension View {
    func statusChip() -> some View {
        font(Theme.Typeface.caption)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Theme.Palette.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.Palette.hairline))
    }
}
