import SwiftUI
import FlowKit

/// First run: Flow needs a TMDb key for metadata. Offers importing a setup instead.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var key = ""
    @State private var checking = false
    @State private var error: String?
    @State private var importing = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    Image(systemName: "play.rectangle.on.rectangle.fill")
                        .font(.system(size: 72))
                        .foregroundStyle(.tint)
                        .padding(.top, 60)
                    VStack(spacing: 10) {
                        Text("Welcome to Flow").font(.largeTitle.weight(.bold))
                        Text("Your movies, shows and live TV — from your own servers, shares and providers — in one place.")
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text("TMDb API Key").font(.headline)
                        SecureField("v3 API key or v4 read access token", text: $key)
                            #if !os(tvOS)
                            .textFieldStyle(.roundedBorder)
                            #endif
                        Text("Flow uses The Movie Database for posters, details and discovery. Create a free account and copy your key from Settings → API on themoviedb.org.")
                            .font(.footnote).foregroundStyle(.secondary)
                        if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                        Button {
                            Task { await verify() }
                        } label: {
                            HStack { Spacer(); if checking { ProgressView() } else { Text("Continue").font(.headline) }; Spacer() }
                                .padding(.vertical, 12)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty || checking)
                    }
                    .frame(maxWidth: 520)
                    Button("I have a setup from another device") { importing = true }
                }
                .padding(.horizontal, 28)
                .frame(maxWidth: .infinity)
            }
            .sheet(isPresented: $importing) {
                NavigationStack { ImportSetupView() }.environment(model)
            }
        }
    }

    private func verify() async {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        checking = true
        defer { checking = false }
        do {
            _ = try await TMDBClient(credential: trimmed, http: model.http).genres(.movie)
            model.credentials.tmdbAPIKey = trimmed
            await model.start()
        } catch {
            self.error = "That key didn't work: \(error.localizedDescription)"
        }
    }
}
