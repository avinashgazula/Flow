import SwiftUI
import FlowKit

struct SourcesSettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        List {
            Section {
                Toggle(isOn: $model.settings.sources.useCustomOrdering) {
                    Label("Use Custom Source Ordering", systemImage: "list.number")
                }
            } footer: {
                Text("Adds the sort rules, filters and result cap below. Category and provider order apply whether this is on or off. Your Preferred Resolution cap from Playback still applies above everything here.")
            }

            Section {
                NavigationLink(value: Route.settings(.sourceAppearance)) { Label("Source Appearance", systemImage: "textformat") }
            } footer: { Text("Formatting, title display and badge packs.") }

            Section {
                ForEach(model.settings.sources.categoryOrder) { category in
                    HStack(spacing: 12) {
                        Image(systemName: category.systemImage).foregroundStyle(.secondary).frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(category.displayName)
                            let count = model.providerEntries(for: category).count
                            Text(count == 0 ? "Not configured" : "\(count) provider\(count == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        #if os(tvOS)
                        moveButtons(category)
                        #endif
                    }
                    .contextMenu { categoryMenu(category) }
                }
                .onMove { model.settings.sources.categoryOrder.move(fromOffsets: $0, toOffset: $1) }
            } header: {
                Text("Category Order")
            } footer: {
                Text("Sources from earlier categories appear first in the player picker. Category and provider order work on their own — the switch above is only for the sort rules, filters and result cap.")
            }

            ForEach(model.settings.sources.categoryOrder) { category in
                let providers = model.providerEntries(for: category)
                if providers.count > 0 {
                    Section(category.displayName) {
                        ForEach(providers, id: \.id) { provider in
                            Label(provider.name, systemImage: category.systemImage)
                                .contextMenu { providerMenu(category, provider.id) }
                        }
                        .onMove { from, to in moveProvider(category, from: from, to: to) }
                    }
                }
            }

            Section {
                NavigationLink(value: Route.settings(.addons)) {
                    LabeledContent("Stream Add-ons", value: "\(model.settings.sources.addons.count)")
                }
                Toggle("Auto-Play Best Source", isOn: $model.settings.sources.autoPlayFirstSource)
                Picker("Provider Timeout", selection: $model.settings.sources.timeoutSeconds) {
                    ForEach([5.0, 10, 15, 20, 30], id: \.self) { Text("\(Int($0)) seconds").tag($0) }
                }
            }

            if model.settings.sources.useCustomOrdering {
                sortRulesSection
                filtersSection
                Section {
                    Picker("Result Cap", selection: Binding(get: { model.settings.sources.resultCap ?? 0 }, set: { model.settings.sources.resultCap = $0 == 0 ? nil : $0 })) {
                        Text("No Limit").tag(0)
                        ForEach([5, 10, 15, 20, 30, 50], id: \.self) { Text("\($0) sources").tag($0) }
                    }
                } footer: { Text("Shows at most this many sources after sorting and filtering.") }
            }
        }
        #if os(iOS)
        .toolbar { EditButton() }
        #endif
    }

    private var sortRulesSection: some View {
        @Bindable var model = model
        return Section {
            ForEach($model.settings.sources.sortRules) { $rule in
                HStack {
                    Text(rule.key.title)
                    Spacer()
                    Button(rule.descending ? "Best First" : "Lowest First") { rule.descending.toggle() }
                        .font(.caption).buttonStyle(.bordered)
                }
                .contextMenu {
                    Button(role: .destructive) { model.settings.sources.sortRules.removeAll { $0.key == rule.key } } label: { Label("Remove", systemImage: "trash") }
                }
            }
            .onMove { model.settings.sources.sortRules.move(fromOffsets: $0, toOffset: $1) }
            .onDelete { model.settings.sources.sortRules.remove(atOffsets: $0) }
            let unused = SourceSortKey.allCases.filter { key in !model.settings.sources.sortRules.contains { $0.key == key } }
            if !unused.isEmpty {
                Menu {
                    ForEach(unused) { key in Button(key.title) { model.settings.sources.sortRules.append(SourceSortRule(key: key)) } }
                } label: { Label("Add Rule", systemImage: "plus") }
            }
        } header: {
            Text("Sort Rules")
        } footer: {
            Text("Applied top to bottom within each provider.")
        }
    }

    private var filtersSection: some View {
        @Bindable var model = model
        return Section("Filters") {
            Toggle("Hide CAM / TS / Screeners", isOn: $model.settings.sources.filters.excludeCinemaCaptures)
            Toggle("Hide Uncached Torrents", isOn: $model.settings.sources.filters.excludeUncached)
            Picker("Minimum Resolution", selection: $model.settings.sources.filters.minResolution) {
                Text("Any").tag(VideoResolution.unknown)
                ForEach([VideoResolution.sd, .hd720, .hd1080, .uhd4k]) { Text($0.label).tag($0) }
            }
            Picker("Maximum Size", selection: Binding(get: { model.settings.sources.filters.maxSizeGB ?? 0 }, set: { model.settings.sources.filters.maxSizeGB = $0 == 0 ? nil : $0 })) {
                Text("No Limit").tag(0.0)
                ForEach([2.0, 5, 10, 20, 40, 80], id: \.self) { Text("\(Int($0)) GB").tag($0) }
            }
            Picker("Minimum Size", selection: Binding(get: { model.settings.sources.filters.minSizeGB ?? 0 }, set: { model.settings.sources.filters.minSizeGB = $0 == 0 ? nil : $0 })) {
                Text("None").tag(0.0)
                ForEach([0.5, 1, 2, 5], id: \.self) { Text(String(format: "%g GB", $0)).tag($0) }
            }
            KeywordField(title: "Exclude Keywords", values: $model.settings.sources.filters.excludedKeywords)
            KeywordField(title: "Require Any Keyword", values: $model.settings.sources.filters.requiredKeywords)
            KeywordField(title: "Preferred Languages", values: $model.settings.sources.filters.preferredLanguages)
            KeywordField(title: "Exclude Codecs (e.g. AV1)", values: $model.settings.sources.filters.excludedCodecs)
        }
    }

    @ViewBuilder
    private func categoryMenu(_ category: SourceCategory) -> some View {
        let order = model.settings.sources.categoryOrder
        if let i = order.firstIndex(of: category) {
            if i > 0 { Button("Move Up") { model.settings.sources.categoryOrder.move(fromOffsets: [i], toOffset: i - 1) } }
            if i < order.count - 1 { Button("Move Down") { model.settings.sources.categoryOrder.move(fromOffsets: [i], toOffset: i + 2) } }
        }
    }

    #if os(tvOS)
    private func moveButtons(_ category: SourceCategory) -> some View {
        HStack {
            Button { if let i = model.settings.sources.categoryOrder.firstIndex(of: category), i > 0 { model.settings.sources.categoryOrder.move(fromOffsets: [i], toOffset: i - 1) } } label: { Image(systemName: "chevron.up") }
            Button { if let i = model.settings.sources.categoryOrder.firstIndex(of: category), i < model.settings.sources.categoryOrder.count - 1 { model.settings.sources.categoryOrder.move(fromOffsets: [i], toOffset: i + 2) } } label: { Image(systemName: "chevron.down") }
        }
    }
    #endif

    @ViewBuilder
    private func providerMenu(_ category: SourceCategory, _ id: String) -> some View {
        let ids = model.providerEntries(for: category).map(\.id)
        if let i = ids.firstIndex(of: id) {
            if i > 0 { Button("Move Up") { moveProvider(category, from: [i], to: i - 1) } }
            if i < ids.count - 1 { Button("Move Down") { moveProvider(category, from: [i], to: i + 2) } }
        }
    }

    private func moveProvider(_ category: SourceCategory, from: IndexSet, to: Int) {
        var ids = model.providerEntries(for: category).map(\.id)
        ids.move(fromOffsets: from, toOffset: to)
        model.settings.sources.providerOrder[category.rawValue] = ids
    }
}

/// Comma-separated list editor.
struct KeywordField: View {
    let title: String
    @Binding var values: [String]
    @State private var text = ""

    var body: some View {
        TextField(title, text: $text, prompt: Text(title))
            .autocorrectionDisabled()
            .onAppear { text = values.joined(separator: ", ") }
            .onSubmit { commit() }
            .onChange(of: text) { _, _ in commit() }
    }

    private func commit() {
        values = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}

struct SourceAppearanceView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                Toggle("Show Add-on Formatting", isOn: $model.settings.sources.appearance.showRawText)
                Picker("Title", selection: $model.settings.sources.appearance.titleDisplay) {
                    ForEach(SourceTitleDisplay.allCases) { Text($0.title).tag($0) }
                }
                Picker("Badges", selection: $model.settings.sources.appearance.badgePack) {
                    ForEach(BadgePack.allCases) { Text($0.rawValue.capitalized).tag($0) }
                }
                Toggle("Show File Size", isOn: $model.settings.sources.appearance.showSize)
                Toggle("Compact Rows", isOn: $model.settings.sources.appearance.compact)
            } footer: {
                Text("Add-on formatting shows each add-on's own text (emoji and all). Turn it off for a clean summary parsed from the release name.")
            }
            Section("Preview") {
                SourceRow(source: Self.sample, appearance: model.settings.sources.appearance)
            }
        }
    }

    static let sample: StreamSource = {
        let text = "AIOStreams\n🧿 1080p 🎫\nWEB-DL\n🔊 AAC\n📦 3.98 GB\n🌎 English"
        return StreamSource(id: "sample", category: .addons, providerID: "sample", providerName: "AIOStreams", title: text, detail: text,
                            filename: "Movie.2026.1080p.WEB-DL.AAC.H264-GROUP.mkv", location: .url(URL(string: "https://example.invalid")!, headers: [:]),
                            traits: StreamParser.parse(text, "Movie.2026.1080p.WEB-DL.AAC.H264-GROUP.mkv"))
    }()
}

struct AddonsSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var manifestText = ""
    @State private var adding = false
    @State private var error: String?

    var body: some View {
        @Bindable var model = model
        List {
            Section {
                ForEach($model.settings.sources.addons) { $addon in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(addon.name).font(.headline)
                            Text(addon.manifestURL.host ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Toggle("", isOn: $addon.enabled).labelsHidden()
                    }
                    .contextMenu {
                        #if !os(tvOS)
                        Button { Platform.copyToPasteboard(addon.manifestURL.absoluteString) } label: { Label("Copy Manifest URL", systemImage: "doc.on.doc") }
                        #endif
                        Button(role: .destructive) { model.settings.sources.addons.removeAll { $0.id == addon.id } } label: { Label("Remove", systemImage: "trash") }
                    }
                }
                .onDelete { model.settings.sources.addons.remove(atOffsets: $0) }
                .onMove { model.settings.sources.addons.move(fromOffsets: $0, toOffset: $1) }
            } header: {
                Text("Installed")
            }
            Section {
                TextField("Manifest URL", text: $manifestText, prompt: Text("https://…/manifest.json"))
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                #if !os(tvOS)
                Button("Paste") { manifestText = Platform.pasteboardString() ?? manifestText }
                #endif
                Button {
                    Task { await add() }
                } label: { HStack { Text("Install Add-on"); if adding { Spacer(); ProgressView() } } }
                .disabled(manifestText.isEmpty || adding)
                if let error { Text(error).font(.caption).foregroundStyle(.red) }
            } header: {
                Text("Add")
            } footer: {
                Text("Paste the manifest link from a Stremio-compatible add-on's configure page (for example AIOStreams). Only add-ons that provide streams are used.")
            }
        }
        #if os(iOS)
        .toolbar { EditButton() }
        #endif
    }

    private func add() async {
        let trimmed = manifestText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed.hasPrefix("stremio://") ? "https://" + trimmed.dropFirst("stremio://".count) : trimmed) else {
            error = "That link doesn't look right."
            return
        }
        adding = true
        defer { adding = false }
        do {
            let manifest = try await AddonClient.fetchManifest(url, http: model.http)
            guard manifest.resources.contains(where: { r in
                switch r {
                case .name(let n): return n == "stream"
                case .detailed(let n, _, _): return n == "stream"
                }
            }) else {
                error = "\(manifest.name) doesn't provide streams."
                return
            }
            let config = AddonConfig(manifestURL: url, name: manifest.name)
            model.settings.sources.addons.removeAll { $0.id == config.id }
            model.settings.sources.addons.append(config)
            manifestText = ""
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
