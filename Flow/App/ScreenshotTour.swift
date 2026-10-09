import SwiftUI
import FlowKit

/// Drives the app through its main screens for automated screenshots (`-FlowTour YES`).
/// Each step writes "index:name" to `FLOW_TOUR_FILE`, so CI knows when to capture.
@MainActor
enum ScreenshotTour {
    static var isRequested: Bool { UserDefaults.standard.bool(forKey: "FlowTour") }

    struct Step {
        let name: String
        let action: (AppModel) async -> Void
    }

    static func steps() -> [Step] {
        let dune = DemoCatalog.title(693134)!
        let breakingBad = DemoCatalog.title(1396)!
        let duneItem = item(dune)
        let bbItem = item(breakingBad)
        var steps: [Step] = [
            Step(name: "home") { m in m.selectedTab = .home; m.paths[.home] = [] },
            Step(name: "detail-movie") { m in m.paths[.home] = [.detail(duneItem)] },
            Step(name: "detail-show") { m in m.paths[.home] = [.detail(bbItem)] },
            Step(name: "sources") { m in await m.play(duneItem) },
            Step(name: "player") { m in
                if let source = try? await DemoSourceProvider().sources(for: PlaybackRequest(item: duneItem)).first {
                    m.startPlayback(source, request: PlaybackRequest(item: duneItem))
                }
            },
            Step(name: "explore") { m in m.activePlayback?.stop(); m.paths[.home] = []; m.selectedTab = .explore },
            Step(name: "library") { m in m.selectedTab = .library },
            Step(name: "search") { m in m.selectedTab = .search; m.searchText = "the" },
            Step(name: "livetv") { m in m.searchText = ""; m.selectedTab = .liveTV },
        ]
        #if !os(macOS)
        steps += [
            Step(name: "settings") { m in m.selectedTab = .home; m.showSettings = true },
            Step(name: "settings-metadata") { m in m.settingsPath = [.settings(.metadata)] },
            Step(name: "settings-sources") { m in m.settingsPath = [.settings(.sources)] },
        ]
        #endif
        return steps
    }

    static func item(_ t: DemoCatalog.Title) -> MediaItem {
        MediaItem(type: t.type, ids: ExternalIDs(tmdb: t.id, imdb: t.imdb), title: t.title, overview: t.overview, posterPath: t.poster, backdropPath: t.backdrop,
                  releaseDate: FlowDate.parse("\(t.year)-06-15"), runtimeMinutes: t.runtime, voteAverage: t.rating)
    }

    static func run(_ model: AppModel) async {
        let file = ProcessInfo.processInfo.environment["FLOW_TOUR_FILE"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("flow-tour-step")
        let dwell = Double(ProcessInfo.processInfo.environment["FLOW_TOUR_DWELL"] ?? "") ?? 7
        try? await Task.sleep(nanoseconds: 4_000_000_000)
        for (index, step) in steps().enumerated() {
            await step.action(model)
            try? "\(index):\(step.name)".write(to: file, atomically: true, encoding: .utf8)
            try? await Task.sleep(nanoseconds: UInt64(dwell * 1_000_000_000))
        }
        try? "done".write(to: file, atomically: true, encoding: .utf8)
    }
}
