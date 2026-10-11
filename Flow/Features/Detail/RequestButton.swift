import SwiftUI
import FlowKit

/// Asks the user's Seerr instance for a title that isn't on any of their media servers.
/// Invisible unless Seerr is connected, the title isn't in the library, and it isn't already available.
struct RequestButton: View {
    let item: MediaItem
    let seasons: [Season]
    @Environment(AppModel.self) private var model
    @State private var status: SeerrMediaStatus?
    @State private var working = false
    @State private var choosingSeasons = false

    private var config: SeerrConfig? { model.settings.mediaServers.seerr }
    private var latestSeason: Int? { seasons.filter { !$0.isSpecials }.map(\.number).max() }

    var body: some View {
        Group {
            if config != nil, !model.isOnServer(item), let status, status != .available {
                button(status)
            }
        }
        .task(id: "\(item.id)|\(config?.baseURL.absoluteString ?? "")|\(config?.apiKey ?? "")") { await load() }
        .confirmationDialog("Request \(item.title)", isPresented: $choosingSeasons, titleVisibility: .visible) {
            Button("All Seasons") { Task { await request(.all) } }
            if let latest = latestSeason, seasons.filter({ !$0.isSpecials }).count > 1 {
                Button("Latest Season (\(latest))") { Task { await request(.only([latest])) } }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func button(_ status: SeerrMediaStatus) -> some View {
        Button {
            if item.type == .show { choosingSeasons = true } else { Task { await request(.all) } }
        } label: {
            HStack(spacing: Theme.Space.xs) {
                if working { ProgressView() } else { Image(systemName: symbol(status)) }
                Text(label(status))
            }
        }
        .buttonStyle(GlassButtonStyle())
        .disabled(!status.canRequest || working)
        .accessibilityLabel(label(status))
    }

    private func label(_ status: SeerrMediaStatus) -> String {
        switch status {
        case .notRequested, .partiallyAvailable: return "Request"
        case .pending: return "Requested"
        case .processing: return "Processing"
        case .available: return "Available"
        }
    }

    private func symbol(_ status: SeerrMediaStatus) -> String {
        switch status {
        case .notRequested, .partiallyAvailable: return "plus.circle"
        case .pending: return "clock"
        case .processing: return "arrow.triangle.2.circlepath"
        case .available: return "checkmark.circle"
        }
    }

    private func load() async {
        status = nil
        guard let config, let id = item.ids.tmdb, !model.isOnServer(item) else { return }
        // A failed lookup just hides the button; the settings screen is where connection problems surface.
        status = try? await SeerrClient(config: config, http: model.http).mediaStatus(type: item.type, tmdbID: id)
    }

    private func request(_ seasons: SeerrSeasons) async {
        guard let config, let id = item.ids.tmdb else { return }
        working = true
        defer { working = false }
        do {
            try await SeerrClient(config: config, http: model.http).request(type: item.type, tmdbID: id, seasons: seasons)
            status = .pending
            model.showToast("Requested \(item.title)")
        } catch {
            model.showToast(error.localizedDescription)
        }
    }
}
