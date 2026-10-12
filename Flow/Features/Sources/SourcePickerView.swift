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

    /// The source auto-play would start: the one this title was last played from when it's still
    /// offered, else the first playable one in the providers' order. Only called out when there is a
    /// choice to make.
    private func bestMatch(in list: [StreamSource]) -> StreamSource? {
        list.count > 1 ? preferred(in: list) : nil
    }

    private func preferred(in list: [StreamSource]) -> StreamSource? {
        model.lastSource(for: request, in: list) ?? list.first(where: \.isPlayable)
    }

    private func grouped(_ list: [StreamSource]) -> [(SourceCategory, [StreamSource])] {
        let order = model.settings.sources.categoryOrder
        let groups = Dictionary(grouping: list, by: \.category)
        return order.compactMap { cat in groups[cat].map { (cat, $0) } }
    }

    var body: some View {
        let list = ranked
        let best = bestMatch(in: list)
        let lastPlayedID = model.lastSource(for: request, in: list)?.id
        let groups = grouped(list)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.l) {
                    header(count: list.count)
                    if let best {
                        PlayChoice(source: best, forDownload: forDownload, lastPlayed: lastPlayedID == best.id) { choose(best) }
                            .contextMenu { sourceMenu(best) }
                    }
                    if list.isEmpty && !finished {
                        GroupedTable {
                            ForEach(0..<3, id: \.self) { index in SourceRowPlaceholder(showsDivider: index > 0) }
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
                    ForEach(groups, id: \.0) { category, sources in
                        if providerHeaders {
                            // By position: the demotions can leave one provider's sources in two separate runs.
                            ForEach(Array(Self.byProvider(sources).enumerated()), id: \.offset) { _, group in
                                section(title: group.first?.providerName ?? category.displayName, count: group.count,
                                        note: groups.count > 1 ? category.displayName : nil, sources: group, lastPlayedID: lastPlayedID)
                            }
                        } else {
                            section(title: category.displayName, count: sources.count, note: nil, sources: sources, lastPlayedID: lastPlayedID)
                        }
                    }
                    failureNotes
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

    /// A provider's sources under its name, as one grouped list in the order the provider gave them.
    private func section(title: String, count: Int, note: String?, sources: [StreamSource], lastPlayedID: String?) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title).font(Theme.Typeface.headline)
                Text("\(count)").font(.system(.subheadline).monospacedDigit()).foregroundStyle(Theme.Palette.textTertiary)
                Spacer(minLength: 0)
                if let note { Text(note).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary) }
            }
            .padding(.horizontal, Platform.isTV ? 0 : Theme.Space.xs)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            GroupedTable {
                ForEach(Array(sources.enumerated()), id: \.element.id) { index, source in
                    Button { choose(source) } label: {
                        SourceRow(source: source, appearance: model.settings.sources.appearance, providerShownAbove: providerHeaders,
                                  lastPlayed: source.id == lastPlayedID, showsDivider: index > 0)
                    }
                    .buttonStyle(TableRowButtonStyle())
                    .disabled(!source.isActionable)
                    .contextMenu { sourceMenu(source) }
                }
            }
        }
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
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(request.item.title).font(Theme.Typeface.title).displayTracking().lineLimit(2)
                if let ep = request.episode {
                    Text("\(ep.code) · \(ep.title)").font(Theme.Typeface.body).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                }
                status(count: count)
            }
            Spacer(minLength: 0)
        }
    }

    /// "Searching AIOStreams…" while providers answer, then the count.
    @ViewBuilder
    private func status(count: Int) -> some View {
        let searching = pending.values.sorted()
        if !finished, !searching.isEmpty {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Searching \(ListFormatter.localizedString(byJoining: searching))…").lineLimit(1)
            }
            .font(Theme.Typeface.caption)
            .foregroundStyle(Theme.Palette.textTertiary)
        } else {
            Text(finished ? "\(count) source\(count == 1 ? "" : "s")" : "Finding sources…")
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.textTertiary)
                .contentTransition(.numericText())
        }
    }

    /// Providers that failed or timed out, in a line each under the list, where they don't push the sources down.
    @ViewBuilder
    private var failureNotes: some View {
        if !failures.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(failures.sorted { $0.key < $1.key }, id: \.key) { id, error in
                    Label {
                        Text("\(providerName(id)): \(error)")
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    }
                }
            }
            .font(Theme.Typeface.caption)
            .foregroundStyle(Theme.Palette.textSecondary)
            .padding(.horizontal, Platform.isTV ? 0 : Theme.Space.xs)
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
              let first = preferred(in: ranked) else { return }
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

/// The one action most people want, saying exactly what it will start: "4K · Dolby Vision · Atmos ·
/// 18.20 GB · AIOStreams". The same source is also in the list below, in its place.
private struct PlayChoice: View {
    let source: StreamSource
    var forDownload = false
    /// The title was last played from this source, which is why it's the one offered.
    var lastPlayed = false
    let action: () -> Void

    private var verb: String { forDownload ? "Download" : "Play" }

    private var description: String {
        let formats = (source.traits.hdr.map { PremiumBadge.display($0) }
            + [source.traits.audioCodec].compactMap { $0 }.filter(PremiumBadge.isPremium).map { PremiumBadge.display($0) })
        let parts = [source.resolutionLabel] + formats + [source.sizeLabel, source.providerName]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        VStack(spacing: Theme.Space.s) {
            Button(action: action) {
                Label(verb, systemImage: forDownload ? "arrow.down.to.line" : "play.fill")
                    // Full width, except on Apple TV, where a full-width button grows past the screen's edge when focused.
                    .frame(maxWidth: Platform.isTV ? nil : .infinity)
                    .frame(minWidth: Platform.isTV ? 420 : nil)
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityLabel("\(verb), \(lastPlayed ? "last played, " : "")\(description)")
            Group {
                if lastPlayed {
                    Text("\(Image(systemName: "clock.arrow.circlepath")) Last played · \(description)")
                } else {
                    Text(description)
                }
            }
            .font(Theme.Typeface.caption)
            .foregroundStyle(Theme.Palette.textSecondary)
            .multilineTextAlignment(.center)
            .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity)
        // Room for Apple TV's focus lift.
        .padding(.vertical, Platform.isTV ? Theme.Space.s : 0)
    }
}

/// One source as a line of a table: the resolution in its own column on the release's baseline, the
/// size right-aligned in tabular digits, then the formats and languages beneath. Premium formats get a
/// small outlined badge; codecs stay plain words; only the exceptions (not cached, needs debrid) are flagged.
struct SourceRow: View {
    let source: StreamSource
    let appearance: SourceAppearance
    /// The provider's name heads the group, so the row leads with what tells its sources apart.
    var providerShownAbove = false
    var lastPlayed = false
    /// A hairline above this row, from the text column across, when it follows another in a list.
    var showsDivider = false

    @Environment(\.isFocused) private var focused
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .headline) private var scaledColumn: CGFloat = 54

    private var summary: SourceSummary { SourceSummary(source: source, appearance: appearance, providerShownElsewhere: providerShownAbove) }
    /// The resolution column; past a point it stops growing and its label shrinks to fit.
    private var column: CGFloat { min(scaledColumn, 76) * Theme.scale }
    /// At accessibility text sizes the column would squeeze the rest, so the resolution joins the title.
    private var columnShown: Bool { !typeSize.isAccessibilitySize }
    private var vertical: CGFloat { appearance.compact ? Theme.Space.s : 14 * Theme.scale }

    // Apple TV draws focus the system way, white with dark text.
    private var primary: Color { focused ? .black : .white }
    private var secondary: Color { focused ? .black.opacity(0.62) : Theme.Palette.textSecondary }
    private var tertiary: Color { focused ? .black.opacity(0.45) : Theme.Palette.textTertiary }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
            if columnShown {
                Text(source.resolutionLabel ?? "–")
                    .font(.system(.headline, design: .rounded, weight: .semibold).monospacedDigit())
                    .foregroundStyle(resolutionColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: column, alignment: .leading)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            }
            VStack(alignment: .leading, spacing: appearance.compact ? 3 : 5) {
                titleLine
                if appearance.showRawText {
                    let lines = summary.rawLines
                    if !lines.isEmpty {
                        Text(lines.joined(separator: "\n"))
                            .font(.system(.footnote))
                            .foregroundStyle(secondary)
                            .lineLimit(appearance.compact ? 3 : 8)
                            .multilineTextAlignment(.leading)
                    }
                } else {
                    SourceFormatLine(source: source, pack: appearance.badgePack, focused: focused)
                }
                metaLine
            }
        }
        .padding(.horizontal, Theme.Space.m)
        .padding(.vertical, vertical)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tvRowSurface(focused: focused)
        .tableDivider(showsDivider, inset: Theme.Space.m + (columnShown ? column + Theme.Space.m : 0))
        .contentShape(Rectangle())
        .opacity(source.isActionable ? 1 : 0.5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel((lastPlayed ? "Last played, " : "") + summary.accessibilityLabel)
    }

    /// "WEB-DL                 18.20 GB": the title gives way (truncates) before the size does.
    private var titleLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
            Text(title)
                .font(Theme.Typeface.headline)
                .foregroundStyle(primary)
                .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                .truncationMode(.middle)
            Spacer(minLength: Theme.Space.s)
            if let size = summary.size, !typeSize.isAccessibilitySize {
                Text(size).font(.system(.subheadline).monospacedDigit()).foregroundStyle(secondary).layoutPriority(1)
            }
        }
    }

    private var title: String {
        let text = summary.title ?? source.filename ?? source.providerName
        guard !columnShown, let resolution = source.resolutionLabel else { return text }
        let withSize = typeSize.isAccessibilitySize ? [summary.size].compactMap { $0 } : []
        return ([resolution, text] + withSize).joined(separator: " · ")
    }

    /// Languages and release group, then whatever needs saying about this one in particular.
    @ViewBuilder
    private var metaLine: some View {
        let words = appearance.showRawText ? nil : summary.detail
        let notCached = source.traits.isCached == false && source.category == .addons
        let needsDebrid: Bool = { if !source.isPlayable, case .torrent = source.location { return true }; return false }()
        if words != nil || lastPlayed || notCached || needsDebrid {
            WrappingRow(spacing: 10 * Theme.scale, lineSpacing: 4) {
                if let words { Text(words).foregroundStyle(tertiary).lineLimit(1) }
                if lastPlayed { Label("Last played", systemImage: "clock.arrow.circlepath").foregroundStyle(secondary) }
                if notCached { Label("Not cached", systemImage: "hourglass").foregroundStyle(.orange) }
                if needsDebrid { Label("Needs a debrid-enabled add-on", systemImage: "exclamationmark.circle").foregroundStyle(.orange) }
            }
            .font(Theme.Typeface.caption)
            .labelStyle(TightLabelStyle())
        }
    }

    private var resolutionColor: Color {
        if focused { return .black }
        switch source.traits.resolution {
        case .uhd4k, .uhd1440, .hd1080: return .white
        case .unknown: return Theme.Palette.textTertiary
        default: return Theme.Palette.textSecondary
        }
    }
}

/// Icon and words a few points apart; the system's spacing is made for list rows, not captions.
private struct TightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}

/// "[DOLBY VISION] [ATMOS] HEVC · 5.1": outlined badges for the formats that change what you see and
/// hear, plain words for the rest. Follows Settings → Source Appearance → Badges.
private struct SourceFormatLine: View {
    let source: StreamSource
    let pack: BadgePack
    var focused = false

    private var traits: StreamTraits { source.traits }

    private var premium: [String] {
        let all = traits.hdr + [traits.audioCodec].compactMap { $0 }.filter(PremiumBadge.isPremium)
        return pack == .minimal ? Array(all.prefix(2)) : all
    }

    private var plain: String? {
        guard pack != .minimal else { return nil }
        let words = [traits.videoCodec, traits.audioCodec.flatMap { PremiumBadge.isPremium($0) ? nil : $0 }, traits.audioChannels].compactMap { $0 }
        return words.isEmpty ? nil : words.joined(separator: " · ")
    }

    var body: some View {
        if pack != .none, !premium.isEmpty || plain != nil {
            WrappingRow(spacing: 6 * Theme.scale, lineSpacing: 5 * Theme.scale) {
                ForEach(premium, id: \.self) { badge($0) }
                if let plain {
                    Text(plain)
                        .font(.system(.caption).monospacedDigit())
                        .foregroundStyle(focused ? .black.opacity(0.62) : Theme.Palette.textSecondary)
                        .padding(.leading, premium.isEmpty ? 0 : 2)
                }
            }
        }
    }

    private func badge(_ name: String) -> some View {
        let tint = tint(for: name)
        return Text(PremiumBadge.display(name).uppercased())
            .font(.system(size: 9.5 * Theme.scale, weight: .bold))
            .kerning(0.4)
            .foregroundStyle(tint)
            .padding(.horizontal, 5 * Theme.scale)
            .padding(.vertical, 2.5 * Theme.scale)
            .overlay(RoundedRectangle(cornerRadius: 4 * Theme.scale, style: .continuous).strokeBorder(tint.opacity(0.55), lineWidth: 1))
            .fixedSize()
    }

    /// Colored tells picture formats from sound formats by a faint tint; the others stay white.
    private func tint(for name: String) -> Color {
        if focused { return .black.opacity(0.75) }
        guard pack == .colored else { return .white.opacity(0.85) }
        return PremiumBadge.hdr[name] != nil ? Color(red: 0.78, green: 0.7, blue: 1.0) : Color(red: 0.6, green: 0.88, blue: 0.9)
    }
}

// MARK: - Pieces shared by the rows and the Play button

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

    /// How a badge reads on screen: "DV" is spelled out, the rest are already familiar.
    static func display(_ badge: String) -> String { badge == "DV" ? "Dolby Vision" : badge }
    static func isPremium(_ badge: String) -> Bool { spoken(badge) != nil }
    static func spoken(_ badge: String) -> String? { hdr[badge] ?? audio[badge] }
}

/// A row-shaped stand-in while the first providers answer.
private struct SourceRowPlaceholder: View {
    var showsDivider = false

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.m) {
            Capsule().fill(Theme.Palette.surfaceStrong).frame(width: 40 * Theme.scale, height: 14 * Theme.scale)
                .frame(width: 54 * Theme.scale, alignment: .leading)
            VStack(alignment: .leading, spacing: 8 * Theme.scale) {
                HStack {
                    Capsule().fill(Theme.Palette.surfaceStrong).frame(width: 90 * Theme.scale, height: 14 * Theme.scale)
                    Spacer()
                    Capsule().fill(Theme.Palette.surface).frame(width: 56 * Theme.scale, height: 12 * Theme.scale)
                }
                Capsule().fill(Theme.Palette.surface).frame(width: 140 * Theme.scale, height: 10 * Theme.scale)
                Capsule().fill(Theme.Palette.surface).frame(width: 70 * Theme.scale, height: 10 * Theme.scale)
            }
        }
        .padding(.horizontal, Theme.Space.m)
        .padding(.vertical, 14 * Theme.scale)
        .tvRowSurface(focused: false)
        .tableDivider(showsDivider, inset: Theme.Space.m * 2 + 54 * Theme.scale)
    }
}
