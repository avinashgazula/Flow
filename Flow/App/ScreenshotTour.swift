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
            Step(name: "welcome") { m in m.previewOnboarding = true },
            Step(name: "home") { m in m.previewOnboarding = false; m.selectedTab = .home; m.paths[.home] = [] },
            Step(name: "detail-movie") { m in m.paths[.home] = [.detail(duneItem)] },
            Step(name: "detail-show") { m in m.paths[.home] = [.detail(bbItem)] },
            Step(name: "sources") { m in await m.play(duneItem) },
            Step(name: "player") { m in
                if let source = try? await DemoSourceProvider().sources(for: PlaybackRequest(item: duneItem)).first {
                    m.startPlayback(source, request: PlaybackRequest(item: duneItem))
                    Task {
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                        m.activePlayback?.showsInfo = true
                    }
                }
            },
            Step(name: "player-mkv") { m in
                m.activePlayback?.stop()
                try? await Task.sleep(nanoseconds: 600_000_000)
                if let source = try? await DemoSourceProvider().sources(for: PlaybackRequest(item: duneItem)).first(where: { $0.id == DemoSourceProvider.matroskaSampleID }) {
                    m.startPlayback(source, request: PlaybackRequest(item: duneItem))
                    #if os(iOS)
                    // Show a scrubbing preview, as if a finger were on the scrubber.
                    Task {
                        try? await Task.sleep(nanoseconds: 2_500_000_000)
                        m.activePlayback?.tourScrubPreview = 7
                    }
                    #endif
                } else {
                    log("no bundled MKV sample")
                }
            },
            // Opus in fragmented MP4 isn't in Apple's HLS spec; this records whether AVPlayer takes it.
            Step(name: "opus-probe") { m in
                m.activePlayback?.stop()
                try? await Task.sleep(nanoseconds: 600_000_000)
                guard let url = Bundle.main.url(forResource: "FlowOpusProbe", withExtension: "mkv") else { return log("no Opus probe") }
                let probe = StreamSource(id: "probe#opus", category: .addons, providerID: "probe", providerName: "Opus probe",
                                         title: "Opus probe", filename: "FlowOpusProbe.mkv", location: .url(url, headers: [:]))
                m.startPlayback(probe, request: PlaybackRequest(item: duneItem))
            },
            Step(name: "person") { m in m.activePlayback?.stop(); m.paths[.home] = [.detail(duneItem), .person(id: 1190668, name: "Timothée Chalamet")] },
            Step(name: "explore") { m in m.paths[.home] = []; m.selectedTab = .explore },
            Step(name: "library") { m in m.selectedTab = .library },
            Step(name: "calendar") { m in m.paths[.library] = [.calendar] },
            Step(name: "search") { m in m.paths[.library] = []; m.selectedTab = .search; m.searchText = "the" },
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

    static var logURL: URL {
        (ProcessInfo.processInfo.environment["FLOW_TOUR_FILE"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("flow-tour-step")).appendingPathExtension("log")
    }

    /// Appends a diagnostic line while a tour is running; no-op otherwise.
    static func log(_ message: String) {
        guard isRequested else { return }
        let line = "\(Date().formatted(.iso8601)) \(message)\n"
        if let handle = try? FileHandle(forWritingTo: logURL) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? line.write(to: logURL, atomically: true, encoding: .utf8)
        }
    }

    static func run(_ model: AppModel) async {
        let file = ProcessInfo.processInfo.environment["FLOW_TOUR_FILE"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("flow-tour-step")
        let dwell = Double(ProcessInfo.processInfo.environment["FLOW_TOUR_DWELL"] ?? "") ?? 7
        try? await Task.sleep(nanoseconds: 4_000_000_000)
        for (index, step) in steps().enumerated() {
            await step.action(model)
            log("step \(step.name) active=\(model.activePlayback != nil) picker=\(model.sourcePickerRequest != nil) tab=\(model.selectedTab)")
            try? "\(index):\(step.name)".write(to: file, atomically: true, encoding: .utf8)
            try? await Task.sleep(nanoseconds: UInt64(dwell * 1_000_000_000))
            // Simulator screenshots can be slow; hold the screen until the capture script confirms it.
            let ack = file.appendingPathExtension("ack")
            for _ in 0..<60 {
                if (try? String(contentsOf: ack, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) == "\(index)" { break }
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
        }
        try? "done".write(to: file, atomically: true, encoding: .utf8)
    }
}
