import SwiftUI
import FlowKit

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        ZStack(alignment: .top) {
            if model.needsOnboarding {
                OnboardingView()
            } else {
                shell
            }
            if let toast = model.toast {
                ToastView(message: toast).padding(.top, 8).zIndex(10)
            }
        }
        .animation(.spring(duration: 0.35), value: model.toast)
        .sheet(isPresented: Binding(get: { model.pendingImport != nil }, set: { if !$0 { model.pendingImport = nil } })) {
            NavigationStack { ImportSetupView() }
                .environment(model)
        }
        .sheet(item: $model.sourcePickerRequest) { request in
            SourcePickerView(request: request)
                .environment(model)
        }
        #if os(macOS)
        .sheet(item: $model.activePlayback) { session in
            PlayerView(session: session).environment(model)
        }
        #else
        .fullScreenCover(item: $model.activePlayback) { session in
            PlayerView(session: session).environment(model)
        }
        #endif
        #if !os(macOS)
        .sheet(isPresented: $model.showSettings) {
            NavigationStack(path: $model.settingsPath) {
                SettingsRootView()
                    .flowDestinations()
                    .toolbar {
                        #if !os(tvOS)
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { model.showSettings = false } }
                        #endif
                    }
            }
            .environment(model)
        }
        #endif
    }

    @ViewBuilder
    private var shell: some View {
        #if os(macOS)
        MacShell()
        #else
        TabShell()
        #endif
    }
}

/// iOS / iPadOS / tvOS tab bar.
struct TabShell: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            ForEach(AppTab.allCases) { tab in
                NavigationStack(path: model.path(for: tab)) {
                    screen(for: tab)
                        .flowDestinations()
                }
                .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                .tag(tab)
            }
        }
    }

    @ViewBuilder
    func screen(for tab: AppTab) -> some View {
        switch tab {
        case .home: HomeView()
        case .explore: ExploreView()
        case .library: LibraryView()
        case .liveTV: LiveTVView()
        case .search: SearchView()
        }
    }
}

#if os(macOS)
/// macOS sidebar layout.
struct MacShell: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationSplitView {
            List(selection: Binding<AppTab?>(get: { model.selectedTab }, set: { if let t = $0 { model.selectedTab = t } })) {
                Section("Flow") {
                    ForEach(AppTab.allCases) { tab in
                        Label(tab.title, systemImage: tab.systemImage).tag(tab)
                    }
                }
                if let profile = model.profile {
                    Section("Account") {
                        Label(profile.displayName ?? profile.username, systemImage: "person.crop.circle")
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 210)
        } detail: {
            NavigationStack(path: model.path(for: model.selectedTab)) {
                TabShell().screen(for: model.selectedTab)
                    .flowDestinations()
            }
            .id(model.selectedTab)
        }
    }
}
#endif

extension View {
    /// Registers every Route destination on a NavigationStack.
    func flowDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .detail(let item): DetailView(item: item)
            case .person(let id, let name): PersonView(personID: id, name: name)
            case .shelf(let shelf): ShelfGridView(shelf: shelf)
            case .library(let list): LibraryListView(list: list)
            case .collection(let id, let name): CollectionView(collectionID: id, name: name)
            case .settings(let page): SettingsPageView(page: page)
            case .sports: SportsView()
            case .downloads: DownloadsView()
            case .channelGroup(let group): ChannelGroupView(group: group)
            }
        }
    }
}
