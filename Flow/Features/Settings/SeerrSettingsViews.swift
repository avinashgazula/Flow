import SwiftUI
import FlowKit

/// The "Requests" section of Media Servers settings: connect or disconnect a Seerr instance.
struct SeerrSettingsSection: View {
    @Environment(AppModel.self) private var model
    @State private var connecting = false

    var body: some View {
        Section {
            if let seerr = model.settings.mediaServers.seerr {
                LabeledContent("Seerr", value: seerr.baseURL.host ?? seerr.baseURL.absoluteString)
                Button("Disconnect", role: .destructive) { model.settings.mediaServers.seerr = nil }
            } else {
                Button { connecting = true } label: { Label("Connect Seerr", systemImage: "plus.circle.fill") }
            }
        } header: {
            Text("Requests")
        } footer: {
            Text("Connect a Seerr, Overseerr or Jellyseerr instance to request movies and shows that aren't in your library yet. A Request button appears on titles you don't already have on a media server.")
        }
        .sheet(isPresented: $connecting) { ConnectSeerrView().environment(model) }
    }
}

/// Server URL and API key for a Seerr instance, checked against its status endpoint before saving.
struct ConnectSeerrView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var apiKey = ""
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Server URL", text: $address, prompt: Text("https://seerr.example.com"))
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                    SecureField("API Key", text: $apiKey)
                } footer: {
                    Text("Find the API key in Seerr under Settings, General.")
                }
                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack { Text("Test & Save"); if working { Spacer(); ProgressView() } }
                    }
                    .disabled(address.isEmpty || apiKey.isEmpty || working)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Connect Seerr")
            .inlineNavigationTitle()
            .sheetDismissButton("Cancel") { dismiss() }
        }
    }

    private func normalizedURL() -> URL? {
        var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.lowercased().hasPrefix("http") { text = "http://" + text }
        while text.hasSuffix("/") { text.removeLast() }
        return URL(string: text)
    }

    private func save() async {
        guard let url = normalizedURL() else { error = "That address doesn't look right."; return }
        let config = SeerrConfig(baseURL: url, apiKey: apiKey.trimmingCharacters(in: .whitespacesAndNewlines))
        working = true
        error = nil
        defer { working = false }
        do {
            let client = SeerrClient(config: config, http: model.http)
            _ = try await client.status()
            try await client.verifyKey()
            model.settings.mediaServers.seerr = config
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
