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
        .flowModal(isPresented: Binding(get: { model.pendingImport != nil }, set: { if !$0 { model.pendingImport = nil } })) {
            NavigationStack { ImportSetupView() }
                .environment(model)
        }
        .flowModal(item: $model.sourcePickerRequest, onDismiss: { model.promotePendingPlayback() }) { request in
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
        .flowModal(isPresented: $model.showSettings) {
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
        shellContent.background(Theme.Palette.canvas.ignoresSafeArea())
    }

    @ViewBuilder
    private var shellContent: some View {
        #if os(macOS)
        MacShell()
        #else
        TabShell()
        #endif
    }
}

/// iOS / iPadOS / tvOS tab bar. iOS 18+ uses the Tab API (search role, iPad sidebar);
/// iOS 26 adds the Liquid Glass tab bar that minimises while scrolling.
struct TabShell: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        if #available(iOS 18.0, tvOS 18.0, macOS 15.0, *) {
            TabView(selection: $model.selectedTab) {
                ForEach(AppTab.allCases) { tab in
                    Tab(tab.title, systemImage: tab.systemImage, value: tab, role: tab == .search ? .search : nil) {
                        stack(for: tab)
                    }
                }
            }
            .modifier(ModernTabChrome())
        } else {
            TabView(selection: $model.selectedTab) {
                ForEach(AppTab.allCases) { tab in
                    stack(for: tab)
                        .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                        .tag(tab)
                }
            }
        }
    }

    func stack(for tab: AppTab) -> some View {
        NavigationStack(path: model.path(for: tab)) {
            ZoomNamespaceProvider {
                screen(for: tab)
                    .flowDestinations()
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

@available(iOS 18.0, tvOS 18.0, macOS 15.0, *)
private struct ModernTabChrome: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        minimize(content.tabViewStyle(.sidebarAdaptable))
        #else
        content
        #endif
    }

    #if os(iOS)
    @ViewBuilder
    private func minimize(_ view: some View) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            view.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            view
        }
        #else
        view
        #endif
    }
    #endif
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
                ZoomNamespaceProvider {
                    TabShell().screen(for: model.selectedTab)
                        .flowDestinations()
                }
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
            case .detail(let item, let zoom): DetailView(item: item).zoomDestination(zoom)
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

extension View {
    /// Sheets on iPhone, iPad and Mac; full screen on Apple TV, where sheets are small cards.
    @ViewBuilder
    func flowModal<Item: Identifiable, Content: View>(item: Binding<Item?>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping (Item) -> Content) -> some View {
        #if os(tvOS)
        fullScreenCover(item: item, onDismiss: onDismiss, content: content)
        #else
        sheet(item: item, onDismiss: onDismiss, content: content)
        #endif
    }

    @ViewBuilder
    func flowModal<Content: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) -> some View {
        #if os(tvOS)
        fullScreenCover(isPresented: isPresented, onDismiss: onDismiss, content: content)
        #else
        sheet(isPresented: isPresented, onDismiss: onDismiss, content: content)
        #endif
    }
}
