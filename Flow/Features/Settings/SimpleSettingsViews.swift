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
            #if os(iOS)
            AppIconSection()
            #endif
            NavigationSettingsSection()
            #if !os(tvOS)
            NotificationsSection()
            #endif
            Section("Appearance") {
                Picker("Accent Colour", selection: $model.settings.general.accent) {
                    ForEach(AccentColorChoice.allCases) { choice in
                        Label(choice == .white ? "Flow" : choice.rawValue.capitalized, systemImage: "circle.fill").foregroundStyle(choice.color).tag(choice)
                    }
                }
                Toggle("Show Watched Check Marks", isOn: $model.settings.general.showWatchedBadges)
            }
            Section("Home") {
                Picker("Top Pick From", selection: $model.settings.general.heroSource) {
                    ForEach(HeroSource.allCases) { Text($0.title).tag($0) }
                }
            }
            Section {
                Toggle("About", isOn: $model.settings.general.showAboutSection)
                Toggle("Where to Watch", isOn: $model.settings.general.showWhereToWatch)
                Toggle("Reviews", isOn: $model.settings.general.showReviews)
                Toggle("Episode Spoilers", isOn: $model.settings.general.showEpisodeSpoilers)
                Toggle("Specials Season", isOn: $model.settings.general.showSpecialsSeason)
            } header: {
                Text("Detail Views")
            } footer: {
                Text("About always lists the release date, runtime, director and rating at the foot of the page; this adds status, language, country, budget, revenue and production companies. Where to Watch shows streaming, rent and buy availability (JustWatch via TMDB). Reviews shows TMDB and Trakt reviews. Episode Spoilers off blurs the stills of aired episodes you haven't watched. Specials Season adds season 0 to a show's seasons.")
            }
            Section {
                Picker("Content Shelf Length", selection: $model.settings.general.contentShelfLength) {
                    ForEach([10, 20, 30, 40], id: \.self) { Text("\($0)").tag($0) }
                }
                Toggle("Show Continue Watching", isOn: $model.settings.general.showContinueWatching)
                Picker("Shelf Limit", selection: $model.settings.general.continueWatchingLimit) {
                    Text("All").tag(Int?.none)
                    ForEach([5, 10, 20], id: \.self) { Text("\($0)").tag(Int?.some($0)) }
                }
                .disabled(!model.settings.general.showContinueWatching)
                Toggle("Show Continue Watching Release Date", isOn: $model.settings.general.showContinueWatchingReleaseDate)
                    .disabled(!model.settings.general.showContinueWatching)
                Toggle("Show Upcoming", isOn: Binding(
                    get: { model.settings.general.showUpcoming },
                    set: { on in
                        model.settings.general.showUpcoming = on
                        if on { model.ensureUpcomingShelf() }
                    }
                ))
                Toggle("Include Watchlist Premieres", isOn: $model.settings.general.includeWatchlistPremieres)
                    .disabled(!model.settings.general.showUpcoming)
                Picker("Film Dates", selection: $model.settings.general.filmDates) {
                    ForEach(FilmDateKind.allCases) { Text($0.title).tag($0) }
                }
                .disabled(!model.settings.general.showUpcoming || !model.settings.general.includeWatchlistPremieres)
                Picker("Upcoming Within", selection: $model.settings.general.upcomingWithinDays) {
                    ForEach([3, 7, 14, 30], id: \.self) { Text("\($0) days").tag($0) }
                }
                .disabled(!model.settings.general.showUpcoming)
            } header: {
                Text("Home Shelves")
            } footer: {
                Text("Content shelves such as Trending hold this many titles. Upcoming lists the next episode of shows you're caught up on, with its air date. Watchlist premieres add new seasons and unreleased films from your watchlist, dated by their digital or theatrical release.")
            }
            Section {
                Toggle("Show Release Year", isOn: $model.settings.general.showReleaseYear)
                Toggle("Show Titles Under Posters", isOn: $model.settings.general.showPosterTitles)
                Toggle("Show Episodes Left", isOn: $model.settings.general.showEpisodesRemaining)
            } header: {
                Text("Posters")
            } footer: {
                Text("The year appears under the title, or alone when titles are hidden. Show Episodes Left adds watched/aired counts such as 3/10 to series posters and \"6 episodes left\" to Continue Watching cards.")
            }
            Section {
                Picker("Text Size", selection: $model.settings.general.detailTextSize) {
                    ForEach(DetailTextSize.allCases) { Text($0.title).tag($0) }
                }
            } header: {
                Text("Display")
            } footer: {
                Text("Adjusts the size of titles, synopsis and other text on detail screens.")
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

    /// The viewer's first or second subtitle language, which live in one list with Subtitles' other choices.
    private func subtitleLanguage(at index: Int) -> Binding<String> {
        Binding(
            get: {
                let languages = model.settings.subtitles.preferredLanguages
                return index < languages.count ? languages[index] : ""
            },
            set: { value in
                var languages = model.settings.subtitles.preferredLanguages
                if value.isEmpty {
                    if index < languages.count { languages.remove(at: index) }
                } else if index < languages.count {
                    languages[index] = value
                } else {
                    languages.append(value)
                }
                model.settings.subtitles.preferredLanguages = languages
            })
    }

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                #if os(iOS)
                Toggle("Auto Rotate to Landscape", isOn: $model.settings.playback.autoRotate)
                #endif
                Toggle("Skip Details on Continue Watching", isOn: $model.settings.playback.skipDetailsOnContinueWatching)
                Picker("Preferred Resolution", selection: $model.settings.playback.preferredResolutionCap) {
                    ForEach([VideoResolution.uhd4k, .uhd1440, .hd1080, .hd720, .sd]) { Text($0 == .uhd4k ? "Up to 4K" : "Up to \($0.label)").tag($0) }
                }
                #if !os(tvOS)
                Picker("Resolution on Cellular", selection: $model.settings.playback.cellularResolutionCap) {
                    ForEach([VideoResolution.uhd4k, .uhd1440, .hd1080, .hd720, .sd]) { Text($0 == .uhd4k ? "Up to 4K" : "Up to \($0.label)").tag($0) }
                }
                #endif
                Toggle("HDR When Available", isOn: $model.settings.playback.preferHDR)
            } footer: {
                Text("Sources above the resolution are hidden from the picker, whatever your source ordering. Resolution on Cellular applies instead on cellular data, a personal hotspot or Low Data Mode. With HDR When Available off, a source's SDR version comes before its HDR one.")
            }
            Section {
                Toggle("Never Use Dolby Vision", isOn: $model.settings.playback.neverUseDolbyVision)
                Toggle("Convert Profile 7 to Profile 8.1", isOn: $model.settings.playback.convertDolbyVisionProfile7)
                    .disabled(model.settings.playback.neverUseDolbyVision)
            } header: {
                Text("Dolby Vision")
            } footer: {
                Text("Never Use Dolby Vision plays its HDR10 picture instead (profile 5, which has none, still plays as Dolby Vision). Profile 7, from UHD Blu-ray remuxes, can't play as Dolby Vision on Apple devices; converting keeps the HDR10 picture and the Dolby Vision metadata for each shot, as profile 8.1. Off plays it as plain HDR10. Applies to MKV files Flow plays itself.")
            }
            Section("Loading Screen") {
                Toggle("Show Progress Bar", isOn: $model.settings.playback.showLoadingProgress)
            }
            #if !os(tvOS)
            Section {
                Toggle("Show X-Ray When Paused", isOn: $model.settings.playback.xrayWhenPaused)
            } header: {
                Text("X-Ray")
            } footer: {
                Text("X-Ray shows the cast and crew, jumps to scenes, and names who's in the scene from the last few minutes of dialogue: from the subtitles on screen, or a file fetched for X-Ray from your subtitle services. Open it any time with the X-Ray button.")
            }
            #endif
            Section {
                Toggle("Auto-Play Next Episode", isOn: $model.settings.playback.autoPlayNextEpisode)
                Picker("Countdown", selection: $model.settings.playback.nextEpisodeCountdownSeconds) {
                    ForEach([5, 10, 15, 20, 30], id: \.self) { Text("\($0) seconds").tag($0) }
                }
                Toggle("Wait for the Episode to End", isOn: $model.settings.playback.upNextWaitsForEnd)
                Picker("Ask If Still Watching", selection: $model.settings.playback.stillWatchingAfterEpisodes) {
                    Text("Never").tag(0)
                    ForEach([2, 3, 4, 5], id: \.self) { Text("After \($0) Episodes").tag($0) }
                }
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
                Picker("Audio Language", selection: Binding(get: { model.settings.playback.preferredAudioLanguage ?? "" }, set: { model.settings.playback.preferredAudioLanguage = $0.isEmpty ? nil : $0 })) {
                    Text("Default").tag("")
                    ForEach(SubtitleSettingsView.languageOptions, id: \.0) { Text($0.1).tag($0.0) }
                }
                Picker("Audio Fallback", selection: Binding(get: { model.settings.playback.audioFallbackLanguage ?? "" }, set: { model.settings.playback.audioFallbackLanguage = $0.isEmpty ? nil : $0 })) {
                    Text("None").tag("")
                    ForEach(SubtitleSettingsView.languageOptions, id: \.0) { Text($0.1).tag($0.0) }
                }
                Picker("Subtitle Language", selection: subtitleLanguage(at: 0)) {
                    if model.settings.subtitles.preferredLanguages.isEmpty { Text("None").tag("") }
                    ForEach(SubtitleSettingsView.languageOptions, id: \.0) { Text($0.1).tag($0.0) }
                }
                Picker("Subtitle Fallback", selection: subtitleLanguage(at: 1)) {
                    Text("None").tag("")
                    ForEach(SubtitleSettingsView.languageOptions, id: \.0) { Text($0.1).tag($0.0) }
                }
                .disabled(model.settings.subtitles.preferredLanguages.isEmpty)
                Picker("Subtitle Type", selection: $model.settings.subtitles.subtitleType) {
                    ForEach(SubtitleTypePreference.allCases) { Text($0.title).tag($0) }
                }
                Picker("Auto-Select Subtitles", selection: $model.settings.subtitles.autoSelect) {
                    ForEach(AutoSubtitleMode.allCases) { Text($0.title).tag($0) }
                }
                Picker("Anime Audio", selection: $model.settings.playback.animeAudio) {
                    ForEach(AnimeAudio.allCases) { Text($0.title).tag($0) }
                }
            } header: {
                Text("Language")
            } footer: {
                Text("Automatic turns subtitles on only when the audio isn't in your subtitle language, such as a foreign-language film: your first language before your second, and a subtitle in the file before an online one. When the audio is in your subtitle language it shows only a forced subtitle from the file, for foreign-language scenes. Always turns them on for everything, Forced Only shows forced subtitles only, Never leaves them off. Audio Language also sorts sources: matching ones come first. For anime, Sub plays Japanese audio with subtitles and Dub plays your audio language without them.")
            }
            Section {
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

    static let languageOptions: [(String, String)] = [
        ("en", "English"), ("es", "Spanish"), ("fr", "French"), ("de", "German"), ("it", "Italian"), ("pt", "Portuguese"),
        ("nl", "Dutch"), ("sv", "Swedish"), ("da", "Danish"), ("no", "Norwegian"), ("fi", "Finnish"), ("pl", "Polish"),
        ("ru", "Russian"), ("tr", "Turkish"), ("ar", "Arabic"), ("hi", "Hindi"), ("ta", "Tamil"), ("te", "Telugu"),
        ("ja", "Japanese"), ("ko", "Korean"), ("zh", "Chinese"), ("he", "Hebrew"), ("el", "Greek"), ("cs", "Czech"),
    ]

    var body: some View {
        @Bindable var model = model
        Form {
            SubtitlePreviewSection()
            SubtitleAppearanceSections()
            Section {
                Toggle("Auto-sync", isOn: $model.settings.subtitles.autoSync)
            } header: {
                Text("Auto-sync (Beta)")
            } footer: {
                Text("Aligns out-of-sync subtitles to the dialogue. Turn it on, start playback, and an Auto-sync action appears in the player's subtitle options after a minute of watching. Works with subtitles Flow loads itself, on files Flow plays itself (MKVs).")
            }
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
                Picker("Auto-Select", selection: $model.settings.subtitles.autoSelect) {
                    ForEach(AutoSubtitleMode.allCases) { Text($0.title).tag($0) }
                }
                Picker("Type", selection: $model.settings.subtitles.subtitleType) {
                    ForEach(SubtitleTypePreference.allCases) { Text($0.title).tag($0) }
                }
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
                Toggle("Air Dates in My Time Zone", isOn: $model.settings.metadata.airDatesInLocalTimeZone)
            } header: {
                Text("Episode Data")
            } footer: {
                Text("Sets where season/episode numbering, episode titles, and air dates come from. TVDB matches the numbering most stream sources use, so multi-part premieres and other ordering edge cases line up correctly. Trakt and TMDB use their own ordering. Posters and episode stills always come from TMDB. Takes effect on the next show you open.\n\nAir Dates in My Time Zone shows episodes with a known air time at that time where you are. An air date without a time is always shown as that day.")
            }
            Section {
                Toggle("Show Unreleased Titles", isOn: $model.settings.metadata.showUnreleasedTitles)
            } header: {
                Text("Availability")
            } footer: {
                Text("Switch this off and Flow uses TMDB release dates to drop titles you can't play yet — a film with only a cinema release, or one that hasn't opened at all — from home shelves, the hero, Show All, Discover and the trending rows.\n\nRows that exist to show what's coming are left alone: watchlists, Continue Watching, Upcoming, Now Playing, Anticipated, calendars, and any Discover shelf you pointed at future dates. Search still finds everything, so you can add a title before it's out.")
            }
            Section("Source") {
                Picker("Primary Source", selection: $model.settings.metadata.primarySource) {
                    ForEach(PrimaryMetadataSource.allCases) { Text($0.title).tag($0) }
                }
            }
            Section {
                Picker("TMDB Language", selection: $model.settings.metadata.language) {
                    ForEach(Self.languages, id: \.0) { Text($0.1).tag($0.0) }
                }
                Picker("Region", selection: $model.settings.metadata.region) {
                    ForEach(Self.regions, id: \.self) { Text(Locale.current.localizedString(forRegionCode: $0) ?? $0).tag($0) }
                }
                Toggle("Include Adult Titles", isOn: $model.settings.metadata.includeAdult)
            } header: {
                Text("Language")
            } footer: {
                Text("Changes the language for titles, descriptions, and other metadata from TMDB. Region sets certifications and streaming providers.")
            }
            Section {
                OptionalTextField(title: "TMDB API Key", text: $model.credentials.tmdbAPIKey, secure: true, prompt: BundleKeys.tmdb == nil ? "v3 key or v4 read token" : "Using built-in key")
                Link("Get a free key at themoviedb.org", destination: URL(string: "https://www.themoviedb.org/settings/api")!)
            } header: {
                Text("TMDB API Key")
            }
            Section {
                OptionalTextField(title: "TVDB API Key", text: $model.credentials.tvdbAPIKey, secure: true, prompt: BundleKeys.tvdb == nil ? "v4 project key" : "Using built-in key")
            } header: {
                Text("TVDB API Key")
            } footer: {
                Text("Needed for the TVDB episode source. Without it Flow falls back to TMDB ordering.")
            }
            Section {
                Toggle("Prefetch on Detail View", isOn: $model.settings.metadata.prefetchOnDetail)
            } header: {
                Text("Performance")
            } footer: {
                Text("Loads sources in the background when you open a detail page so tapping Play is instant. Turn off to save bandwidth on slow connections; Play then fetches sources on demand.")
            }
            Section {
                Picker("Poster Enhancement", selection: $model.settings.metadata.posterEnhancement) {
                    ForEach(PosterEnhancement.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                OptionalTextField(title: "RPDB API Key", text: $model.credentials.rpdbAPIKey, secure: true)
            } header: {
                Text("Poster Enhancement")
            } footer: {
                Text("Draws ratings onto poster art across every shelf, from RatingPosterDB (needs your RPDB key). Applies to newly loaded posters.")
            }
            Section {
                NavigationLink("Ratings Shown") { RatingsShownView() }
                Toggle("Tap a Rating to Open Its Reviews", isOn: $model.settings.metadata.tapRatingOpensReviews)
            } header: {
                Text("Ratings")
            } footer: {
                Text("Ratings Shown picks which scores appear on detail pages and in what order. With Tap a Rating on, each score opens that site's page for the title, in its app if you have it installed.")
            }
            Section {
                RatingIconPackField(url: $model.settings.metadata.ratingIconPackURL)
            } header: {
                Text("Rating Icons")
            } footer: {
                Text("Custom icons for the ratings row on detail pages: a URL to a JSON array of {\"name\", \"url\"}. Names: imdb, tomatometer, popcornmeter, metacritic, tmdb, letterboxd, trakt, mal.")
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

/// Tick a score to show it, drag to reorder (always in edit mode on iPhone and iPad); Apple TV and the Mac also get Move Up / Move Down.
struct RatingsShownView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let shown = model.settings.metadata.ratingsShown
        // Hidden scores sit below the shown ones, so a drag only ever reorders what's on screen.
        let ordered = shown + RatingSource.allCases.filter { !shown.contains($0) }
        List {
            Section {
                ForEach(ordered) { source in
                    row(source, shown: shown)
                }
                .onMove { from, to in
                    var moved = ordered
                    moved.move(fromOffsets: from, toOffset: to)
                    model.settings.metadata.ratingsShown = moved.filter { shown.contains($0) }
                }
            } footer: {
                Text("Scores with no value for a title are left out. MyAnimeList has no score source yet.")
            }
            Section {
                Button("Reset to Default") { model.settings.metadata.ratingsShown = RatingSource.allCases }
                    .disabled(shown == RatingSource.allCases)
            }
        }
        .navigationTitle("Ratings Shown")
        #if os(iOS)
        .environment(\.editMode, .constant(.active))
        #endif
    }

    private func row(_ source: RatingSource, shown: [RatingSource]) -> some View {
        let isShown = shown.contains(source)
        return Button { toggle(source) } label: {
            HStack {
                Text(source.title)
                Spacer()
                if isShown { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isShown ? .isSelected : [])
        #if !os(iOS)
        .contextMenu {
            Button("Move Up", systemImage: "arrow.up") { move(source, by: -1, in: shown) }
                .disabled(shown.first == source || !isShown)
            Button("Move Down", systemImage: "arrow.down") { move(source, by: 1, in: shown) }
                .disabled(shown.last == source || !isShown)
        }
        #endif
    }

    private func toggle(_ source: RatingSource) {
        if model.settings.metadata.ratingsShown.contains(source) {
            model.settings.metadata.ratingsShown.removeAll { $0 == source }
        } else {
            model.settings.metadata.ratingsShown.append(source)
        }
    }

    #if !os(iOS)
    private func move(_ source: RatingSource, by offset: Int, in shown: [RatingSource]) {
        guard let index = shown.firstIndex(of: source), shown.indices.contains(index + offset) else { return }
        var moved = shown
        moved.swapAt(index, index + offset)
        model.settings.metadata.ratingsShown = moved
    }
    #endif
}

/// The icon pack URL as a text field. Edits are kept as typed and only applied once they parse, so a stray space doesn't clear the field.
struct RatingIconPackField: View {
    @Binding var url: URL?
    @State private var text = ""

    var body: some View {
        TextField("Icon pack JSON URL (optional)", text: $text)
            .autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
            #endif
            .onAppear { text = url?.absoluteString ?? "" }
            .onChange(of: text) { _, new in
                let trimmed = new.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty {
                    url = nil
                } else if let parsed = URL(string: trimmed), parsed.scheme != nil {
                    url = parsed
                }
            }
    }
}
