import SwiftUI
import FlowKit

/// Online subtitle search (OpenSubtitles, SubDL, Wyzie, SubSource) plus timing offset.
struct SubtitlePickerView: View {
    let session: PlaybackSession
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var tracks: [SubtitleTrackInfo] = []
    @State private var loading = true
    @State private var loadingTrack: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        Task { await session.selectSubtitle(nil); dismiss() }
                    } label: {
                        HStack {
                            Text("Off")
                            Spacer()
                            if session.subtitleTrack == nil { Image(systemName: "checkmark") }
                        }
                    }
                }
                Section("Timing") {
                    HStack {
                        Text("Offset")
                        Spacer()
                        Button { session.subtitleOffset -= 0.25 } label: { Image(systemName: "minus.circle") }
                        Text(String(format: "%+.2fs", session.subtitleOffset)).monospacedDigit().frame(minWidth: 70)
                        Button { session.subtitleOffset += 0.25 } label: { Image(systemName: "plus.circle") }
                    }
                    .buttonStyle(.borderless)
                }
                Section {
                    if loading {
                        HStack { ProgressView(); Text("Searching…").foregroundStyle(.secondary) }
                    } else if tracks.isEmpty {
                        Text(model.subtitleProviders().isEmpty
                             ? "Add a subtitle source key in Settings → Account → Subtitle Sources."
                             : "No subtitles found.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(tracks) { track in
                        Button {
                            loadingTrack = track.id
                            Task {
                                await session.selectSubtitle(track)
                                loadingTrack = nil
                                dismiss()
                            }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        Text(track.languageName).font(.headline)
                                        if track.hearingImpaired { Image(systemName: "ear").font(.caption) }
                                    }
                                    Text(track.release.isEmpty ? track.provider : track.release)
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    Text(track.provider + (track.downloads.map { " · \($0) downloads" } ?? ""))
                                        .font(.caption2).foregroundStyle(.tertiary)
                                }
                                Spacer()
                                if loadingTrack == track.id { ProgressView() }
                                else if session.subtitleTrack?.id == track.id { Image(systemName: "checkmark") }
                            }
                        }
                    }
                } header: {
                    Text("Online")
                }
            }
            .navigationTitle("Subtitles")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task {
                tracks = await SubtitleSearch.search(model.subtitleProviders(), request: session.request,
                                                     languages: model.settings.subtitles.preferredLanguages,
                                                     hearingImpaired: model.settings.subtitles.hearingImpaired)
                loading = false
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 520)
        #endif
    }
}
