import SwiftUI
import FlowKit

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        ZStack(alignment: .top) {
            if model.needsOnboarding || model.previewOnboarding {
                OnboardingView()
            } else {
                shell
                    .disabled(model.activePlayback != nil)
                    .accessibilityHidden(model.activePlayback != nil)
            }
            if let session = model.activePlayback {
                // The player is a layer, not a modal, so it never races sheet dismissals.
                PlayerView(session: session)
                    .ignoresSafeArea()
                    .transition(.opacity.combined(with: .scale(scale: 1.02)))
                    .zIndex(20)
            }
            if let toast = model.toast {
                ToastView(message: toast).padding(.top, 8).zIndex(30)
            }
        }
        .animation(.spring(duration: 0.35), value: model.toast)
        .animation(Theme.Motion.gentle, value: model.activePlayback?.id)
        #if os(macOS)
        .toolbar(model.activePlayback == nil ? .automatic : .hidden, for: .windowToolbar)
        #endif
        .flowModal(isPresented: Binding(get: { model.pendingImport != nil }, set: { if !$0 { model.pendingImport = nil } })) {
            NavigationStack { ImportSetupView() }
                .environment(model)
        }
        .flowModal(item: $model.sourcePickerRequest) { request in
            SourcePickerView(request: request)
                .environment(model)
        }
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
            #if os(tvOS)
            .background(Theme.Palette.canvas.ignoresSafeArea())
            #endif
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
/// macOS: a fixed sidebar beside the content. (A floating split-view sidebar lets content
/// slide underneath it, which breaks full-bleed heroes and grids.)
struct MacShell: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 0) {
            sidebar
                .frame(width: 210)
                .background(.regularMaterial)
            Divider().opacity(0.4)
            NavigationStack(path: model.path(for: model.selectedTab)) {
                ZoomNamespaceProvider {
                    TabShell().screen(for: model.selectedTab)
                        .flowDestinations()
                }
            }
            .id(model.selectedTab)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        // Shelves scroll sideways with a trackpad or the Shift-wheel; a legacy scroller under every row is clutter.
        .scrollIndicators(.never, axes: .horizontal)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Flow")
                .font(.system(size: 22, weight: .bold))
                .padding(.horizontal, 14)
                .padding(.top, 34)
                .padding(.bottom, 14)
            ForEach(AppTab.allCases) { tab in
                Button { model.selectedTab = tab } label: {
                    Label(tab.title, systemImage: tab.systemImage)
                        .font(.system(size: 13, weight: .medium))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(model.selectedTab == tab ? Color.white.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 8)
            }
            Spacer()
            if let profile = model.profile {
                Label(profile.displayName ?? profile.username, systemImage: "person.crop.circle")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .padding(14)
            }
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
            case .calendar: CalendarView()
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
