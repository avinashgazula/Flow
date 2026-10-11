import SwiftUI
import FlowKit

/// X-Ray for one title or episode: its cast and crew, and who the recent dialogue says is around.
@MainActor
@Observable
final class XRayStore {
    let request: PlaybackRequest
    private(set) var cast: [CastMember] = []
    private(set) var crew: [CastMember] = []
    private(set) var inScene: [CastMember] = []
    private(set) var isLoaded = false
    /// False until there are subtitles to read the scene from: the ones showing, or a file fetched for X-Ray.
    private(set) var readsDialogue = false
    @ObservationIgnored private var dialogue: SubtitleDocument?
    @ObservationIgnored private var fetchedDialogue = false

    init(request: PlaybackRequest) { self.request = request }

    func load(model: AppModel) async {
        defer { isLoaded = true }
        guard let catalog = model.catalog, let id = request.item.ids.tmdb else { return }
        // An episode has its own guest stars on top of the regular cast.
        if request.item.type == .show, let ep = request.episodeRef {
            cast = (try? await catalog.episodeCredits(showID: id, season: ep.season, episode: ep.episode)) ?? []
        }
        let detail = try? await catalog.details(request.item.type, id: id)
        if cast.isEmpty { cast = detail?.cast ?? [] }
        crew = (detail?.crew ?? []).filter { ["Director", "Creator"].contains($0.role) }
    }

    /// Reads the last few minutes of dialogue at the playhead for the characters named in it.
    func update(session: PlaybackSession, model: AppModel) async {
        var document = session.subtitle
        var offset = session.subtitleOffset
        if document == nil {
            await fetchDialogue(model: model)
            document = dialogue
            offset = 0
        }
        readsDialogue = document != nil
        guard let document, !cast.isEmpty else { return }
        let now = session.currentTime
        let found = Array(XRay.mentioned(in: document.lines(from: now - XRay.window, to: now, offset: offset), cast: cast).prefix(8))
        if found.map(\.id) != inScene.map(\.id) {
            withAnimation(Theme.Motion.gentle) { inScene = found }
        }
    }

    /// With no subtitles on screen, one file is fetched quietly, once. Hearing-impaired files are
    /// preferred: their speaker labels ("JESSE:") name whoever is talking.
    private func fetchDialogue(model: AppModel) async {
        guard !fetchedDialogue else { return }
        fetchedDialogue = true
        let providers = model.subtitleProviders()
        guard !providers.isEmpty else { return }
        let languages = TrackSelection.subtitleLanguages(model.settings.subtitles)
        let tracks = await SubtitleSearch.search(providers, request: request, languages: languages.isEmpty ? ["en"] : languages, hearingImpaired: true)
        guard let first = tracks.first, let provider = providers.first(where: { $0.name == first.provider }) else { return }
        dialogue = try? await provider.download(first)
    }
}

/// The X-Ray panel beside the picture: who's in the scene, the cast and crew, and the scenes to jump to.
struct XRayPanel: View {
    let session: PlaybackSession
    var close: () -> Void = {}
    @Environment(AppModel.self) private var model
    @State private var store: XRayStore?
    @State private var selected: CastMember?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("X-Ray", systemImage: "person.crop.rectangle.stack")
                    .font(.system(.headline, weight: .bold))
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .frame(width: 28, height: 28)
                        .background(.white.opacity(0.14), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close X-Ray")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    if let store { content(store) } else { ProgressView().frame(maxWidth: .infinity).padding(.top, 40) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .scrollIndicators(.hidden)
        }
        .frame(width: Platform.isPhone ? 300 : 360)
        .frame(maxHeight: .infinity, alignment: .top)
        .flowGlass(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .environment(\.colorScheme, .dark)
        .task(id: session.request.id) { await reload() }
        .task(id: session.request.id) { await follow() }
        .sheet(item: $selected) { member in
            XRayPersonSheet(member: member).environment(model)
        }
        .onChange(of: selected) { _, member in
            // Reading about someone shouldn't mean missing the scene they're in.
            if member != nil { session.player.pause() }
        }
    }

    @ViewBuilder
    private func content(_ store: XRayStore) -> some View {
        let sceneIDs = Set(store.inScene.map(\.id))
        if !store.inScene.isEmpty {
            section("In This Scene", note: "Named in the last few minutes of dialogue") {
                ForEach(store.inScene) { member in row(member) }
            }
        }
        if !store.cast.isEmpty {
            section(store.inScene.isEmpty ? "Cast" : "Full Cast") {
                ForEach(store.cast.filter { !sceneIDs.contains($0.id) }.prefix(40)) { member in row(member) }
            }
        } else if store.isLoaded {
            Text("No cast listed for this title.")
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.textSecondary)
        }
        if !store.crew.isEmpty {
            section("Crew") {
                ForEach(store.crew) { member in row(member) }
            }
        }
        section("Music") {
            Button { session.songs.identify(session) } label: {
                HStack(spacing: 12) {
                    Image(systemName: "shazam.logo.fill")
                        .font(.system(size: 20))
                        .symbolEffect(.variableColor.iterative, isActive: session.songs.isListening)
                        .frame(width: 44, height: 44)
                        .background(Color.blue.opacity(0.85), in: Circle())
                    Text(session.songs.isListening ? "Listening…" : "Identify Song")
                        .font(.system(.subheadline, weight: .semibold))
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(session.songs.isListening)
            ForEach(session.songs.found) { song in
                Button { session.seek(to: song.at) } label: {
                    HStack(spacing: 12) {
                        RemoteImage(url: song.item.artworkURL, maxPixel: 200, fallbackTitle: song.title)
                            .frame(width: 44, height: 44)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(song.title).font(.system(.subheadline, weight: .semibold)).lineLimit(1)
                            Text([song.artist, TimeFormat.clock(song.at)].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.system(.caption)).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Goes back to where it played")
            }
        }
        if !session.chapters.isEmpty {
            section("Scenes") {
                ForEach(session.chapters) { chapter in
                    Button { session.seek(toChapter: chapter) } label: {
                        HStack(spacing: 12) {
                            Text(TimeFormat.clock(chapter.start))
                                .font(.system(.caption, weight: .semibold).monospacedDigit())
                                .foregroundStyle(Theme.Palette.textSecondary)
                                .frame(width: 58, alignment: .leading)
                            Text(chapter.title.isEmpty ? "Chapter" : chapter.title)
                                .font(.system(.subheadline, weight: .medium))
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        if store.isLoaded && !store.readsDialogue && !store.cast.isEmpty {
            Text("Turn on subtitles, or add a subtitle service in Settings, and X-Ray shows who's in each scene.")
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.textTertiary)
        }
    }

    private func section<Content: View>(_ title: String, note: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title.uppercased()).font(Theme.Typeface.micro).kerning(1).foregroundStyle(Theme.Palette.textSecondary)
                if let note { Text(note).font(.system(.caption2)).foregroundStyle(Theme.Palette.textTertiary) }
            }
            content()
        }
    }

    private func row(_ member: CastMember) -> some View {
        Button { selected = member } label: { XRayPersonRow(member: member) }
            .buttonStyle(.plain)
    }

    private func reload() async {
        let fresh = XRayStore(request: session.request)
        store = fresh
        await fresh.load(model: model)
        await fresh.update(session: session, model: model)
    }

    /// Keeps "In This Scene" current while the panel is open.
    private func follow() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            guard !Task.isCancelled, let store, store.request.id == session.request.id else { continue }
            await store.update(session: session, model: model)
        }
    }
}

struct XRayPersonRow: View {
    let member: CastMember

    var body: some View {
        HStack(spacing: 12) {
            XRayFace(member: member, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name).font(.system(.subheadline, weight: .semibold)).lineLimit(1)
                if !member.role.isEmpty {
                    Text(member.role).font(.system(.caption)).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.Palette.textTertiary)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(member.role.isEmpty ? member.name : "\(member.name) as \(member.role)")
    }
}

/// A cast member's photo, or their initials in colour.
struct XRayFace: View {
    let member: CastMember
    let size: CGFloat

    var body: some View {
        Group {
            if member.profilePath != nil {
                RemoteImage(url: TMDBImage.url(member.profilePath, size: .profile), maxPixel: 200)
            } else {
                Monogram(name: member.name, fontSize: size * 0.34)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Theme.Palette.hairline))
    }
}

/// Who someone is, without leaving the film: photo, character, age, a short biography and what else they're in.
struct XRayPersonSheet: View {
    let member: CastMember
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var person: Person?
    @State private var showFullBio = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.l) {
                    HStack(alignment: .center, spacing: Theme.Space.m) {
                        XRayFace(member: member, size: 96 * Theme.scale)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(member.name).font(Theme.Typeface.title)
                            if !member.role.isEmpty {
                                Text(member.role).font(Theme.Typeface.headline).foregroundStyle(Theme.Palette.textSecondary)
                            }
                            if let line = lifeLine { Text(line).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary) }
                        }
                    }
                    if let bio = person?.biography, !bio.isEmpty {
                        Text(bio)
                            .font(Theme.Typeface.body)
                            .foregroundStyle(Theme.Palette.textSecondary)
                            .lineLimit(showFullBio ? nil : 6)
                            .onTapGesture { withAnimation(Theme.Motion.gentle) { showFullBio.toggle() } }
                    }
                    if let credits = person?.credits, !credits.isEmpty {
                        VStack(alignment: .leading, spacing: Theme.Space.s) {
                            Text("Also In").font(Theme.Typeface.sectionTitle).displayTracking()
                            ScrollView(.horizontal, showsIndicators: false) {
                                LazyHStack(alignment: .top, spacing: 12) {
                                    ForEach(credits.prefix(20)) { item in
                                        VStack(alignment: .leading, spacing: 4) {
                                            PosterArtwork(item: item).frame(width: 96 * Theme.scale)
                                            Text(item.title).font(.system(.caption, weight: .medium)).lineLimit(1)
                                                .frame(width: 96 * Theme.scale, alignment: .leading)
                                        }
                                    }
                                }
                            }
                            .scrollClipDisabled()
                        }
                    } else if person == nil {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                }
                .padding(Theme.Space.gutter)
            }
            .navigationTitle(member.name)
            .inlineNavigationTitle()
            .sheetDoneButton { dismiss() }
        }
        .presentationDetents([.medium, .large])
        .preferredColorScheme(.dark)
        .task { person = try? await model.catalog?.person(member.id) }
    }

    /// "Born April 12, 1985 (age 41)" — in UTC, which is how TMDb dates birthdays.
    private var lifeLine: String? {
        guard let born = person?.birthday else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let style = Date.FormatStyle(date: .long, time: .omitted, timeZone: calendar.timeZone)
        let end = person?.deathday ?? Date()
        let age = calendar.dateComponents([.year], from: born, to: end).year ?? 0
        if let died = person?.deathday { return "\(born.formatted(style)) – \(died.formatted(style)) (age \(age))" }
        return "Born \(born.formatted(style)) (age \(age))"
    }
}

#if os(tvOS)
/// X-Ray as a tab in Apple TV's info panel: who's in the scene, then the cast, as faces in a row.
struct XRayTVPanel: View {
    let session: PlaybackSession
    let model: AppModel
    @State private var store: XRayStore?
    @State private var visible = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let store {
                let people = store.inScene + store.cast.filter { member in !store.inScene.contains { $0.id == member.id } }
                if people.isEmpty {
                    Text(store.isLoaded ? "No cast listed for this title." : "Loading…")
                        .font(.system(size: 26)).foregroundStyle(Theme.Palette.textSecondary)
                } else {
                    Text(store.inScene.isEmpty ? "Cast" : "In This Scene, Then the Full Cast")
                        .font(.system(size: 24, weight: .semibold)).foregroundStyle(Theme.Palette.textSecondary)
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: 36) {
                            ForEach(people.prefix(30)) { member in
                                Button {} label: {
                                    VStack(spacing: 10) {
                                        XRayFace(member: member, size: 150)
                                        Text(member.name).font(.system(size: 22, weight: .semibold)).lineLimit(1)
                                        Text(member.role).font(.system(size: 20)).foregroundStyle(Theme.Palette.textSecondary).lineLimit(1)
                                    }
                                    .frame(width: 200)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 20)
                    }
                    .scrollClipDisabled()
                }
            }
        }
        .padding(.horizontal, 60)
        .padding(.vertical, 30)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task(id: session.request.id) {
            let fresh = XRayStore(request: session.request)
            store = fresh
            await fresh.load(model: model)
        }
        // Only while the tab is showing, so subtitles aren't fetched for a panel nobody opened.
        .task(id: "\(session.request.id)-\(visible)") {
            while visible && !Task.isCancelled {
                if let store { await store.update(session: session, model: model) }
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }
}
#endif
