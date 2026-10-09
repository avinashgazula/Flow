import SwiftUI
import FlowKit

struct ShelvesSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var editing: ShelfConfig?
    @State private var addingDiscover = false
    @State private var addingList = false

    var body: some View {
        @Bindable var model = model
        List {
            Section {
                ForEach($model.settings.shelves) { $shelf in
                    HStack {
                        Image(systemName: icon(shelf.source)).foregroundStyle(.secondary).frame(width: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(shelf.title)
                            Text(subtitle(shelf.source)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Toggle("", isOn: $shelf.enabled).labelsHidden()
                    }
                    .contextMenu { rowMenu(shelf) }
                }
                .onMove { model.settings.shelves.move(fromOffsets: $0, toOffset: $1) }
                .onDelete { offsets in
                    let removable = offsets.filter { !isBuiltIn(model.settings.shelves[$0]) }
                    model.settings.shelves.remove(atOffsets: IndexSet(removable))
                }
            } header: {
                Text("Home Shelves")
            } footer: {
                Text("Turn rows on or off and drag to reorder. Long-press for more options.")
            }

            Section("Add Shelf") {
                Button { addingDiscover = true } label: { Label("Discover Shelf…", systemImage: "sparkles.rectangle.stack") }
                Button { addingList = true } label: { Label("List Shelf…", systemImage: "list.bullet.rectangle") }
                let missing = BuiltInShelf.allCases.filter { b in !model.settings.shelves.contains { $0.source == .builtIn(b) } }
                if !missing.isEmpty {
                    Menu {
                        ForEach(missing, id: \.self) { b in
                            Button(b.title) { model.settings.shelves.append(.builtIn(b)) }
                        }
                    } label: { Label("Built-in Shelf", systemImage: "plus.rectangle.on.rectangle") }
                }
                Button("Restore Defaults", role: .destructive) { model.settings.shelves = ShelfConfig.defaults }
            }
        }
        #if os(iOS)
        .toolbar { EditButton() }
        #endif
        .sheet(isPresented: $addingDiscover) {
            DiscoverShelfEditor(shelf: nil).environment(model)
        }
        .sheet(item: $editing) { shelf in
            DiscoverShelfEditor(shelf: shelf).environment(model)
        }
        .sheet(isPresented: $addingList) {
            ListShelfPicker().environment(model)
        }
    }

    @ViewBuilder
    private func rowMenu(_ shelf: ShelfConfig) -> some View {
        if let index = model.settings.shelves.firstIndex(of: shelf) {
            if index > 0 {
                Button { model.settings.shelves.move(fromOffsets: [index], toOffset: index - 1) } label: { Label("Move Up", systemImage: "arrow.up") }
            }
            if index < model.settings.shelves.count - 1 {
                Button { model.settings.shelves.move(fromOffsets: [index], toOffset: index + 2) } label: { Label("Move Down", systemImage: "arrow.down") }
            }
            if case .discover = shelf.source {
                Button { editing = shelf } label: { Label("Edit", systemImage: "slider.horizontal.3") }
            }
            if !isBuiltIn(shelf) {
                Button(role: .destructive) { model.settings.shelves.remove(at: index) } label: { Label("Delete", systemImage: "trash") }
            }
        }
    }

    private func isBuiltIn(_ shelf: ShelfConfig) -> Bool {
        if case .builtIn = shelf.source { return true }
        return false
    }

    private func icon(_ source: ShelfSource) -> String {
        switch source {
        case .builtIn: return "star"
        case .discover: return "sparkles"
        case .traktList: return "checkmark.circle"
        case .mdblist: return "star.square.on.square"
        case .mediaServerLibrary: return "server.rack"
        }
    }

    private func subtitle(_ source: ShelfSource) -> String {
        switch source {
        case .builtIn: return "Built-in"
        case .discover(let q):
            var parts = [q.type == .movie ? "Movies" : "Shows", q.sort.title]
            if !q.genres.isEmpty { parts.append(q.genres.map { TMDBGenres.name(for: $0, type: q.type) }.joined(separator: ", ")) }
            if q.targetsFuture { parts.append("Upcoming") }
            return "Discover · " + parts.joined(separator: " · ")
        case .traktList(let user, let slug): return "Trakt · \(user)/\(slug)"
        case .mdblist(let id): return "MDBList · #\(id)"
        case .mediaServerLibrary: return "Media Server Library"
        }
    }
}

struct DiscoverShelfEditor: View {
    let shelf: ShelfConfig?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var query = DiscoverQuery()
    @State private var showFilters = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Shelf Title", text: $title)
                Picker("Type", selection: $query.type) {
                    Text("Movies").tag(MediaType.movie)
                    Text("TV Shows").tag(MediaType.show)
                }
                Button("Filters…") { showFilters = true }
                Section("Preview") {
                    DiscoverPreview(query: query)
                }
            }
            .navigationTitle(shelf == nil ? "New Discover Shelf" : "Edit Shelf")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .sheet(isPresented: $showFilters) { DiscoverFilterView(query: $query).environment(model) }
            .onAppear {
                if let shelf, case .discover(let q) = shelf.source {
                    title = shelf.title
                    query = q
                }
            }
        }
    }

    private func save() {
        if let shelf, let index = model.settings.shelves.firstIndex(where: { $0.id == shelf.id }) {
            model.settings.shelves[index].title = title
            model.settings.shelves[index].source = .discover(query)
        } else {
            model.settings.shelves.append(ShelfConfig(title: title, source: .discover(query)))
        }
        dismiss()
    }
}

private struct DiscoverPreview: View {
    let query: DiscoverQuery
    @Environment(AppModel.self) private var model
    @State private var items: [MediaItem] = []

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items.prefix(12)) { item in
                    RemoteImage(url: item.posterURL).frame(width: 60, height: 90).clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
        }
        .frame(height: 96)
        .task(id: query) { items = (try? await model.catalog?.discover(query))?.items ?? [] }
    }
}

/// Adds Trakt, MDBList or media-server library shelves.
struct ListShelfPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var traktLists: [TraktClient.ListSummary] = []
    @State private var mdbLists: [MDBListClient.UserList] = []
    @State private var libraries: [(MediaServerConfig, MediaLibrary)] = []
    @State private var traktUser = ""
    @State private var traktSlug = ""

    var body: some View {
        NavigationStack {
            Form {
                if model.trakt != nil {
                    Section("Trakt") {
                        ForEach(traktLists, id: \.ids.slug) { list in
                            Button(list.name) { add(list.name, .traktList(user: "me", slug: list.ids.slug)) }
                        }
                        TextField("Username", text: $traktUser).autocorrectionDisabled()
                        TextField("List slug", text: $traktSlug).autocorrectionDisabled()
                        Button("Add Public List") { add(traktSlug, .traktList(user: traktUser, slug: traktSlug)) }
                            .disabled(traktUser.isEmpty || traktSlug.isEmpty)
                    }
                }
                if model.mdblist != nil {
                    Section("MDBList") {
                        if mdbLists.isEmpty { Text("No lists found").foregroundStyle(.secondary) }
                        ForEach(mdbLists) { list in
                            Button("\(list.name) (\(list.itemCount))") { add(list.name, .mdblist(id: list.id)) }
                        }
                    }
                }
                if !libraries.isEmpty {
                    Section("Media Server Libraries") {
                        ForEach(libraries, id: \.1.id) { server, library in
                            Button("\(library.name) — \(server.name)") { add(library.name, .mediaServerLibrary(serverID: server.id, libraryID: library.id)) }
                        }
                    }
                }
                if model.trakt == nil && model.mdblist == nil && model.mediaServers.isEmpty {
                    Text("Connect Trakt, add an MDBList key or a media server to add list shelves.").foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Add List Shelf")
            .inlineNavigationTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                if model.credentials.traktToken != nil { traktLists = (try? await model.trakt?.myLists()) ?? [] }
                mdbLists = (try? await model.mdblist?.myLists()) ?? []
                var found: [(MediaServerConfig, MediaLibrary)] = []
                for server in model.mediaServers {
                    for library in (try? await server.libraries()) ?? [] { found.append((server.config, library)) }
                }
                libraries = found
            }
        }
    }

    private func add(_ title: String, _ source: ShelfSource) {
        model.settings.shelves.append(ShelfConfig(title: title, source: source))
        dismiss()
    }
}
