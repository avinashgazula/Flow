import SwiftUI
#if os(macOS)
import AppKit
#endif
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
                    Task {
                        try? await Task.sleep(nanoseconds: 2_500_000_000)
                        // The info panel shows the DTS track being decoded to FLAC.
                        m.activePlayback?.showsInfo = true
                        if let info = m.activePlayback?.infoRows() { log("info: " + info.map { "\($0.label)=\($0.value)" }.joined(separator: "; ")) }
                        #if os(iOS)
                        // A scrubbing preview, as if a finger were on the scrubber.
                        m.activePlayback?.tourScrubPreview = 7
                        #endif
                    }
                } else {
                    log("no bundled MKV sample")
                }
            },
            Step(name: "player-still-watching") { m in
                #if os(iOS)
                m.activePlayback?.tourPanel = nil
                #endif
                m.activePlayback?.showsXRay = false
                m.activePlayback?.tourAskStillWatching(true)
            },
            Step(name: "player-suggestions") { m in
                m.activePlayback?.tourAskStillWatching(false)
                // Where the film ends: "Because You Watched".
                log("suggestions: \(m.activePlayback?.suggestions.count ?? -1) phase=\(String(describing: m.activePlayback?.phase))")
                m.activePlayback?.endWithSuggestions()
            },
            Step(name: "person") { m in m.activePlayback?.stop(); m.paths[.home] = [.detail(duneItem), .person(id: 1190668, name: "Timothée Chalamet")] },
            // Home once more after the player has saved a new resume point: it must agree with the Library's row.
            Step(name: "home-after-playback") { m in m.paths[.home] = []; m.selectedTab = .home },
            Step(name: "explore") { m in m.paths[.home] = []; m.selectedTab = .explore },
            Step(name: "library") { m in m.selectedTab = .library },
            Step(name: "library-watchlist") { m in m.paths[.library] = [.library(.watchlist)] },
            Step(name: "calendar") { m in m.paths[.library] = [.calendar] },
            Step(name: "search") { m in m.paths[.library] = []; m.selectedTab = .search; m.searchText = "the" },
            // A confident match, so the top result's poster shows beside the rows.
            Step(name: "search-top") { m in m.searchText = "dune" },
            Step(name: "livetv") { m in m.searchText = ""; m.selectedTab = .liveTV },
        ]
        #if os(iOS)
        // The player's options panel and Advanced Options, over the MKV sample.
        if let index = steps.firstIndex(where: { $0.name == "player-still-watching" }) {
            steps.insert(contentsOf: [
                Step(name: "player-options") { m in
                    m.activePlayback?.tourScrubPreview = nil
                    // A slow runner can still be remuxing; pausing before the picture starts would
                    // leave the panels over the connecting screen.
                    for _ in 0..<60 {
                        guard let phase = m.activePlayback?.phase, case .connecting = phase else { break }
                        try? await Task.sleep(nanoseconds: 250_000_000)
                    }
                    // Held still: the sample is short, and would otherwise end under the panels.
                    m.activePlayback?.player.pause()
                    m.activePlayback?.tourPanel = "options"
                },
                Step(name: "player-advanced") { m in m.activePlayback?.tourPanel = "advanced" },
                Step(name: "player-panels-closed") { m in m.activePlayback?.tourPanel = nil },
                Step(name: "player-xray") { m in m.activePlayback?.showsXRay = true },
            ], at: index)
        }
        #endif
        #if !os(macOS)
        steps += [
            Step(name: "settings") { m in
                // Apple TV's Settings is a tab: switching to Home in the same moment leaves it blank.
                #if !os(tvOS)
                m.selectedTab = .home
                #endif
                m.showSettings = true
            },
            Step(name: "settings-metadata") { m in m.settingsPath = [.settings(.metadata)] },
            Step(name: "settings-sources") { m in m.settingsPath = [.settings(.sources)] },
            Step(name: "settings-general") { m in m.settingsPath = [.settings(.general)] },
            Step(name: "settings-playback") { m in m.settingsPath = [.settings(.playback)] },
            Step(name: "settings-data") { m in m.settingsPath = [.settings(.dataStorage)] },
            Step(name: "settings-subtitles") { m in m.settingsPath = [.settings(.subtitles)] },
            Step(name: "settings-account") { m in m.settingsPath = [.settings(.account)] },
            Step(name: "settings-shelves") { m in m.settingsPath = [.settings(.shelves)] },
            Step(name: "settings-servers") { m in m.settingsPath = [.settings(.mediaServers)] },
            Step(name: "settings-webdav") { m in m.settingsPath = [.settings(.webDAV)] },
            Step(name: "settings-livetv") { m in m.settingsPath = [.settings(.liveTV)] },
        ]
        #else
        // The Mac's Settings is its own window; the pages open inside it.
        steps += [
            Step(name: "settings") { _ in NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) },
            Step(name: "settings-general") { m in m.settingsPath = [.settings(.general)] },
            Step(name: "settings-account") { m in m.settingsPath = [.settings(.account)] },
            Step(name: "settings-shelves") { m in m.settingsPath = [.settings(.shelves)] },
            Step(name: "settings-servers") { m in m.settingsPath = [.settings(.mediaServers)] },
            Step(name: "settings-webdav") { m in m.settingsPath = [.settings(.webDAV)] },
            Step(name: "settings-livetv") { m in m.settingsPath = [.settings(.liveTV)] },
            Step(name: "settings-sources") { m in m.settingsPath = [.settings(.sources)] },
            Step(name: "settings-data") { m in m.settingsPath = [.settings(.dataStorage)] },
            Step(name: "settings-playback") { m in m.settingsPath = [.settings(.playback)] },
            Step(name: "settings-subtitles") { m in m.settingsPath = [.settings(.subtitles)] },
            Step(name: "settings-metadata") { m in m.settingsPath = [.settings(.metadata)] },
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
