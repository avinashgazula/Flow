import SwiftUI
import FlowKit

/// What Home leads with: a title, the episode if it is one, and how far in.
struct HomeLead: Equatable, Identifiable {
    enum Kind: Equatable { case resume, nextUp, pick }

    var item: MediaItem
    var episode: EpisodeRef?
    var progress: PlaybackProgress?
    var kind: Kind = .pick
    /// The Continue Watching entry it came from, so Up Next doesn't list it twice.
    var entryID: String?

    var id: String { entryID ?? item.id }

    /// Minutes still to watch, when the app knows (a resume point, or a runtime).
    var minutes: Int? { Reel.minutesLeft(progress: progress, runtimeMinutes: item.runtimeMinutes) }
}

/// Home, as a streaming app's hero: the title's artwork runs edge to edge and up under the top bar, fading at its foot into
/// the page, and over the fade sit the title's logo (its name in Archivo capitals when TMDb has no logo art), one line of
/// facts, a solid Resume (or Play) pill, a round Details and a dot for each title. The lead turns through the top picks (Settings →
/// Shelves → Top Pick) and never what is in progress, which is Up Next's; it turns by itself every few seconds with a cross-fade (`HomeRotation`) unless the viewer is touching,
/// pointing at or focused on it. A swipe follows the finger. The day label and date open the page under it, then Up Next and
/// the shelves, each a ruled section under a red label. This is the one screen with a gradient and round controls; the rest
/// of the app keeps the Index's flat, square look (web/DESIGN.md, Home Lead).
struct HomeView: View {
    @Environment(AppModel.self) private var model
    /// What the lead turns through: the top picks, ten at most. Never Continue Watching; a pick that was started still shows its progress.
    @State private var leads: [HomeLead] = []
    @State private var leadIndex = 0
    /// Whether the leads have been asked for yet, so the picture's place is held (and not a bare header) while they load.
    @State private var leadsLoaded = false
    /// Logo art by title (an empty path is "none", no entry is "not asked yet") and what the list endpoints don't carry: the
    /// runtime and the rating. Both are asked for lazily, never ahead of the first paint.
    @State private var logos: [String: String] = [:]
    @State private var extras: [String: LeadExtras] = [:]
    /// A choice on the dots, a swipe or the remote decides where to stop: the lead stays put until Home is next opened fresh.
    @State private var rotationStopped = false
    /// What keeps the lead still while the viewer is at it: a scroll under the finger, a finger on the lead, the pointer over
    /// it, focus in it.
    @State private var scrolling = false
    @State private var touching = false
    @State private var pointerOver = false
    @State private var focusInside = false
    /// Whether Home is the page on screen; a pushed page or another tab holds the turn.
    @State private var onScreen = false
    /// Where the bar ends and how much a notch takes at each side: the picture runs under the bar and to both edges, so the
    /// words keep clear of them (a phone on its side).
    @State private var barBottom: CGFloat = 0
    @State private var sideLeading: CGFloat = 0
    @State private var sideTrailing: CGFloat = 0
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    /// The greeting follows the hour, so it is refreshed each minute.
    @State private var now = Date()

    private var general: GeneralSettings { model.settings.general }
    private var dayPart: Reel.DayPart { Reel.DayPart(date: now) }

    /// The enabled shelves, minus the ones their General switches turn off.
    private var shelves: [ShelfConfig] {
        model.settings.shelves.filter { shelf in
            guard shelf.enabled else { return false }
            switch shelf.source {
            case .builtIn(.continueWatching): return general.showContinueWatching
            case .builtIn(.upcomingEpisodes): return general.showUpcoming
            default: return true
            }
        }
    }

    /// Continue Watching and Next Up are one section on Home, "Up Next", under the lead; the other shelves are rows below.
    private var rowShelves: [ShelfConfig] {
        shelves.filter { shelf in
            if case .builtIn(let builtIn) = shelf.source, builtIn == .continueWatching || builtIn == .nextUp { return false }
            return true
        }
    }

    private var showsUpNext: Bool {
        shelves.contains { shelf in
            if case .builtIn(let builtIn) = shelf.source { return builtIn == .continueWatching || builtIn == .nextUp }
            return false
        }
    }

    private var servers: [MediaServerConfig] {
        model.mediaServers.map(\.config).filter { model.settings.mediaServers.showsHomeRow(for: $0.id) }
    }

    /// Whether the lead can turn by itself at all. The screenshot tour and the UI tests need a lead that holds still, and
    /// VoiceOver users a lead that doesn't change under them.
    private var rotates: Bool {
        HomeRotation.advancesByItself(setting: general.heroAutoAdvance, titles: leads.count, reduceMotion: reduceMotion)
            && !voiceOver && !Self.automated
    }

    private static let automated: Bool = {
        let defaults = UserDefaults.standard
        // The iPhone and iPad UI tests keep the player's controls up, so that key tells them apart; Apple TV's pass the other.
        return ScreenshotTour.isRequested || defaults.bool(forKey: "FlowNoRotation") || defaults.bool(forKey: "FlowKeepPlayerControls")
    }()

    private var leadHeld: Bool { scrolling || touching || pointerOver || focusInside }

    /// Changes whenever the turn should start over: a new set of titles, a choice on the dots, or the viewer letting go,
    /// so a title always gets its whole dwell.
    private struct RotationKey: Hashable {
        var ids: [String]
        var running: Bool
        var held: Bool
    }

    private var rotationKey: RotationKey {
        RotationKey(ids: leads.map(\.id),
                    running: rotates && !rotationStopped && onScreen && scenePhase == .active,
                    held: leadHeld)
    }

    /// What decides the lead: the top picks' sources, and what is in progress (a pick that was started shows its progress).
    private var leadKey: String {
        "\(model.contentVersion)-\(general.showContinueWatching)-\(model.continueWatching.first?.id ?? "none")-\(general.heroSource.rawValue)-\(general.heroSecondarySource?.rawValue ?? "")"
    }

    var body: some View {
        Group {
            if model.catalog == nil {
                MissingKeyView()
            } else {
                GeometryReader { proxy in
                    ScrollView {
                        page(size: proxy.size)
                    }
                    .scrollIndicators(.hidden)
                    .onScrollPhaseChangeIfAvailable { scrolling = $0 }
                    .refreshable { await model.refreshLibrary(force: true) }
                    // The lead's picture runs under the navigation bar (iPhone and iPad) and under the tab bar (Apple TV), as
                    // a title's page does.
                    #if os(iOS)
                    .ignoresSafeArea(edges: .top)
                    .background { insetsProbe }
                    #elseif os(tvOS)
                    .ignoresSafeArea(edges: [.top, .horizontal])
                    .background { insetsProbe }
                    #endif
                }
            }
        }
        .background(Theme.Palette.ground.ignoresSafeArea())
        .task(id: leadKey) { await loadLeads() }
        .task(id: leads.map(\.id)) { await loadLogos() }
        .task(id: "\(leadIndex)-\(leads.count)") { await loadExtras() }
        .task(id: rotationKey) { await rotate() }
        .onAppear { onScreen = true }
        .onDisappear { onScreen = false }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                now = Date()
            }
        }
        // The page names itself in its own red label, so the bar carries no title.
        #if os(iOS)
        .navigationTitle("")
        .inlineNavigationTitle()
        #elseif os(macOS)
        .navigationTitle("Home")
        #endif
        #if os(iOS)
        .toolbar { SettingsToolbarItem { model.showSettings = true } }
        .flowMinimizingToolbar()
        #elseif os(macOS)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                SettingsLink { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
                    .tint(Theme.Palette.text)
            }
        }
        #elseif os(tvOS)
        .toolbar {
            // tvOS 17 has no Settings tab.
            if !model.settingsInTab {
                ToolbarItem(placement: .automatic) {
                    Button { model.showSettings = true } label: { Image(systemName: "gearshape.fill") }
                        .accessibilityLabel("Settings")
                        .tint(Theme.Palette.text)
                }
            }
        }
        #endif
    }

    // MARK: Layout

    #if os(iOS) || os(tvOS)
    /// Reads the bar's height and the notch's width from behind the scroll view, which ignores the safe area to run under them.
    private var insetsProbe: some View {
        Color.clear
            .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { new in
                if new > 0, abs(new - barBottom) > 0.5 { barBottom = new }
            }
            .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.leading } action: { new in
                if abs(new - sideLeading) > 0.5 { sideLeading = new }
            }
            .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.trailing } action: { new in
                if abs(new - sideTrailing) > 0.5 { sideTrailing = new }
            }
    }
    #endif

    /// How far the picture runs up above the page's own top: under the navigation bar on iPhone and iPad, the tab bar on
    /// Apple TV, nothing on a Mac (its toolbar is the window's).
    private var topExtra: CGFloat {
        #if os(iOS)
        return barBottom
        #elseif os(tvOS)
        // The safe area already clears the tab bar; this is what it measures, with a floor in case it hasn't yet.
        return max(barBottom, 110)
        #else
        return 0
        #endif
    }

    /// The room the words keep from each side: the page's gutter, plus a notch's safe area on a phone on its side. Apple TV's
    /// page ignores its safe area and the gutter alone is its margin.
    private var leadingInset: CGFloat { Theme.Space.gutter + (Platform.isTV ? 0 : sideLeading) }
    private var trailingInset: CGFloat { Theme.Space.gutter + (Platform.isTV ? 0 : sideTrailing) }

    private func page(size: CGSize) -> some View {
        let shape = HeroLead.shape(width: Double(size.width), isTV: Platform.isTV)
        let height = CGFloat(HeroLead.height(shape: shape, width: Double(size.width), viewport: Double(size.height + topExtra)))
        return LazyVStack(alignment: .leading, spacing: Theme.Space.section) {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                if !leads.isEmpty {
                    LeadCarousel(leads: leads, index: $leadIndex, logos: logos, extras: extras, shape: shape, height: height,
                                 leadingInset: leadingInset, trailingInset: trailingInset, topInset: topExtra,
                                 chose: { rotationStopped = true },
                                 rotation: rotates ? Rotation(stopped: rotationStopped, toggle: { rotationStopped.toggle() }) : nil,
                                 touching: { touching = $0 },
                                 engaged: { focusInside = $0 })
                        #if os(iOS)
                        .ignoresSafeArea(edges: .horizontal)
                        #elseif os(macOS)
                        .ignoresSafeArea(edges: .top)
                        #endif
                        #if !os(tvOS)
                        .onHover { pointerOver = $0 }
                        #endif
                } else if !leadsLoaded {
                    // Held while the picks load, so the page doesn't jump when the picture arrives.
                    Rectangle().fill(Theme.Palette.tint1)
                        .frame(height: height)
                        .accessibilityHidden(true)
                        #if os(iOS)
                        .ignoresSafeArea(edges: .horizontal)
                        #endif
                }
                LeadHeader(dayTitle: dayPart.title, dateLine: Reel.dateLine(now))
                    .padding(.horizontal, Theme.Space.gutter)
                    // With no picture above it the day label is the top of the page, under the bar.
                    .padding(.top, leads.isEmpty && leadsLoaded ? plainTop : 0)
            }
            if showsUpNext {
                UpNextSection(leadEntryID: nil)
            }
            ForEach(rowShelves) { shelf in
                HomeRow(shelf: shelf)
            }
            ForEach(servers) { server in
                ServerLibrariesIndex(server: server)
            }
            if shelves.isEmpty {
                ContentUnavailableView("No Shelves", systemImage: "square.grid.2x2", description: Text("Turn shelves on in Settings → Shelves."))
            }
        }
        .padding(.bottom, Theme.Space.xxl)
    }

    /// Where the day label sits when there is no picture: clear of the bar it would otherwise run under.
    private var plainTop: CGFloat {
        #if os(iOS)
        return barBottom + Theme.Space.s
        #elseif os(tvOS)
        return topExtra
        #else
        return Theme.Space.xxs
        #endif
    }

    /// Turns to the next title each dwell, for as long as its task lives; `rotationKey` ends it when anything holds the lead.
    private func rotate() async {
        let key = rotationKey
        guard key.running, !key.held, leads.count > 1 else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(HomeRotation.dwell * 1_000_000_000))
            guard !Task.isCancelled else { return }
            // A cross-fade: the lead's slides fade in and out in place.
            withAnimation(Theme.Motion.enter) { leadIndex = HeroLead.wrapped(leadIndex, by: 1, count: leads.count) }
        }
    }

    // MARK: Loading

    private func loadLeads() async {
        let picks = Array(await model.heroItems().prefix(10))
        // A pick that was started keeps its resume point, so it shows its progress and Resume; nothing in progress is added.
        let started: [MediaKey: ContinueWatchingBuilder.Entry] = general.showContinueWatching ? Dictionary(model.continueWatching.filter { !$0.isNextUp }.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first }) : [:]
        let out = HeroLead.slides(picks: picks, key: { $0.key }, started: started).map { slide in
            slide.started.map { HomeLead(item: slide.pick, episode: $0.episode, progress: $0.progress, kind: .resume) } ?? HomeLead(item: slide.pick)
        }
        leadsLoaded = true
        guard out != leads else { return }
        leads = out
        leadIndex = min(leadIndex, max(0, out.count - 1))
    }

    /// The titles' logo art, a request each (the lists a lead is picked from carry none), cached by the catalogue. They arrive
    /// as they answer, and a title with none is recorded as none so its name is set instead.
    private func loadLogos() async {
        guard let catalog = model.catalog else { return }
        let wanted = leads.map(\.item).filter { logos[$0.id] == nil }
        await withTaskGroup(of: (String, String).self) { group in
            for item in wanted {
                group.addTask { (item.id, await catalog.logo(for: item) ?? "") }
            }
            for await (id, path) in group where !Task.isCancelled {
                logos[id] = path
            }
        }
    }

    /// The runtime and rating of the title on show and the one after it, from the catalogue's cached details, so the line of
    /// facts is whole by the time the next title fades in.
    private func loadExtras() async {
        guard let catalog = model.catalog, !leads.isEmpty else { return }
        for step in 0...1 {
            let lead = leads[HeroLead.wrapped(leadIndex, by: step, count: leads.count)]
            guard extras[lead.item.id] == nil, let id = lead.item.ids.tmdb else { continue }
            guard let detail = try? await catalog.details(lead.item.type, id: id), !Task.isCancelled else { return }
            extras[lead.item.id] = LeadExtras(minutes: detail.item.runtimeMinutes.flatMap { $0 > 0 ? $0 : nil }, certification: detail.item.certification)
        }
    }
}

// MARK: - The lead

/// What the lists leave out and a title's details have: how long it runs and its rating.
struct LeadExtras: Equatable {
    var minutes: Int?
    var certification: String?
}

/// The day as a red mono label, with the date beside it in muted mono.
private struct LeadHeader: View {
    let dayTitle: String
    let dateLine: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
            SectionLabel(dayTitle)
            Text(dateLine)
                .font(Theme.Typeface.facts)
                .textCase(.uppercase)
                .tracking(0.06 * 12 * Theme.scale)
                .foregroundStyle(Theme.Palette.muted)
                // There is little room; the date gives way rather than wrapping under the label.
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .combine)
    }
}

/// What can hold focus in the lead on Apple TV: Resume, Details, and the dots row, which turns the carousel (Left and Right
/// while it has focus), and whose Select stops or restarts the turning.
enum LeadFocus: Hashable { case resume, details, dots }

/// The dots' pause and play button: whether the turn is stopped, and how to flip it.
extension HomeView {
    struct Rotation {
        var stopped: Bool
        var toggle: () -> Void
    }
}

private extension HomeLead.Kind {
    var hero: HeroLead.Kind {
        switch self {
        case .resume: return .resume
        case .nextUp: return .nextUp
        case .pick: return .pick
        }
    }
}

/// The lead's slides, one on show: cross-fading when it turns by itself or from the dots, following the finger on a swipe
/// (the neighbour slides in beside it). The dots sit over the foot of the picture, centred on a phone and at the right on a
/// wide screen (under the buttons on Apple TV, where focus has to be able to step down to them).
struct LeadCarousel: View {
    let leads: [HomeLead]
    @Binding var index: Int
    let logos: [String: String]
    let extras: [String: LeadExtras]
    let shape: HeroLead.Shape
    let height: CGFloat
    /// The room the words keep from each edge.
    let leadingInset: CGFloat
    let trailingInset: CGFloat
    /// How far the picture runs up under the bar, so the scrim behind the bar's buttons covers it.
    let topInset: CGFloat
    /// A person (not the clock) chose a title, so it stays where they put it.
    let chose: () -> Void
    var rotation: HomeView.Rotation?
    /// A finger is on the lead (iOS), so it isn't turned out from under it.
    var touching: (Bool) -> Void = { _ in }
    /// Focus is inside the lead (Apple TV), so the title isn't turned out from under a focused button.
    var engaged: (Bool) -> Void = { _ in }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Where focus is inside the lead. Apple TV starts it on Resume, so one press of Select carries on watching.
    @FocusState private var focus: LeadFocus?
    @State private var width: CGFloat = 0
    /// A swipe: how far the finger has moved, which neighbour is showing (1 the next, -1 the previous), and whether the
    /// slides are finishing the move.
    @State private var drag: CGFloat = 0
    @State private var peekSide = 0
    @State private var settling = false
    #if os(iOS)
    @State private var axis: Axis?
    @GestureState private var fingerDown = false
    #endif

    private var wide: Bool { shape != .phone }

    private struct Entry: Identifiable {
        let lead: HomeLead
        let offset: CGFloat
        let current: Bool
        var id: String { lead.id }
    }

    /// The slide on show and, mid-swipe, the neighbour beside it.
    private var entries: [Entry] {
        guard leads.indices.contains(index) else { return [] }
        var out = [Entry(lead: leads[index], offset: drag, current: true)]
        if peekSide != 0, leads.count > 1 {
            let neighbour = leads[HeroLead.wrapped(index, by: peekSide, count: leads.count)]
            if neighbour.id != leads[index].id { out.append(Entry(lead: neighbour, offset: drag + CGFloat(peekSide) * width, current: false)) }
        }
        return out
    }

    var body: some View {
        ZStack(alignment: dotsAlignment) {
            ZStack {
                ForEach(entries) { entry in
                    LeadSlide(lead: entry.lead, logo: logos[entry.lead.item.id], extras: extras[entry.lead.item.id] ?? LeadExtras(),
                              shape: shape, height: height, leadingInset: leadingInset, trailingInset: trailingInset, topInset: topInset,
                              interactive: entry.current && peekSide == 0, focus: $focus, dots: showsDotsInSlide && leads.count > 1 ? dots : nil)
                        .offset(x: entry.offset)
                        .transition(.opacity)
                }
            }
            if leads.count > 1, !showsDotsInSlide {
                dots
                    .padding(.leading, leadingInset)
                    .padding(.trailing, trailingInset)
                    .padding(.bottom, wide ? Theme.Space.xl + 4 * Theme.scale : Theme.Space.xs)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .clipped()
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        #if os(iOS)
        .modifier(LeadSwipe(fallback: swipe, changed: follow, ended: { finish(translation: $0, velocity: $1) }))
        .onChange(of: fingerDown) { _, down in
            // A drag the system took away (the page began to scroll) never ends: settle back rather than stay mid-swipe.
            if !down, axis == .horizontal, !settling { finish(translation: drag, velocity: 0) }
        }
        #endif
        #if os(tvOS)
        .defaultFocus($focus, LeadFocus?.some(.resume))
        .onChange(of: focus) { _, now in engaged(now != nil) }
        .onDisappear { engaged(false) }
        #endif
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Next Title") { go(1) }
        .accessibilityAction(named: "Previous Title") { go(-1) }
    }

    /// Apple TV puts the dots in the words' column, under the buttons: the focus engine steps down to what is below.
    private var showsDotsInSlide: Bool { Platform.isTV }

    private var dotsAlignment: Alignment { wide ? .bottomTrailing : .bottom }

    private var dots: LeadDots {
        LeadDots(count: leads.count, index: index, rotation: rotation, step: go, select: { go($0 - index) }, focus: $focus)
    }

    /// A choice: the dots, the remote's Left and Right, VoiceOver's actions. It cross-fades, and the lead stays where it was put.
    private func go(_ delta: Int) {
        guard leads.count > 1, !settling else { return }
        withAnimation(Theme.Motion.enter) { index = HeroLead.wrapped(index, by: delta, count: leads.count) }
        chose()
    }

    #if os(iOS)
    /// A swipe, touch and pen only. The slide follows the finger one to one (no animation: this is the hand), then finishes
    /// the move or settles back. Only a mostly sideways drag is the lead's: the page scrolls up and down under the finger.
    private var swipe: some Gesture {
        DragGesture(minimumDistance: 14)
            .updating($fingerDown) { _, state, _ in state = true }
            .onChanged { value in
                guard leads.count > 1, !settling else { return }
                if axis == nil { axis = abs(value.translation.width) > abs(value.translation.height) ? .horizontal : .vertical }
                guard axis == .horizontal else { return }
                follow(value.translation.width)
            }
            .onEnded { value in
                defer { axis = nil }
                guard axis == .horizontal, !settling else { return }
                finish(translation: value.translation.width, velocity: value.velocity.width)
            }
    }

    /// The slide under the finger, one to one.
    private func follow(_ translation: CGFloat) {
        guard leads.count > 1, !settling else { return }
        touching(true)
        drag = translation
        if drag != 0 { peekSide = drag < 0 ? 1 : -1 }
    }

    private func finish(translation: CGFloat, velocity: CGFloat) {
        guard !settling else { return }
        axis = nil
        touching(false)
        let turn = HeroLead.swipe(translation: Double(translation), velocity: Double(velocity), width: Double(width))
        settling = true
        let target: CGFloat = turn == 0 ? 0 : -CGFloat(turn) * width
        // The neighbour is the new current slide, at the same place on screen, so handing over changes nothing the eye can see.
        let handOver = {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                if turn != 0 {
                    index = HeroLead.wrapped(index, by: turn, count: leads.count)
                    chose()
                }
                drag = 0
                peekSide = 0
                settling = false
            }
        }
        if reduceMotion {
            handOver()
        } else {
            withAnimation(Theme.Motion.enter) { drag = target } completion: { handOver() }
        }
    }
    #endif
}

/// One title: its artwork, the fade into the page, and over the fade its logo, facts and buttons. The picture is a button
/// that opens the title, behind the words.
private struct LeadSlide: View {
    let lead: HomeLead
    /// The logo's path: nil while it is being asked for, empty when the title has none.
    let logo: String?
    let extras: LeadExtras
    let shape: HeroLead.Shape
    let height: CGFloat
    let leadingInset: CGFloat
    let trailingInset: CGFloat
    let topInset: CGFloat
    let interactive: Bool
    var focus: FocusState<LeadFocus?>.Binding
    /// Apple TV's dots, which sit in this column under the buttons.
    var dots: LeadDots?
    @Environment(AppModel.self) private var model

    private var item: MediaItem { lead.item }
    private var wide: Bool { shape != .phone }
    private var minutes: Int? { lead.minutes ?? extras.minutes }

    private var facts: [String] {
        HeroLead.facts(kind: lead.kind.hero, episode: lead.episode, year: item.year, genres: item.genres.map(\.name),
                       certification: item.certification ?? extras.certification, minutesLeft: minutes)
    }

    private var spoken: String {
        Reel.spokenListing(title: item.title, episode: lead.episode, minutesLeft: lead.kind == .resume ? minutes : nil,
                           endsAt: minutes.map { Reel.endDate(from: Date(), minutesLeft: $0) }, extra: model.lastEdgeFormat(for: item))
    }

    /// The facts' type scales a little with the room.
    private var logoMaxHeight: CGFloat {
        switch shape {
        case .phone: return 96
        case .wide: return 112
        case .tv: return 190
        }
    }

    private var logoMaxWidth: CGFloat {
        switch shape {
        case .phone: return 320
        case .wide: return 520
        case .tv: return 760
        }
    }

    /// The name in Archivo capitals, for a title with no logo: 52 on a phone, 64 on a tablet or Mac, 96 on Apple TV.
    private var nameSize: CGFloat {
        switch shape {
        case .phone: return 48
        case .wide: return Platform.isMac ? 56 : 64
        case .tv: return 96
        }
    }

    /// The room under the words: the dots' row on a phone (they sit over the foot of the picture), a margin elsewhere.
    private var bottomInset: CGFloat {
        switch shape {
        case .phone: return Theme.Space.xs + 44 + Theme.Space.xs
        case .wide: return Theme.Space.xl
        case .tv: return Theme.Space.xl
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            art
            fade.allowsHitTesting(false)
            scrim.allowsHitTesting(false)
            words
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .clipped()
        .accessibilityElement(children: .contain)
        .accessibilityHidden(!interactive)
        .allowsHitTesting(interactive)
    }

    // MARK: Picture

    private var art: some View {
        #if os(iOS)
        // A tap, not a button: a button fires when the finger lifts inside it, and a swipe across a full-width picture
        // always ends inside it, so turning the carousel opened the title. A tap gesture gives up once the finger moves.
        picture
            .contentShape(Rectangle())
            .onTapGesture { model.navigate(to: .detail(item)) }
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { model.navigate(to: .detail(item)) }
            .accessibilityIdentifier("home-lead-picture")
        #else
        Button { model.navigate(to: .detail(item)) } label: { picture }
            .accessibilityIdentifier("home-lead-picture")
            .buttonStyle(.plain)
            #if os(tvOS)
            // Resume and Details are the remote's way in; a picture that took focus too would be one stop too many.
            .focusable(false)
            #endif
        #endif
    }

    private var picture: some View {
        // Cropped to fill. The original size: a phone shows a narrow slice of a wide picture, and a smaller file would
        // be stretched to twice its size.
        RemoteImage(url: TMDBImage.url(item.backdropPath, size: .original), maxPixel: Platform.isTV ? 1920 : 2400, fallbackTitle: item.title)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
    }

    /// The page's own colour rising from the foot, a little from the left on a wide screen: eased, so no band shows, and
    /// solid at the bottom so the shelves begin where the picture ends and nothing seams.
    private var fade: some View {
        let ground = Theme.Palette.bg
        return ZStack {
            LinearGradient(stops: [
                .init(color: ground.opacity(0), location: 0.28),
                .init(color: ground.opacity(0.12), location: 0.42),
                .init(color: ground.opacity(0.40), location: 0.56),
                .init(color: ground.opacity(0.76), location: 0.72),
                .init(color: ground.opacity(0.94), location: 0.86),
                .init(color: ground, location: 1),
            ], startPoint: .top, endPoint: .bottom)
            if wide {
                LinearGradient(stops: [
                    .init(color: ground.opacity(0.86), location: 0),
                    .init(color: ground.opacity(0.62), location: 0.25),
                    .init(color: ground.opacity(0.26), location: 0.5),
                    .init(color: ground.opacity(0), location: 0.72),
                ], startPoint: .leading, endPoint: .trailing)
            }
        }
    }

    /// Black fading out from the top, behind the status bar and the bar's buttons, which are drawn in the page's colours and
    /// would otherwise sit on bright artwork.
    private var scrim: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.black.opacity(0.5), .black.opacity(0.18), .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: topInset + 56 * Theme.scale)
            Spacer(minLength: 0)
        }
    }

    // MARK: Words

    @ViewBuilder
    private var words: some View {
        if wide {
            HStack(spacing: 0) {
                column(alignment: .leading)
                    .frame(maxWidth: Platform.isTV ? 1100 : 640, alignment: .leading)
                Spacer(minLength: 0)
            }
            .padding(.leading, leadingInset)
            .padding(.trailing, trailingInset)
            .padding(.bottom, bottomInset)
        } else {
            column(alignment: .center)
                .padding(.leading, leadingInset)
                .padding(.trailing, trailingInset)
                .padding(.bottom, bottomInset)
        }
    }

    private func column(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: Theme.Space.s) {
            HeroLogo(path: logo, title: item.title, maxWidth: logoMaxWidth, maxHeight: logoMaxHeight, nameSize: nameSize,
                     alignment: alignment == .leading ? .leading : .center)
                .allowsHitTesting(false)
                // Inside the swipeable lead, so the system would otherwise take it for something to press (and too small).
                .accessibilityRespondsToUserInteraction(false)
            if !facts.isEmpty {
                Text(HeroLead.line(facts))
                    .font(Theme.Typeface.facts)
                    .textCase(.uppercase)
                    .tracking(0.06 * 12 * Theme.scale)
                    .foregroundStyle(Theme.Palette.fg)
                    .multilineTextAlignment(alignment == .leading ? .leading : .center)
                    .lineLimit(2)
                    .allowsHitTesting(false)
                    .accessibilityRespondsToUserInteraction(false)
            }
            if lead.kind == .resume, let progress = lead.progress {
                ProgressCapsule(value: Reel.watchedFraction(progress), height: 3 * Theme.scale)
                    .frame(width: 200 * Theme.scale)
            }
            actions
                .padding(.top, Theme.Space.xxs)
            if let dots { dots.padding(.top, Theme.Space.xxs) }
        }
    }

    private var actions: some View {
        HStack(spacing: Theme.Space.s) {
            Button { Task { await model.play(item) } } label: {
                Label(lead.kind == .resume ? "Resume" : "Play", systemImage: "play.fill")
            }
            .buttonStyle(HeroButtonStyle(kind: .pill))
            .accessibilityIdentifier("home-lead-primary")
            .focused(focus, equals: .resume)
            Button { model.navigate(to: .detail(item)) } label: { Image(systemName: "info") }
                .buttonStyle(HeroButtonStyle(kind: .circle))
                .accessibilityLabel("Details")
                .focused(focus, equals: .details)
        }
    }
}

/// The title's logo art over the fade. TMDb's logos are made for dark screens (mostly white), so on a page of paper one would
/// vanish: once loaded its tone is measured (`LogoTone`), and a light logo on a light page, or a dark one on a dark page, has
/// its lightness flipped (inverted, with the hue turned back so a coloured logo keeps its colours). With no logo, or one
/// that won't load, the name stands in, in Archivo capitals: never an empty space. While the logo is being asked for, nothing
/// shows (the words are anchored at the bottom, so nothing under them moves when it arrives).
private struct HeroLogo: View {
    let path: String?
    let title: String
    let maxWidth: CGFloat
    let maxHeight: CGFloat
    let nameSize: CGFloat
    let alignment: Alignment
    @Environment(\.colorScheme) private var scheme
    @State private var image: CGImage?
    @State private var tone: LogoTone = .mid
    @State private var failed = false

    private var hasNoLogo: Bool { path == "" || failed }

    var body: some View {
        Group {
            if let image {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .modifier(LogoFlip(active: tone.flips(onDarkPage: scheme == .dark)))
                    // A logo left as it is because it is coloured or in between sits over the picture as much as the paper fade,
                    // and its light parts thin out over bright art. A soft shadow holds their edges; on a dark page the art
                    // is already dimmed under it.
                    .shadow(color: .black.opacity(scheme == .light && tone == .mid ? 0.4 : 0), radius: 6 * Theme.scale)
                    .frame(maxWidth: maxWidth, maxHeight: maxHeight, alignment: alignment)
                    .transition(.opacity)
            } else if hasNoLogo {
                name
            } else {
                // Asking for the logo, or fetching it: the name's own height, unseen.
                name.opacity(0)
            }
        }
        .task(id: path) { await load() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        // Read and found as the title's text, whether it is drawn as a logo or as letters.
        .accessibilityAddTraits([.isHeader, .isStaticText])
    }

    private var name: some View {
        Text(title)
            .font(.custom(Theme.Face.archivo, size: nameSize * Theme.scale, relativeTo: .largeTitle))
            .textCase(.uppercase)
            .tracking(-0.03 * nameSize * Theme.scale)
            .lineSpacing(-0.14 * nameSize * Theme.scale)
            .foregroundStyle(Theme.Palette.fg)
            .multilineTextAlignment(alignment == .leading ? .leading : .center)
            .lineLimit(Platform.isTV || alignment == .leading ? 2 : 3)
            .minimumScaleFactor(0.5)
            .frame(maxWidth: .infinity, alignment: alignment)
    }

    private func load() async {
        image = nil
        failed = false
        guard let path, !path.isEmpty, let url = TMDBImage.url(path, size: .logo) else { return }
        guard let loaded = await ImagePipeline.shared.image(url, maxPixel: Platform.isTV ? 1200 : 800), !Task.isCancelled else {
            if !Task.isCancelled { failed = true }
            return
        }
        let measured = Self.tone(of: loaded)
        withAnimation(Theme.Motion.fade) {
            tone = measured
            image = loaded
        }
    }

    /// Draws the logo small and reads its pixels back (un-premultiplied, as `LogoTone` expects).
    private static func tone(of image: CGImage) -> LogoTone {
        let width = 48
        let height = max(1, width * image.height / max(1, image.width))
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return .mid }
        var i = 0
        while i + 3 < bytes.count {
            let alpha = Int(bytes[i + 3])
            if alpha > 0, alpha < 255 {
                for c in 0..<3 { bytes[i + c] = UInt8(min(255, Int(bytes[i + c]) * 255 / alpha)) }
            }
            i += 4
        }
        return LogoTone.of(rgba: bytes)
    }
}

private struct LogoFlip: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content.colorInvert().hueRotation(.degrees(180))
        } else {
            content
        }
    }
}

/// A dot for each title, the one on show wider, then a pause or play glyph when the lead turns by itself. On a phone the dots
/// are one adjustable element for VoiceOver ("Title 3 of 10", swipe up or down to change it) and the glyph a 44-point button.
/// On a Mac each dot is a button. On Apple TV the whole row is one focusable button: Left and Right turn the carousel, Select
/// stops or restarts the turning.
struct LeadDots: View {
    let count: Int
    let index: Int
    var rotation: HomeView.Rotation?
    let step: (Int) -> Void
    let select: (Int) -> Void
    var focus: FocusState<LeadFocus?>.Binding

    private var spoken: String { "Title \(index + 1) of \(count)" }

    var body: some View {
        #if os(tvOS)
        Button { rotation?.toggle() } label: { row }
            .buttonStyle(LeadDotsFocusStyle())
            .focused(focus, equals: .dots)
            .onMoveCommand { direction in
                switch direction {
                case .left: step(-1)
                case .right: step(1)
                default: break
                }
            }
            .accessibilityLabel(spoken)
            .accessibilityHint(rotation == nil ? "Left and right choose a title" : "Left and right choose a title. Select stops or restarts the turning")
            .accessibilityAdjustableAction { direction in
                step(direction == .increment ? 1 : -1)
            }
        #else
        HStack(spacing: 0) {
            // Keeps the dots centred on a phone while the button hangs off their end.
            if rotation != nil { Color.clear.frame(width: 44, height: 44) }
            dots
            if let rotation {
                Button { rotation.toggle() } label: {
                    Image(systemName: rotation.stopped ? "play.fill" : "pause.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.Palette.fg)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(rotation.stopped ? "Turn Automatic Rotation Back On" : "Stop Automatic Rotation")
            }
        }
        #endif
    }

    /// The marks alone.
    private var marks: some View {
        HStack(spacing: 10 * Theme.scale) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(i == index ? Theme.Palette.fg : Theme.Palette.fg.opacity(0.35))
                    .frame(width: (i == index ? 22 : 8) * Theme.scale, height: 8 * Theme.scale)
            }
        }
        .animation(Theme.Motion.state, value: index)
    }

    /// The row's contents on Apple TV: the marks, and the glyph that says whether the turning is on.
    private var row: some View {
        HStack(spacing: 16 * Theme.scale) {
            marks
            if let rotation {
                Image(systemName: rotation.stopped ? "play.fill" : "pause.fill")
                    .font(.system(size: 12 * Theme.scale, weight: .bold))
            }
        }
    }

    #if !os(tvOS)
    @ViewBuilder
    private var dots: some View {
        #if os(macOS)
        // A pointer is exact: each dot is a button.
        HStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { i in
                Button { select(i) } label: {
                    Capsule()
                        .fill(i == index ? Theme.Palette.fg : Theme.Palette.fg.opacity(0.35))
                        .frame(width: i == index ? 22 : 8, height: 8)
                        .frame(width: i == index ? 36 : 22, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Title \(i + 1) of \(count)")
                .accessibilityAddTraits(i == index ? .isSelected : [])
            }
        }
        .animation(Theme.Motion.state, value: index)
        #else
        marks
            .frame(height: 44)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
            .accessibilityAdjustableAction { direction in
                step(direction == .increment ? 1 : -1)
            }
        #endif
    }
    #endif
}

#if os(tvOS)
/// The dots row's focus: a capsule behind it that fills with the action colour, lifted, so something always looks focused.
private struct LeadDotsFocusStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        LeadDotsFocusBody(label: configuration.label)
    }
}

private struct LeadDotsFocusBody<Label: View>: View {
    let label: Label
    @Environment(\.isFocused) private var focused

    var body: some View {
        label
            .foregroundStyle(focused ? Theme.Palette.onBlue : Theme.Palette.fg)
            .padding(.horizontal, Theme.Space.m)
            .frame(height: 44 * Theme.scale)
            .background(Capsule().fill(focused ? Theme.Palette.blue : Theme.Palette.fg.opacity(0.12)))
            .scaleEffect(focused ? 1.06 : 1)
            .animation(Theme.Motion.snappy, value: focused)
    }
}
#endif

/// The lead's two controls: Resume (or Play) as a solid pill, Details as a round button with a ring. Hover (Mac, iPad pointer)
/// and focus (Apple TV) invert them to the action colour, as every control in the app does. These two are the app's only
/// round controls outside the player (web/DESIGN.md, Home Lead).
private struct HeroButtonStyle: ButtonStyle {
    enum Kind { case pill, circle }
    let kind: Kind

    func makeBody(configuration: Configuration) -> some View {
        HeroButtonBody(configuration: configuration, kind: kind)
    }
}

private struct HeroButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let kind: HeroButtonStyle.Kind
    @Environment(\.isFocused) private var focused
    @Environment(\.isEnabled) private var enabled
    @State private var hovering = false

    var body: some View {
        let lit = enabled && (focused || hovering)
        let size = 52 * Theme.scale
        let ink: Color = lit ? Theme.Palette.onBlue : kind == .pill ? Theme.Palette.bg : Theme.Palette.fg
        let fill: Color = lit ? (configuration.isPressed ? Theme.Palette.bluePressed : Theme.Palette.blue) : kind == .pill ? Theme.Palette.fg : Theme.Palette.fg.opacity(0.12)
        let ring: Color = lit ? Theme.Palette.blue : Theme.Palette.fg
        configuration.label
            .font(kind == .pill ? Theme.Typeface.control : .system(size: 18 * Theme.scale, weight: .bold))
            .controlText()
            .foregroundStyle(ink)
            .lineLimit(1)
            .padding(.horizontal, kind == .pill ? Theme.Space.l : 0)
            .frame(minWidth: kind == .pill ? 150 * Theme.scale : size, minHeight: size)
            .frame(width: kind == .circle ? size : nil)
            .background(fill, in: Capsule())
            .overlay(Capsule().strokeBorder(ring, lineWidth: Theme.Rule.heavy))
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Theme.Motion.hover, value: lit)
            .animation(Theme.Motion.state, value: configuration.isPressed)
            .modifier(FocusLift(scale: 1.06, ring: false))
            #if !os(tvOS)
            .onHover { hovering = $0 }
            #endif
    }
}

// MARK: - Up Next

/// What is in progress, and the next episodes, as framed stills with the time left under each and a red bar along the
/// foot of those you have started.
private struct UpNextSection: View {
    let leadEntryID: String?
    @Environment(AppModel.self) private var model
    @State private var items: [MediaKey: MediaItem] = [:]

    /// Most recent first, so a limit keeps the latest; the lead is already on the page.
    private var entries: [ContinueWatchingBuilder.Entry] {
        let all = model.continueWatching
        let limited = model.settings.general.continueWatchingLimit.map { Array(all.prefix($0)) } ?? all
        return limited.filter { $0.id != leadEntryID }
    }

    var body: some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                SectionHeader("Up Next", route: .library(.continueWatching))
                FilmScroller(ids: entries.map(\.id), itemWidth: Platform.landscapeWidth) {
                    ForEach(entries) { entry in
                        if let item = items[entry.key] { UpNextCell(entry: entry, item: item, width: Platform.landscapeWidth) }
                    }
                }
                .flowSwipeActionsContainer()
            }
            .task(id: entries.map(\.id)) {
                let hydrated = await model.hydrate(entries.map(\.key))
                var map = items
                for item in hydrated { if let key = item.key { map[key] = item } }
                // Coming back to the page re-runs this; unchanged titles shouldn't redraw the row.
                guard map != items else { return }
                withAnimation(Theme.Motion.fade) { items = map }
            }
        }
    }
}

/// A Continue Watching or Up Next item as a framed still: a red bar for how far in, the facts line for the rest.
struct UpNextCell: View {
    let entry: ContinueWatchingBuilder.Entry
    let item: MediaItem
    let width: CGFloat?
    @Environment(AppModel.self) private var model
    /// iOS 27 asks before a removal; earlier systems remove straight away.
    @State private var removing: ContinueWatchingBuilder.Entry?

    private var minutes: Int? { Reel.minutesLeft(progress: entry.progress, runtimeMinutes: item.runtimeMinutes) }

    private func requestRemoval() {
        if ItemDialogs.available { removing = entry } else { Task { await model.removeFromContinueWatching(entry) } }
    }

    private var strip: EdgePrint {
        let lead = entry.episode.map { ["S\($0.season) E\($0.episode)"] } ?? []
        let format = model.lastEdgeFormat(for: item)
        if entry.isNextUp {
            return EdgePrint(progress: 0, lead: lead, key: "Up next", endsInMinutes: minutes, tail: format)
        }
        return EdgePrint(progress: Reel.watchedFraction(entry.progress), lead: lead, key: minutes.map { Reel.compactLeft(minutes: $0) },
                         endsInMinutes: minutes, tail: format)
    }

    private var spoken: String {
        Reel.spokenListing(title: item.title, episode: entry.episode, minutesLeft: entry.isNextUp ? nil : minutes,
                                endsAt: minutes.map { Reel.endDate(from: Date(), minutesLeft: $0) },
                                extra: (entry.isNextUp ? ["up next"] : []) + model.lastEdgeFormat(for: item))
    }

    var body: some View {
        Button(action: open) {
            FilmCard(art: .still(item), strip: strip, title: item.title, meta: item.shortMeta, width: width, spoken: spoken)
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .contextMenu {
            Button { model.navigate(to: .detail(item)) } label: { Label("Go to Details", systemImage: "info.circle") }
            Button { Task { await model.setWatched(item, episodes: entry.episode.map { [$0] }, watched: true) } } label: {
                Label("Mark as Watched", systemImage: "checkmark.circle")
            }
            Button(role: .destructive) { requestRemoval() } label: { Label("Remove from Continue Watching", systemImage: "xmark.circle") }
        }
        .flowConfirmationDialog("Remove from Continue Watching?", item: $removing) { entry in
            Button("Remove", role: .destructive) { Task { await model.removeFromContinueWatching(entry) } }
        }
        // iOS 27: swipe the card for the same two quick actions.
        .flowSwipeActions {
            Button { Task { await model.setWatched(item, episodes: entry.episode.map { [$0] }, watched: true) } } label: {
                Label("Watched", systemImage: "checkmark.circle")
            }
            .tint(Theme.Palette.blue)
            Button(role: .destructive) { requestRemoval() } label: { Label("Remove", systemImage: "xmark.circle") }
        }
    }

    private func open() {
        if model.settings.playback.skipDetailsOnContinueWatching {
            Task { await model.play(item, episode: nil) }
        } else {
            model.navigate(to: .detail(item))
        }
    }
}

// MARK: - Rows

/// One shelf as a ruled section on the page: a red label over posters at one fixed size, each with its facts line.
private struct HomeRow: View {
    let shelf: ShelfConfig

    var body: some View {
        switch shelf.source {
        case .builtIn(.upcomingEpisodes):
            UpcomingRow(shelf: shelf)
        case .builtIn(.streamingServices):
            ServicesIndex(shelf: shelf)
        case .builtIn(.genres):
            IndexSection(title: shelf.title, entries: GenreTile.featured.map { genre in
                IndexSection.Entry(id: "genre-\(genre.id)", title: genre.name, meta: nil,
                                   shelf: ShelfConfig(id: "genre-\(genre.id)", title: genre.name, source: .discover(genre.query)))
            })
        default:
            PicksRow(shelf: shelf)
        }
    }
}

/// A catalogue shelf: posters, each with the runtime and rating under it in mono (and no bar: nothing is in progress).
private struct PicksRow: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var loaded = false
    /// Replaces the configured title when the row names its seed ("Because You Watched Dune").
    @State private var title: String?

    var body: some View {
        Group {
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader(title ?? shelf.title, route: .shelf(shelf))
                    PosterRow(items: items, context: shelf.id)
                }
                .transition(.opacity)
            } else if !loaded {
                ShelfPlaceholder(title: shelf.title)
            }
        }
        .animation(Theme.Motion.fade, value: items.isEmpty)
        .task(id: "\(shelf.id)-\(model.shelfReloadKey(for: shelf))") { await load() }
    }

    private func load() async {
        if case .builtIn(.becauseYouWatched) = shelf.source, let seed = model.becauseYouWatchedSeed,
           let source = await model.hydrate([seed]).first {
            title = "Because You Watched \(source.title)"
        }
        // Unchanged contents leave the row alone, so a reload never re-renders it.
        if let loadedItems = try? await model.shelfItems(for: shelf), loadedItems != items { items = loadedItems }
        loaded = true
    }
}

/// What is coming: stills with the air day in red in the facts line.
struct UpcomingRow: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var entries: [UpcomingEntry] = []

    var body: some View {
        Group {
            if !entries.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    SectionHeader(shelf.title, route: .shelf(shelf))
                    FilmScroller(ids: entries.map(\.id), itemWidth: Platform.landscapeWidth) {
                        ForEach(entries) { entry in
                            UpcomingCell(entry: entry, context: shelf.id)
                        }
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(Theme.Motion.fade, value: entries.isEmpty)
        .task(id: "\(model.contentVersion)-\(model.settings.general.upcomingWithinDays)-\(model.settings.general.includeWatchlistPremieres)-\(model.settings.general.filmDates.rawValue)") {
            entries = await model.upcoming()
        }
    }
}

private struct UpcomingCell: View {
    let entry: UpcomingEntry
    let context: String

    private var zoomID: String { "\(context)-\(entry.id)" }

    private var strip: EdgePrint {
        let air = Reel.airColumn(for: entry.date)
        return EdgePrint(lead: entry.episode.map { [$0.code] } ?? ["Film"], key: "\(air.label) \(air.day)")
    }

    var body: some View {
        let air = Reel.airColumn(for: entry.date)
        NavigationLink(value: Route.detail(entry.item, zoom: zoomID)) {
            FilmCard(art: .still(entry.item), strip: strip, title: entry.item.title, meta: entry.episode?.title ?? entry.item.shortMeta,
                     width: Platform.landscapeWidth,
                     spoken: Reel.spokenListing(title: entry.item.title, episode: entry.episode?.ref, extra: ["\(air.label) \(air.day)"]),
                     zoomID: zoomID)
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
        .contextMenu { MediaContextMenu(item: entry.item) } preview: { PosterPreview(item: entry.item) }
    }
}

/// A row that scrolls sideways, snapping to cards, with the Mac's paging arrows.
struct FilmScroller<ID: Hashable, Content: View>: View {
    let ids: [ID]
    let itemWidth: CGFloat
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: Platform.isTV ? 44 : 14) {
                content
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Platform.isTV ? 36 : 6)
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollClipDisabled()
        .pagingArrows(ids: ids, itemWidth: itemWidth + 14)
    }
}

/// Streaming services as a plain index: tapping one opens what is popular on it.
private struct ServicesIndex: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var services: [StreamingService] = []

    var body: some View {
        Group {
            if !services.isEmpty {
                let region = model.settings.metadata.region
                IndexSection(title: shelf.title, entries: services.map { service in
                    IndexSection.Entry(id: "service-\(service.id)", title: service.name, meta: nil,
                                       shelf: ShelfConfig(id: "service-\(service.id)-\(region)", title: service.name, source: .discover(service.query(region: region))))
                })
            }
        }
        .task(id: "\(model.settings.metadata.region)-\(model.contentVersion)") {
            services = await model.catalog?.streamingServices() ?? []
        }
    }
}

/// One media server's libraries, named in a plain index.
private struct ServerLibrariesIndex: View {
    let server: MediaServerConfig
    @Environment(AppModel.self) private var model
    @State private var libraries: [AppModel.ServerLibrary] = []

    var body: some View {
        Group {
            if !libraries.isEmpty {
                IndexSection(title: server.name, entries: libraries.map { entry in
                    IndexSection.Entry(id: entry.id, title: entry.library.name, meta: nil, shelf: entry.shelf)
                })
            }
        }
        .task(id: "\(server.id)-\(model.contentVersion)") {
            libraries = await model.serverLibraries(for: server.id)
        }
    }
}

/// Names that open a shelf (genres, services, a server's libraries), set as text in a grid of plain rows.
private struct IndexSection: View {
    struct Entry: Identifiable {
        let id: String
        let title: String
        var meta: String?
        let shelf: ShelfConfig
    }

    let title: String
    let entries: [Entry]
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader<Route>(title)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170 * Theme.scale), spacing: Theme.Space.m, alignment: .top)],
                      alignment: .leading, spacing: 0) {
                ForEach(entries) { entry in
                    ProgrammeRow(title: entry.title, meta: entry.meta, action: { model.navigate(to: .shelf(entry.shelf)) })
                }
            }
            .padding(.horizontal, Theme.Space.gutter - ProgrammeMetrics.inset)
        }
    }
}

/// Listings, one after another, inset so their text lines up with the page's headings.
struct ProgrammeList<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 0) { content }
            .padding(.horizontal, Theme.Space.gutter - ProgrammeMetrics.inset)
    }
}

extension AppModel {
    /// What a shelf's contents depend on. Catalogue rows (trending, popular, Discover) don't change
    /// when you mark something watched, so they don't reload with every library change.
    func shelfReloadKey(for shelf: ShelfConfig) -> String {
        // Language and region change what TMDb returns, so they reload catalogue rows too.
        var filters = "\(settings.general.contentShelfLength)-\(settings.metadata.showUnreleasedTitles)-\(settings.metadata.language)-\(settings.metadata.region)"
        // Filtering to your servers depends on their index, which refreshes with the library.
        if settings.mediaServers.onlyShowServerContent { filters += "-\(contentVersion)" }
        switch shelf.source {
        case .builtIn(let builtIn) where builtIn.isContentShelf && builtIn != .recommendedForYou && builtIn != .becauseYouWatched:
            return filters
        case .discover:
            return filters
        default:
            return "\(filters)-\(contentVersion)"
        }
    }

    /// ["2160p", "DV"]: what this title last played as, when Remember Last Source is on and it has played.
    func lastEdgeFormat(for item: MediaItem) -> [String] {
        guard settings.sources.rememberLastSource, let key = item.key?.description,
              let last = settings.sources.lastSources[key] else { return [] }
        return last.edgeFormat
    }
}

/// "Show All" for any shelf. A streaming service's page offers Movies or TV Shows.
struct ShelfGridView: View {
    let shelf: ShelfConfig
    @State private var type: MediaType?

    private var providerQuery: DiscoverQuery? {
        if case .discover(let query) = shelf.source, !query.watchProviders.isEmpty { return query }
        return nil
    }

    /// The shelf with the picked type applied.
    private var typed: ShelfConfig {
        guard let type, var query = providerQuery else { return shelf }
        query.type = type
        var copy = shelf
        copy.source = .discover(query)
        return copy
    }

    var body: some View {
        VStack(spacing: 0) {
            if let query = providerQuery {
                SegmentedTabs(options: [(value: MediaType.movie, title: "Movies"), (value: MediaType.show, title: "TV Shows")],
                              selection: Binding(get: { type ?? query.type }, set: { type = $0 }))
                .frame(maxWidth: 360 * Theme.scale)
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.vertical, Theme.Space.xs)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            ShelfGridContent(shelf: typed).id(type)
        }
        .flowPageTitle(shelf.title, inset: Theme.Space.gutter)
    }
}

/// One type's worth of a shelf, with paging where the source supports it.
private struct ShelfGridContent: View {
    let shelf: ShelfConfig
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []
    @State private var page = 0
    @State private var hasMore = true
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            PosterGrid(items: items) { Task { await loadMore() } }
                .padding(.vertical)
            if loading { ProgressView().padding() }
            if let error, items.isEmpty {
                ContentUnavailableView("Couldn't Load", systemImage: "exclamationmark.triangle", description: Text(error))
            }
        }
        .task {
            guard items.isEmpty else { return }
            await loadMore()
            // Filters can leave a page empty, and an empty grid never reaches its end to ask for the next one.
            var extra = 0
            while items.isEmpty, hasMore, error == nil, extra < 4 {
                extra += 1
                await loadMore()
            }
        }
    }

    private func loadMore() async {
        guard hasMore, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let next = try await model.page(for: shelf, page: page + 1)
            var seen = Set(items.map(\.id))
            items += next.items.filter { seen.insert($0.id).inserted }
            page = next.page
            hasMore = next.hasMore
        } catch {
            self.error = error.localizedDescription
            hasMore = false
        }
    }
}

#if os(iOS)
/// The lead's swipe. From iOS 18 a SwiftUI drag inside a scroll view takes the touch even as a simultaneous gesture, so a
/// page that starts scrolling on the picture didn't move. There a UIKit pan does the work, and it only begins when the
/// finger sets off more sideways than up or down, leaving every other drag to the page. iOS 17 keeps the SwiftUI drag,
/// which shares the touch as it should.
private struct LeadSwipe<Fallback: Gesture>: ViewModifier {
    let fallback: Fallback
    let changed: (CGFloat) -> Void
    let ended: (_ translation: CGFloat, _ velocity: CGFloat) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.gesture(SidewaysPan(changed: changed, ended: ended))
        } else {
            content.simultaneousGesture(fallback)
        }
    }
}

@available(iOS 18.0, *)
private struct SidewaysPan: UIGestureRecognizerRepresentable {
    let changed: (CGFloat) -> Void
    let ended: (_ translation: CGFloat, _ velocity: CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        return pan
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        let translation = pan.translation(in: pan.view).x
        switch pan.state {
        case .began, .changed:
            changed(translation)
        case .ended:
            ended(translation, pan.velocity(in: pan.view).x)
        case .cancelled, .failed:
            // Taken away mid-move: settle back rather than stay between two slides.
            ended(0, 0)
        default:
            break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return true }
            let velocity = pan.velocity(in: pan.view)
            return abs(velocity.x) > abs(velocity.y)
        }
    }
}
#endif
