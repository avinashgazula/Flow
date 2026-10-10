import SwiftUI
import FlowKit
import FlowDecoders

/// Third-party software Flow ships, with its licence (FFmpeg, LGPL 2.1). A list rather than one long
/// text so it scrolls with the Siri Remote too.
struct LicencesView: View {
    private let paragraphs: [String] = FFmpegLicence.text
        .components(separatedBy: "\n\n")
        .map { $0.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }

    var body: some View {
        List {
            Section("FFmpeg") {
                Text(FFmpegLicence.notice)
            }
            Section("GNU Lesser General Public License 2.1") {
                ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Licences")
    }
}

struct GeneralSettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Form {
            Section("Appearance") {
                Picker("Accent Colour", selection: $model.settings.general.accent) {
                    ForEach(AccentColorChoice.allCases) { choice in
                        Label(choice.rawValue.capitalized, systemImage: "circle.fill").foregroundStyle(choice.color).tag(choice)
                    }
                }
                Toggle("Show Titles Under Posters", isOn: $model.settings.general.showPosterTitles)
                Toggle("Show Watched Check Marks", isOn: $model.settings.general.showWatchedBadges)
            }
            Section("Home") {
                Picker("Start On", selection: $model.settings.general.startTab) {
                    ForEach(AppTab.allCases) { Text($0.title).tag($0) }
                }
                Picker("Hero Shows", selection: $model.settings.general.heroSource) {
                    ForEach(HeroSource.allCases) { Text($0.title).tag($0) }
                }
                Toggle("Auto-Advance Hero", isOn: $model.settings.general.heroAutoAdvance)
            }
            #if os(iOS)
            Section {
                Toggle("Haptics", isOn: $model.settings.general.haptics)
            }
            #endif
            Section("About") {
                NavigationLink("Open Source Licences") { LicencesView() }
            }
        }
    }
}

struct PlaybackSettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                Picker("Preferred Resolution", selection: $model.settings.playback.preferredResolutionCap) {
                    ForEach([VideoResolution.uhd4k, .uhd1440, .hd1080, .hd720, .sd]) { Text($0 == .uhd4k ? "Up to 4K" : "Up to \($0.label)").tag($0) }
                }
            } footer: {
                Text("Sources above this resolution are hidden from the picker, whatever your source ordering.")
            }
            Section {
                Toggle("Auto-Play Next Episode", isOn: $model.settings.playback.autoPlayNextEpisode)
                Picker("Countdown", selection: $model.settings.playback.nextEpisodeCountdownSeconds) {
                    ForEach([5, 10, 15, 20, 30], id: \.self) { Text("\($0) seconds").tag($0) }
                }
                Toggle("Wait for the Episode to End", isOn: $model.settings.playback.upNextWaitsForEnd)
                Toggle("Reuse Last Source For Show", isOn: $model.settings.playback.rememberLastSourcePerShow)
            } header: {
                Text("Episodes")
            } footer: {
                Text("Up Next counts down as the credits start, or, with Wait for the Episode to End, so the next one begins as this one finishes.")
            }
            Section {
                Picker("Intro", selection: $model.settings.playback.skipIntro) { ForEach(SkipBehaviour.allCases) { Text($0.title).tag($0) } }
                Picker("Recap", selection: $model.settings.playback.skipRecap) { ForEach(SkipBehaviour.allCases) { Text($0.title).tag($0) } }
                Picker("Credits", selection: $model.settings.playback.skipCredits) { ForEach(SkipBehaviour.allCases) { Text($0.title).tag($0) } }
            } header: {
                Text("Skip Segments")
            } footer: {
                Text("Segments come from your media server (Jellyfin media segments, Plex markers), IntroDB, PublicMetaDB or the file's chapter names.")
            }
            Section {
                Toggle("Post-Credits Scene Alert", isOn: $model.settings.playback.postCreditsAlert)
                Toggle("Because You Watched", isOn: $model.settings.playback.becauseYouWatched)
            } header: {
                Text("Films")
            } footer: {
                Text("When a film has a scene during or after its credits, Flow says so as they begin and won't skip them by itself. Because You Watched suggests what to watch next as the credits roll, and when the film ends.")
            }
            Section("Resume & Progress") {
                Toggle("Ask Before Resuming", isOn: $model.settings.playback.askToResume)
                Picker("Mark Watched At", selection: $model.settings.playback.watchedThresholdPercent) {
                    ForEach([80.0, 85, 90, 95], id: \.self) { Text("\(Int($0))%").tag($0) }
                }
                Picker("Skip Back", selection: $model.settings.playback.seekBackwardSeconds) {
                    ForEach([5, 10, 15, 30], id: \.self) { Text("\($0)s").tag($0) }
                }
                Picker("Skip Forward", selection: $model.settings.playback.seekForwardSeconds) {
                    ForEach([5, 10, 15, 30], id: \.self) { Text("\($0)s").tag($0) }
                }
            }
            Section {
                Picker("Preferred Audio", selection: Binding(get: { model.settings.playback.preferredAudioLanguage ?? "" }, set: { model.settings.playback.preferredAudioLanguage = $0.isEmpty ? nil : $0 })) {
                    Text("Default").tag("")
                    ForEach(DiscoverFilterView.languages, id: \.0) { Text($0.1).tag($0.0) }
                }
                Toggle("Remember Tracks for Each Show", isOn: $model.settings.playback.rememberTracksPerShow)
                if !model.settings.playback.showTracks.isEmpty {
                    Button("Forget Remembered Tracks", role: .destructive) { model.settings.playback.showTracks = [:] }
                }
            } header: {
                Text("Audio")
            } footer: {
                Text("Pick Japanese audio and English subtitles once, and the rest of the show starts that way.")
            }
            Section {
                Toggle("Try the Next Source Automatically", isOn: $model.settings.playback.tryNextSourceOnFailure)
                Toggle("Decode DTS and Dolby TrueHD", isOn: $model.settings.playback.decodeLosslessAudio)
                Toggle("Prefer Sources With Playable Audio", isOn: $model.settings.sources.preferPlayableAudio)
                #if os(iOS) || os(macOS)
                Picker("MKV Files", selection: $model.settings.playback.matroskaPlayback) {
                    ForEach(MatroskaPlayback.allCases) { Text($0.title).tag($0) }
                }
                #endif
            } header: {
                Text("Formats")
            } footer: {
                Text("Flow plays MKV files itself by repackaging them on the fly for Apple's player, without re-encoding: HDR, Dolby Vision, Dolby Atmos, embedded and disc subtitles and chapters all come through, and DTS and TrueHD are decoded to lossless FLAC. When a file still can't play, Flow moves to the next source or offers your external player.")
            }
            #if os(iOS) || os(macOS)
            Section {
                Picker("Player", selection: $model.settings.playback.externalPlayer) {
                    ForEach(Platform.externalPlayers) { Text($0.title).tag($0) }
                }
                #if os(iOS)
                Toggle("Picture in Picture", isOn: $model.settings.playback.pictureInPicture)
                #endif
            } header: {
                Text("Player")
            } footer: {
                Text("Another player gets the stream's link (Infuse also the resume point). Flow tracks progress only in its own player.")
            }
            #endif
        }
    }
}

struct SubtitleSettingsView: View {
    @Environment(AppModel.self) private var model

    private static let languageOptions: [(String, String)] = [
        ("en", "English"), ("es", "Spanish"), ("fr", "French"), ("de", "German"), ("it", "Italian"), ("pt", "Portuguese"),
        ("nl", "Dutch"), ("sv", "Swedish"), ("da", "Danish"), ("no", "Norwegian"), ("fi", "Finnish"), ("pl", "Polish"),
        ("ru", "Russian"), ("tr", "Turkish"), ("ar", "Arabic"), ("hi", "Hindi"), ("ta", "Tamil"), ("te", "Telugu"),
        ("ja", "Japanese"), ("ko", "Korean"), ("zh", "Chinese"), ("he", "Hebrew"), ("el", "Greek"), ("cs", "Czech"),
    ]

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                ForEach(Self.languageOptions, id: \.0) { code, name in
                    let index = model.settings.subtitles.preferredLanguages.firstIndex(of: code)
                    Button {
                        if let index { model.settings.subtitles.preferredLanguages.remove(at: index) }
                        else { model.settings.subtitles.preferredLanguages.append(code) }
                    } label: {
                        HStack {
                            Text(name).foregroundStyle(.primary)
                            Spacer()
                            if let index { Text("\(index + 1)").font(.caption.weight(.bold)).foregroundStyle(.tint) }
                        }
                    }
                }
            } header: {
                Text("Preferred Languages")
            } footer: {
                Text("Tap in order of preference. Numbers show the order used to rank search results.")
            }
            Section("Behaviour") {
                Toggle("Load Automatically", isOn: $model.settings.subtitles.autoEnable)
                Toggle("Prefer Hearing Impaired", isOn: $model.settings.subtitles.hearingImpaired)
                Picker("Default Offset", selection: $model.settings.subtitles.defaultOffsetSeconds) {
                    ForEach([-2.0, -1, -0.5, 0, 0.5, 1, 2], id: \.self) { Text(String(format: "%+.1fs", $0)).tag($0) }
                }
            }
            Section("Style") {
                Picker("Size", selection: $model.settings.subtitles.fontScale) {
                    Text("Small").tag(0.8)
                    Text("Medium").tag(1.0)
                    Text("Large").tag(1.25)
                    Text("Extra Large").tag(1.5)
                }
                Picker("Colour", selection: $model.settings.subtitles.color) {
                    ForEach(SubtitleColor.allCases) { Text($0.rawValue.capitalized).tag($0) }
                }
                Picker("Background", selection: $model.settings.subtitles.background) {
                    ForEach(SubtitleBackground.allCases) { Text($0.rawValue.capitalized).tag($0) }
                }
                SubtitleOverlay(text: "The quick brown fox jumps over the lazy dog.", settings: model.settings.subtitles)
                    .frame(height: 90)
                    .background(LinearGradient(colors: [.gray, .black], startPoint: .top, endPoint: .bottom), in: RoundedRectangle(cornerRadius: 10))
            }
            Section("Sources") {
                ForEach([("opensubtitles", "OpenSubtitles"), ("subdl", "SubDL"), ("wyzie", "Wyzie (no key)"), ("subsource", "SubSource")], id: \.0) { id, name in
                    Toggle(name, isOn: Binding(
                        get: { model.settings.subtitles.enabledProviders.contains(id) },
                        set: { on in
                            model.settings.subtitles.enabledProviders.removeAll { $0 == id }
                            if on { model.settings.subtitles.enabledProviders.append(id) }
                        }))
                }
                NavigationLink("Subtitle Keys", value: Route.settings(.apiKeys))
            }
        }
    }
}

struct MetadataSettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                Picker("Episode Source", selection: $model.settings.metadata.episodeSource) {
                    ForEach(EpisodeSource.allCases) { Text($0.title).tag($0) }
                }
                Toggle("Air dates in my time zone", isOn: $model.settings.metadata.airDatesInLocalTimeZone)
            } header: {
                Text("Episode Data")
            } footer: {
                Text("Sets where season/episode numbering, episode titles, and air dates come from. TVDB matches the numbering most stream sources use, so multi-part premieres and other ordering edge cases line up correctly. Trakt and TMDB use their own ordering. Posters and episode stills always come from TMDB. Takes effect on the next show you open.")
            }
            Section {
                Toggle("Show Unreleased Titles", isOn: $model.settings.metadata.showUnreleasedTitles)
            } header: {
                Text("Availability")
            } footer: {
                Text("Switch this off and Flow uses TMDb release dates to drop titles you can't play yet — a film with only a cinema release, or one that hasn't opened at all — from home shelves, the hero, Show All, Discover and the trending rows.\n\nRows that exist to show what's coming are left alone: watchlists, Continue Watching, Upcoming, Now Playing, Anticipated, calendars, and any Discover shelf you pointed at future dates. Search still finds everything, so you can add a title before it's out.")
            }
            Section("Source") {
                Picker("Primary Source", selection: $model.settings.metadata.primarySource) {
                    ForEach(PrimaryMetadataSource.allCases) { Text($0.title).tag($0) }
                }
            }
            Section {
                Picker("TMDb Language", selection: $model.settings.metadata.language) {
                    ForEach(Self.languages, id: \.0) { Text($0.1).tag($0.0) }
                }
                Picker("Region", selection: $model.settings.metadata.region) {
                    ForEach(Self.regions, id: \.self) { Text(Locale.current.localizedString(forRegionCode: $0) ?? $0).tag($0) }
                }
                Toggle("Include Adult Titles", isOn: $model.settings.metadata.includeAdult)
            } header: {
                Text("Language")
            } footer: {
                Text("Changes the language for titles, descriptions, and other metadata from TMDb. Region sets certifications and streaming providers.")
            }
            Section {
                OptionalTextField(title: "TMDb API Key", text: $model.credentials.tmdbAPIKey, secure: true, prompt: BundleKeys.tmdb == nil ? "v3 key or v4 read token" : "Using built-in key")
                Link("Get a free key at themoviedb.org", destination: URL(string: "https://www.themoviedb.org/settings/api")!)
            } header: {
                Text("TMDb API Key")
            }
            Section {
                OptionalTextField(title: "TVDB API Key", text: $model.credentials.tvdbAPIKey, secure: true, prompt: BundleKeys.tvdb == nil ? "v4 project key" : "Using built-in key")
            } header: {
                Text("TVDB API Key")
            } footer: {
                Text("Needed for the TVDB episode source. Without it Flow falls back to TMDb ordering.")
            }
        }
    }

    static let languages: [(String, String)] = [
        ("en-US", "English"), ("en-GB", "English (UK)"), ("es-ES", "Spanish"), ("es-MX", "Spanish (Latin America)"), ("fr-FR", "French"),
        ("de-DE", "German"), ("it-IT", "Italian"), ("pt-BR", "Portuguese (Brazil)"), ("pt-PT", "Portuguese"), ("nl-NL", "Dutch"),
        ("sv-SE", "Swedish"), ("da-DK", "Danish"), ("nb-NO", "Norwegian"), ("fi-FI", "Finnish"), ("pl-PL", "Polish"), ("ru-RU", "Russian"),
        ("tr-TR", "Turkish"), ("ja-JP", "Japanese"), ("ko-KR", "Korean"), ("zh-CN", "Chinese (Simplified)"), ("zh-TW", "Chinese (Traditional)"),
        ("hi-IN", "Hindi"), ("ta-IN", "Tamil"), ("te-IN", "Telugu"), ("ar-SA", "Arabic"), ("he-IL", "Hebrew"),
    ]

    static let regions = ["US", "CA", "GB", "IE", "AU", "NZ", "IN", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "DK", "FI", "BR", "MX", "JP", "KR"]
}
