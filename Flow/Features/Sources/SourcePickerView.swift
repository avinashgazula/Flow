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
        SourceRanker.rank(raw, settings: model.settings.sources, resolutionCap: model.settings.playback.preferredResolutionCap)
    }

    private var grouped: [(SourceCategory, [StreamSource])] {
        let order = model.settings.sources.categoryOrder
        let groups = Dictionary(grouping: ranked, by: \.category)
        return order.compactMap { cat in groups[cat].map { (cat, $0) } }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.l) {
                    header
                    providerStatus
                    if ranked.isEmpty && !finished {
                        VStack(spacing: Theme.Space.s) {
                            ForEach(0..<3, id: \.self) { _ in
                                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                    .fill(Theme.Palette.surface).frame(height: 96 * Theme.scale)
                            }
                        }
                        .shimmering()
                    } else if ranked.isEmpty {
                        ContentUnavailableView {
                            Label("No Sources", systemImage: "play.slash")
                        } description: {
                            Text(model.sourceProviders().isEmpty
                                 ? "Add a media server, WebDAV share, IPTV provider or stream add-on in Settings."
                                 : "None of your sources have this title yet.")
                        }
                        .padding(.top, Theme.Space.xl)
                    }
                    ForEach(grouped, id: \.0) { category, sources in
                        VStack(alignment: .leading, spacing: Theme.Space.s) {
                            if grouped.count > 1 {
                                Text(category.displayName.uppercased())
                                    .font(Theme.Typeface.micro).kerning(1.2)
                                    .foregroundStyle(Theme.Palette.textTertiary)
                            }
                            ForEach(sources) { source in
                                Button { choose(source) } label: {
                                    SourceRow(source: source, appearance: model.settings.sources.appearance)
                                }
                                .buttonStyle(CardButtonStyle())
                                .disabled(!source.isPlayable && !isExternal(source))
                            }
                        }
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.bottom, Theme.Space.xxl)
                .animation(Theme.Motion.gentle, value: ranked.map(\.id))
            }
            .background(AmbientBackground(url: request.item.smallBackdropURL ?? request.item.posterURL, intensity: 0.7))
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { reloadToken += 1 } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(!finished)
                        .accessibilityLabel("Search Again")
                }
            }
            .task(id: reloadToken) { await gather() }
        }
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 640)
        #endif
    }

    private var header: some View {
        HStack(alignment: .center, spacing: Theme.Space.m) {
            RemoteImage(url: request.item.posterURL, maxPixel: 300, fallbackTitle: request.item.title)
                .frame(width: 64 * Theme.scale, height: 96 * Theme.scale)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .hairline(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(request.item.title).font(Theme.Typeface.title).displayTracking().lineLimit(2)
                if let ep = request.episode {
                    Text("\(ep.code) · \(ep.title)").font(Theme.Typeface.body).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                }
                Text(finished ? "\(ranked.count) source\(ranked.count == 1 ? "" : "s")" : "Finding sources…")
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(Theme.Palette.textTertiary)
                    .contentTransition(.numericText())
            }
            Spacer(minLength: 0)
        }
        .padding(.top, Theme.Space.s)
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

    private func isExternal(_ source: StreamSource) -> Bool {
        if case .external = source.location { return true }
        return false
    }

    private func providerName(_ id: String) -> String {
        model.sourceProviders().first { $0.providerID == id }?.providerName ?? id
    }

    private func gather() async {
        raw = []
        failures = [:]
        finished = false
        let providers = model.sourceProviders()
        for await update in SourceAggregator.stream(providers, request: request, timeout: model.settings.sources.timeoutSeconds) {
            switch update {
            case .loading(let id, let name): pending[id] = name
            case .loaded(let id, let sources):
                pending[id] = nil
                raw += sources
                maybeAutoPlay()
            case .failed(let id, _, let error):
                pending[id] = nil
                failures[id] = error
            case .finished:
                finished = true
                maybeAutoPlay(final: true)
            }
        }
    }

    /// With "auto-play first source" on, start as soon as every provider answered.
    private func maybeAutoPlay(final: Bool = false) {
        guard final, !forDownload, !autoPlayed, model.settings.sources.autoPlayFirstSource,
              let first = ranked.first(where: \.isPlayable) else { return }
        autoPlayed = true
        choose(first)
    }

    private func choose(_ source: StreamSource) {
        if forDownload {
            if let error = DownloadManager.shared.start(source: source, request: request) {
                model.showToast(error)
            } else {
                model.showToast("Downloading \(request.displayTitle)")
                dismiss()
            }
        } else {
            model.startPlayback(source, request: request)
        }
    }
}

struct SourceRow: View {
    let source: StreamSource
    let appearance: SourceAppearance

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous) }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.m) {
            VStack(alignment: .leading, spacing: appearance.compact ? 4 : 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(headline).font(Theme.Typeface.headline).lineLimit(1)
                    Spacer()
                    if appearance.showSize, let size = source.traits.sizeBytes {
                        Text(StreamParser.formatBytes(size))
                            .font(.system(.footnote, weight: .medium).monospacedDigit())
                            .foregroundStyle(Theme.Palette.textSecondary)
                    }
                }
                if appearance.showRawText {
                    let lines = bodyLines
                    if !lines.isEmpty {
                        Text(lines.joined(separator: "\n"))
                            .font(.system(.footnote))
                            .foregroundStyle(Theme.Palette.textSecondary)
                            .lineLimit(appearance.compact ? 3 : 8)
                            .multilineTextAlignment(.leading)
                    }
                } else {
                    parsedSummary
                }
                if appearance.badgePack != .none && !badges.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(badges, id: \.self) { badge in
                            Text(badge)
                                .font(.system(size: 11 * Theme.scale, weight: .bold))
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(color(for: badge), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                                .foregroundStyle(textColor(for: badge))
                        }
                    }
                }
                if !source.isPlayable, case .torrent = source.location {
                    Label("Needs a debrid-enabled add-on", systemImage: "exclamationmark.circle").font(Theme.Typeface.caption).foregroundStyle(.orange)
                }
            }
            Image(systemName: "play.fill")
                .font(.system(size: 13 * Theme.scale, weight: .bold))
                .foregroundStyle(.black)
                .frame(width: 34 * Theme.scale, height: 34 * Theme.scale)
                .background(.white, in: Circle())
                .opacity(source.isPlayable ? 1 : 0.3)
        }
        .padding(Theme.Space.m)
        .background(Theme.Palette.surface, in: shape)
        .hairline(shape)
        .contentShape(shape)
    }

    private var headline: String {
        switch appearance.titleDisplay {
        case .provider: return source.providerName
        case .filename: return source.filename ?? source.providerName
        case .addonName: return source.title.components(separatedBy: "\n").first ?? source.providerName
        }
    }

    /// The add-on's own text minus the first line (usually its name).
    private var bodyLines: [String] {
        var lines = (source.detail ?? source.title).components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if lines.first == headline { lines.removeFirst() }
        return lines
    }

    private var parsedSummary: some View {
        let t = source.traits
        let parts = [t.quality == .unknown ? nil : t.quality.rawValue, t.languages.isEmpty ? nil : t.languages.joined(separator: " · "), t.releaseGroup?.uppercased()].compactMap { $0 }
        return VStack(alignment: .leading, spacing: 2) {
            if !parts.isEmpty {
                Text(parts.joined(separator: " · ")).font(.system(.footnote)).foregroundStyle(Theme.Palette.textSecondary)
            }
            if let filename = source.filename, appearance.titleDisplay != .filename {
                Text(filename).font(.system(.caption2)).foregroundStyle(Theme.Palette.textTertiary).lineLimit(1).truncationMode(.middle)
            }
        }
    }

    private var badges: [String] {
        var out = source.traits.badges
        if appearance.badgePack == .minimal { out = Array(out.prefix(2)) }
        if source.traits.isCached == true && source.category == .addons { out.append("Cached") }
        return out
    }

    private func color(for badge: String) -> Color {
        guard appearance.badgePack == .colored else { return Color.white.opacity(0.12) }
        switch badge {
        case "4K", "1440p": return Theme.Palette.gold.opacity(0.9)
        case "1080p": return Color(red: 0.2, green: 0.78, blue: 0.45).opacity(0.85)
        case "720p": return Color(red: 0.25, green: 0.55, blue: 0.95).opacity(0.75)
        case "DV", "HDR", "HDR10+", "HLG": return Color(red: 0.62, green: 0.4, blue: 0.95).opacity(0.85)
        case "DD", "DD+", "Atmos", "TrueHD Atmos", "TrueHD", "DTS-HD MA", "DTS:X": return Color(red: 0.15, green: 0.65, blue: 0.7).opacity(0.8)
        case "Cached": return Color.white.opacity(0.2)
        default: return Color.white.opacity(0.12)
        }
    }

    private func textColor(for badge: String) -> Color {
        appearance.badgePack == .colored && ["4K", "1440p"].contains(badge) ? .black : .white
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

/// Wrapping horizontal layout for badges.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            maxX = max(maxX, x)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(maxX, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
