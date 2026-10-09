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

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if ranked.isEmpty && finished {
                        ContentUnavailableView {
                            Label("No Sources", systemImage: "tray")
                        } description: {
                            Text(model.sourceProviders().isEmpty
                                 ? "Add a media server, WebDAV share, IPTV provider or stream add-on in Settings."
                                 : "None of your sources have this title.")
                        }
                    }
                    ForEach(ranked) { source in
                        Button { choose(source) } label: {
                            SourceRow(source: source, appearance: model.settings.sources.appearance)
                        }
                        .buttonStyle(.plain)
                        .disabled(!source.isPlayable && !isExternal(source))
                    }
                } header: {
                    HStack {
                        Text("\(ranked.count) sources").font(.title3.weight(.semibold)).textCase(nil)
                        Spacer()
                        if !finished { ProgressView() }
                    }
                }

                if !pending.isEmpty || !failures.isEmpty {
                    Section("Providers") {
                        ForEach(pending.sorted { $0.value < $1.value }, id: \.key) { _, name in
                            HStack { Text(name); Spacer(); ProgressView() }
                        }
                        ForEach(failures.sorted { $0.key < $1.key }, id: \.key) { id, error in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(providerName(id)).font(.subheadline)
                                Text(error).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                }
            }
            .navigationTitle(request.episode.map { "\(request.item.title) · \($0.code)" } ?? request.item.title)
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { reloadToken += 1 } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(!finished)
                }
            }
            .task(id: reloadToken) { await gather() }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 600)
        #endif
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

    var body: some View {
        VStack(alignment: .leading, spacing: appearance.compact ? 4 : 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(headline).font(.headline).lineLimit(1)
                Spacer()
                if appearance.showSize, let size = source.traits.sizeBytes {
                    Text(StreamParser.formatBytes(size)).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            if appearance.showRawText {
                let lines = bodyLines
                if !lines.isEmpty {
                    Text(lines.joined(separator: "\n"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(appearance.compact ? 3 : 8)
                }
            } else {
                parsedSummary
            }
            if appearance.badgePack != .none && !badges.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(badges, id: \.self) { badge in
                        Text(badge)
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(color(for: badge), in: RoundedRectangle(cornerRadius: 6))
                            .foregroundStyle(appearance.badgePack == .colored && isHighlight(badge) ? .white : .primary)
                    }
                }
            }
            if !source.isPlayable, case .torrent = source.location {
                Label("Torrent — needs a debrid add-on", systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
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
        let parts = [t.quality == .unknown ? nil : t.quality.rawValue, t.languages.isEmpty ? nil : t.languages.joined(separator: " · "), t.releaseGroup].compactMap { $0 }
        return Text(parts.joined(separator: " • ")).font(.subheadline).foregroundStyle(.secondary)
    }

    private var badges: [String] {
        var out = source.traits.badges
        if appearance.badgePack == .minimal { out = Array(out.prefix(2)) }
        if source.traits.isCached == true && source.category == .addons { out.append("⚡︎") }
        return out
    }

    private func isHighlight(_ badge: String) -> Bool {
        ["4K", "1080p", "720p", "1440p", "DV", "HDR", "HDR10+", "DD+", "DD", "Atmos", "TrueHD Atmos"].contains(badge)
    }

    private func color(for badge: String) -> Color {
        guard appearance.badgePack == .colored else { return Color.white.opacity(0.12) }
        switch badge {
        case "4K", "1440p": return .orange.opacity(0.85)
        case "1080p": return .green.opacity(0.8)
        case "720p": return .blue.opacity(0.7)
        case "DV", "HDR", "HDR10+", "HLG": return .purple.opacity(0.75)
        case "DD", "DD+", "Atmos", "TrueHD Atmos", "TrueHD": return .teal.opacity(0.7)
        default: return Color.white.opacity(0.12)
        }
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
