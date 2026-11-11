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
    /// Which chip is on. Only what the rows show changes: auto-play and the fallbacks still use the whole ranked list.
    @State private var quickFilter: SourceQuickFilter = .all

    private var ranked: [StreamSource] {
        SourceRanker.rank(raw, settings: model.settings.sources, resolutionCap: model.resolutionCap, decodesAV1: Platform.decodesAV1,
                          decodesLosslessAudio: MatroskaRemuxer.audioDecoders != nil, prefersHDR: model.settings.playback.preferHDR,
                          preferredAudioLanguage: model.settings.playback.preferredAudioLanguage)
    }

    /// The source auto-play would start: the one this title was last played from when it's still
    /// offered, else the first playable one in the providers' order. Its row carries the yellow Play.
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
        let bestID = preferred(in: list)?.id
        let lastPlayedID = model.lastSource(for: request, in: list)?.id
        // A chip whose sources are gone (a new search found different ones) falls back to All instead of an empty list.
        let filtered = quickFilter.apply(to: list)
        let shown = filtered.isEmpty ? list : filtered
        let groups = grouped(shown)
        NavigationStack {
            VStack(spacing: 0) {
                header(count: list.count, hidden: SourceQuickFilter.hiddenCount(found: raw, shown: list))
                if finished || !list.isEmpty { filterChips(for: list) }
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if list.isEmpty && !finished {
                            VStack(spacing: 0) {
                                ForEach(0..<3, id: \.self) { index in SourceRowPlaceholder(showsDivider: index > 0) }
                            }
                            .shimmering()
                            .accessibilityHidden(true)
                        } else if list.isEmpty {
                            emptyState
                        }
                        ForEach(groups, id: \.0) { category, sources in
                            if providerHeaders {
                                // By position: the demotions can leave one provider's sources in two separate runs.
                                ForEach(Array(Self.byProvider(sources).enumerated()), id: \.offset) { _, group in
                                    section(title: group.first?.providerName ?? category.displayName, count: group.count,
                                            note: groups.count > 1 ? category.displayName : nil, sources: group, lastPlayedID: lastPlayedID, bestID: bestID)
                                }
                            } else {
                                section(title: category.displayName, count: sources.count, note: nil, sources: sources, lastPlayedID: lastPlayedID, bestID: bestID)
                            }
                        }
                        failureNotes
                    }
                    .padding(.bottom, Theme.Space.xxl)
                    .animation(Theme.Motion.move, value: shown.map(\.id))
                }
            }
            .background(Theme.Palette.bg)
            #if !os(macOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
            .task(id: reloadToken) { await gather() }
        }
        #if os(iOS)
        // A square sheet, like everything else.
        .presentationCornerRadius(0)
        #endif
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 640)
        #endif
    }

    /// Nothing found: what to do next, in words.
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text("No Sources")
                .font(Theme.Typeface.title)
                .textCase(.uppercase)
                .foregroundStyle(Theme.Palette.fg)
            Text(model.sourceProviders().isEmpty
                 ? "Add a media server, WebDAV share, IPTV provider or stream add-on in Settings."
                 : "None of your sources have this title yet.")
                .font(Theme.Typeface.reading)
                .foregroundStyle(Theme.Palette.fg)
        }
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.vertical, Theme.Space.xl)
    }

    /// A provider's sources under its name: a 2px rule, the name as a red mono label, its count, then ruled rows in the
    /// order the provider gave them.
    private func section(title: String, count: Int, note: String?, sources: [StreamSource], lastPlayedID: String?, bestID: String?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RuleLine()
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                SectionLabel(title)
                Text("\(count)")
                    .font(Theme.Typeface.detailKey)
                    .foregroundStyle(Theme.Palette.muted)
                Spacer(minLength: 0)
                if let note {
                    Text(note)
                        .font(Theme.Typeface.caption)
                        .detailCaps()
                        .foregroundStyle(Theme.Palette.muted)
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Theme.Space.s)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            LazyVStack(spacing: 0) {
                ForEach(Array(sources.enumerated()), id: \.element.id) { index, source in
                    Button { choose(source) } label: {
                        SourceRow(source: source, appearance: model.settings.sources.appearance, providerShownAbove: providerHeaders,
                                  lastPlayed: source.id == lastPlayedID, isBest: source.id == bestID, forDownload: forDownload, showsDivider: index > 0)
                    }
                    .buttonStyle(RuledCellStyle())
                    .disabled(!source.isActionable)
                    .contextMenu { sourceMenu(source) }
                }
            }
        }
    }

    /// The sheet's controls: Search Again and Close, square bordered cells at the header's trailing edge. tvOS leaves out
    /// Close: the remote's Back button dismisses every sheet.
    private var controls: some View {
        HStack(spacing: -Theme.Rule.heavy) {
            Button { reloadToken += 1 } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(GlassButtonStyle(circle: true))
                .disabled(!finished)
                .accessibilityLabel("Search Again")
            #if !os(tvOS)
            Button { dismiss() } label: { Image(systemName: "xmark") }
                .buttonStyle(GlassButtonStyle(circle: true))
                .keyboardShortcut(.cancelAction)
                .accessibilityLabel("Close")
            #endif
        }
    }

    /// Resolution and provider chips, as the website's picker, when the list has more than one of either: bordered cells
    /// that share their borders, the current one inverted, under a 2px rule.
    @ViewBuilder
    private func filterChips(for list: [StreamSource]) -> some View {
        if SourceQuickFilter.hasChoices(in: list) {
            let resolutions = SourceQuickFilter.resolutions(in: list)
            let providers = SourceQuickFilter.providers(in: list)
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: -Theme.Rule.heavy) {
                        chip("All", filter: .all)
                        if resolutions.count > 1 { ForEach(resolutions) { chip($0.label, filter: .resolution($0)) } }
                        if providers.count > 1 { ForEach(providers) { chip($0.name, filter: .provider($0.id)) } }
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.vertical, Theme.Space.s)
                    .padding(.vertical, Platform.isTV ? 12 : 0)
                }
                .scrollClipDisabled()
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Filter Sources")
                RuleLine()
            }
        }
    }

    private func chip(_ title: String, filter: SourceQuickFilter) -> some View {
        let selected = quickFilter == filter
        return Button { withAnimation(Theme.Motion.state) { quickFilter = filter } } label: { Text(title).lineLimit(1) }
            .buttonStyle(FilterChipStyle(current: selected))
            .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// The title (and episode) with its poster, what the search is doing, and the controls; a 2px rule closes it.
    private func header(count: Int, hidden: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: Theme.Space.m) {
                Color.clear
                    .frame(width: 48 * Theme.scale, height: 72 * Theme.scale)
                    .overlay(RemoteImage(url: request.item.posterURL, maxPixel: 300, fallbackTitle: request.item.title, fallbackURL: request.item.tmdbPosterURL))
                    .clipped()
                    .overlay(Rectangle().strokeBorder(Theme.Palette.rule, lineWidth: Theme.Rule.thin))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(request.item.title)
                        .font(Theme.Typeface.custom(Theme.Face.condensed, 28, .title2))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.Palette.fg)
                        .lineLimit(2)
                        .accessibilityAddTraits(.isHeader)
                    if let ep = request.episode {
                        Text("\(ep.code) · \(ep.title)")
                            .font(Theme.Typeface.detailKey)
                            .detailCaps()
                            .foregroundStyle(Theme.Palette.red)
                            .lineLimit(1)
                    }
                    status(count: count, hidden: hidden)
                }
                Spacer(minLength: 0)
                controls
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.top, Theme.Space.m)
            .padding(.bottom, Theme.Space.m)
            RuleLine()
        }
    }

    /// "Searching AIOStreams…" while providers answer, then the count.
    @ViewBuilder
    private func status(count: Int, hidden: Int) -> some View {
        let searching = pending.values.sorted()
        if !finished, !searching.isEmpty {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Searching \(ListFormatter.localizedString(byJoining: searching))…").lineLimit(1)
            }
            .font(Theme.Typeface.caption)
            .detailCaps()
            .foregroundStyle(Theme.Palette.muted)
        } else {
            Text(finished ? "\(count) source\(count == 1 ? "" : "s")" + (hidden > 0 ? ", \(hidden) hidden by your settings" : "") : "Finding sources…")
                .font(Theme.Typeface.caption)
                .detailCaps()
                .foregroundStyle(Theme.Palette.muted)
                .contentTransition(.numericText())
        }
    }

    /// Providers that failed or timed out, in a line each under the list, where they don't push the sources down.
    @ViewBuilder
    private var failureNotes: some View {
        if !failures.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                RuleLine()
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(failures.sorted { $0.key < $1.key }, id: \.key) { id, error in
                        Label {
                            Text("\(providerName(id)): \(error)")
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.Palette.warn)
                        }
                    }
                }
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.muted)
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Theme.Space.m)
            }
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
        quickFilter = .all
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

/// One source as a ruled row: the resolution in red condensed numerals at the left, then the formats in mono capitals,
/// the release name in condensed type, and the size, provider and languages in muted mono. The ranked-best row carries
/// the solid Play; every row plays on tap. Only exceptions are flagged, in words. The row sits inside a
/// `RuledCellStyle` button, which turns the whole row blue while it is hovered, focused or pressed.
struct SourceRow: View {
    let source: StreamSource
    let appearance: SourceAppearance
    /// The provider's name heads the group, so the row leads with what tells its sources apart.
    var providerShownAbove = false
    var lastPlayed = false
    /// The source Play would start: its row says so with the one solid control.
    var isBest = false
    var forDownload = false
    /// A 1px rule above this row, edge to edge, when it follows another in a list.
    var showsDivider = false

    @Environment(\.cellLit) private var lit
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .headline) private var scaledColumn: CGFloat = Platform.isPhone ? 64 : 88

    private var summary: SourceSummary { SourceSummary(source: source, appearance: appearance, providerShownElsewhere: providerShownAbove) }
    /// The resolution column; past a point it stops growing and its label shrinks to fit.
    private var column: CGFloat { min(scaledColumn, Platform.isPhone ? 84 : 120) * Theme.scale }
    /// At accessibility text sizes the column would squeeze the rest, so the resolution joins the title.
    private var columnShown: Bool { !typeSize.isAccessibilitySize }
    private var vertical: CGFloat { appearance.compact ? 9 * Theme.scale : Theme.Space.m }

    // The row turns blue while lit, so its text turns on-blue: neither red nor muted has contrast on it.
    private var primary: Color { lit ? Theme.Palette.onBlue : Theme.Palette.fg }
    private var secondary: Color { lit ? Theme.Palette.onBlue : Theme.Palette.muted }
    private var warning: Color { lit ? Theme.Palette.onBlue : Theme.Palette.warn }

    var body: some View {
        HStack(alignment: .top, spacing: Platform.isPhone ? Theme.Space.s : Theme.Space.m) {
            if columnShown {
                Text(Reel.resolutionLabel(source.traits.resolution) ?? "–")
                    .font(Theme.Typeface.detailNumeral(Platform.isPhone ? 24 : 32))
                    .textCase(.uppercase)
                    .foregroundStyle(source.traits.resolution == .unknown ? secondary : (lit ? Theme.Palette.onBlue : Theme.Palette.red))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: column, alignment: .leading)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            }
            VStack(alignment: .leading, spacing: 4) {
                // The formats first, as mono capitals; raw add-on text replaces them when asked for.
                if !appearance.showRawText, let formats = formatLine {
                    Text(formats)
                        .font(Theme.Typeface.detailKey)
                        .detailCaps(0.1)
                        .foregroundStyle(primary)
                        .lineLimit(2)
                }
                Text(title)
                    .font(Theme.Typeface.custom(Theme.Face.condensedSemiBold, 18, .headline))
                    .foregroundStyle(primary)
                    .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                    .truncationMode(.middle)
                if appearance.showRawText {
                    let lines = summary.rawLines
                    if !lines.isEmpty {
                        Text(lines.joined(separator: "\n"))
                            .font(Theme.Typeface.caption)
                            .foregroundStyle(secondary)
                            .lineLimit(appearance.compact ? 3 : 8)
                            .multilineTextAlignment(.leading)
                    }
                } else if let size = summary.size, !typeSize.isAccessibilitySize {
                    Text(size)
                        .font(Theme.Typeface.caption)
                        .foregroundStyle(secondary)
                }
                if let words = summary.detail, !appearance.showRawText {
                    Text(words)
                        .font(Theme.Typeface.caption)
                        .foregroundStyle(secondary)
                        .lineLimit(1)
                }
                notes
                // On a phone the Play control goes under the facts, where it has the row's width.
                if isBest && Platform.isPhone { playPill.padding(.top, Theme.Space.xs) }
            }
            Spacer(minLength: Theme.Space.s)
            if isBest && !Platform.isPhone { playPill }
        }
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.vertical, vertical)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) {
            if showsDivider { RuleLine(thin: true) }
        }
        .contentShape(Rectangle())
        .opacity(source.isActionable ? 1 : 0.55)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel((lastPlayed ? "Last played, " : "") + (isBest ? "Best match, " : "") + summary.accessibilityLabel)
    }

    /// The release's own name is the title; the resolution has the column, unless the column is hidden.
    private var title: String {
        let text = summary.title ?? source.filename ?? source.providerName
        guard !columnShown, let resolution = Reel.resolutionLabel(source.traits.resolution) else { return text }
        let withSize = typeSize.isAccessibilitySize ? [summary.size].compactMap { $0 } : []
        return ([resolution, text] + withSize).joined(separator: " · ")
    }

    /// "DV · TRUEHD 7.1": what is different about this one, in capitals. Badges off (Settings → Source Appearance)
    /// leaves it out.
    private var formatLine: String? {
        guard appearance.badgePack != .none else { return nil }
        let parts = Reel.edgeFormat(hdr: source.traits.hdr, audioCodec: source.traits.audioCodec, audioChannels: source.traits.audioChannels)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Only the exceptions, in plain words: last played, not cached, needs debrid, no decoder for the video.
    @ViewBuilder
    private var notes: some View {
        let notCached = source.traits.isCached == false && source.category == .addons
        let needsDebrid: Bool = { if !source.isPlayable, case .torrent = source.location { return true }; return false }()
        let decoderNote = Reel.versionNote(for: source.traits, decodesAV1: Platform.decodesAV1, convertsLosslessAudio: false)
        // The best row says why it is the one: it plays as it is, with nothing to convert.
        let playsDirect = isBest && decoderNote?.isWarning != true
        if lastPlayed || notCached || needsDebrid || decoderNote != nil || playsDirect {
            VStack(alignment: .leading, spacing: 2) {
                if playsDirect {
                    Text("Plays direct" + (decoderNote.map { " · " + $0.text } ?? ""))
                        .font(Theme.Typeface.detailKey)
                        .detailCaps(0.1)
                        .foregroundStyle(primary)
                }
                if lastPlayed { Text("Last played").font(Theme.Typeface.caption).foregroundStyle(secondary) }
                if notCached { Text("Not cached").font(Theme.Typeface.caption).foregroundStyle(warning) }
                if needsDebrid { Text("Needs a debrid-enabled add-on").font(Theme.Typeface.caption).foregroundStyle(warning) }
                if let decoderNote, !playsDirect { Text(decoderNote.text).font(Theme.Typeface.caption).foregroundStyle(warning) }
            }
        }
    }

    /// Looks like the solid button, but it is the row that is tapped: a button inside a row's button would swallow the
    /// tap. It stays ink while the row is blue, so it never disappears into it.
    private var playPill: some View {
        Text(forDownload ? "Download" : "Play")
            .font(Theme.Typeface.control)
            .controlText()
            .foregroundStyle(Theme.Palette.bg)
            .padding(.horizontal, Theme.Space.m)
            .frame(minHeight: 36 * Theme.scale)
            .background(Theme.Palette.fg)
            .fixedSize()
    }
}

// MARK: - Pieces shared by the rows

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
            Rectangle().fill(Theme.Palette.tint2).frame(width: 48 * Theme.scale, height: 24 * Theme.scale)
                .frame(width: 64 * Theme.scale, alignment: .leading)
            VStack(alignment: .leading, spacing: 8 * Theme.scale) {
                Rectangle().fill(Theme.Palette.tint2).frame(width: 90 * Theme.scale, height: 12 * Theme.scale)
                Rectangle().fill(Theme.Palette.tint2).frame(width: 180 * Theme.scale, height: 16 * Theme.scale)
                Rectangle().fill(Theme.Palette.tint1).frame(width: 110 * Theme.scale, height: 10 * Theme.scale)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.vertical, Theme.Space.m)
        .overlay(alignment: .top) {
            if showsDivider { RuleLine(thin: true) }
        }
    }
}
