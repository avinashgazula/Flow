import SwiftUI
import FlowKit

/// First run, as the website's Welcome: the wordmark cell, a giant MARQUEE, an italic serif line with its key phrase
/// underlined in red dots, a 2px rule, then the TMDB key field and the other ways in as ruled rows.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var key = ""
    @State private var checking = false
    @State private var error: String?
    @State private var importing = false
    @State private var joiningSync = false

    /// The giant word's ceiling; it shrinks to fit a phone's width.
    private static let wordSize: CGFloat = 190

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    bar
                    hero
                    RuleLine().padding(.horizontal, Theme.Space.gutter)
                    // Side by side where the window is wide enough (Mac, iPad, Apple TV); stacked on a phone.
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: Theme.Space.xl) {
                            form.frame(minWidth: 340 * Theme.scale, maxWidth: 640 * Theme.scale)
                            alternatives.frame(minWidth: 300 * Theme.scale, maxWidth: 460 * Theme.scale)
                        }
                        VStack(alignment: .leading, spacing: Theme.Space.xl) {
                            form
                            alternatives
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.top, Theme.Space.l)
                    .padding(.bottom, Theme.Space.xl)
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(Theme.Palette.bg.ignoresSafeArea())
            #if !os(macOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
            .flowModal(isPresented: $importing) {
                NavigationStack { ImportSetupView() }.environment(model)
            }
            .flowModal(isPresented: $joiningSync) {
                NavigationStack { SyncJoinView(isSheet: true) }.environment(model)
            }
        }
    }

    /// The top bar: the wordmark on its blue cell, ruled off from the page.
    private var bar: some View {
        HStack(spacing: 0) {
            Wordmark(size: 22)
                .padding(.horizontal, Theme.Space.l)
                .frame(minHeight: 56 * Theme.scale)
                .background(Theme.Palette.blue)
            Spacer(minLength: 0)
        }
        .overlay(alignment: .bottom) { RuleLine() }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            Text("Marquee")
                .font(.custom(Theme.Face.archivo, size: Self.wordSize))
                .textCase(.uppercase)
                .tracking(-0.03 * Self.wordSize)
                .lineLimit(1)
                .minimumScaleFactor(0.1)
                .foregroundStyle(Theme.Palette.fg)
                .accessibilityAddTraits(.isHeader)
            Text("Your Jellyfin, Emby and Plex servers, stream add-ons and live TV, in one place. Marquee hosts no content: it \(Text("plays what you already have.").underline(pattern: .dot, color: Theme.Palette.red))")
                .font(Theme.Typeface.readingItalic)
                .lineSpacing(5)
                .foregroundStyle(Theme.Palette.fg)
                .frame(maxWidth: 560 * Theme.scale, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.top, Theme.Space.xl)
        .padding(.bottom, Theme.Space.l)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionLabel("TMDB API Key")
            SecureField("API key or read-access token", text: $key)
                #if os(macOS)
                // The Mac's own bezel would draw a second box inside the ruled one.
                .textFieldStyle(.plain)
                #endif
                .font(Theme.Typeface.body)
                .foregroundStyle(Theme.Palette.fg)
                .padding(.horizontal, Theme.Space.m)
                .frame(height: 48 * Theme.scale)
                .background(Theme.Palette.bg)
                .ruleFrame()
                .onSubmit { Task { await verify() } }
            if let error {
                Text(error)
                    .font(Theme.Typeface.control)
                    .foregroundStyle(Theme.Palette.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("Marquee uses TMDB for posters, cast and details. A free key takes a minute at themoviedb.org → Settings → API. It stays on this device.")
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.Space.s) { actions }
                VStack(alignment: .leading, spacing: Theme.Space.s) { actions }
            }
            .padding(.top, Theme.Space.xs)
        }
    }

    @ViewBuilder
    private var actions: some View {
        Button {
            Task { await verify() }
        } label: {
            if checking { ProgressView().tint(Theme.Palette.bg) } else { Text("Continue") }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty || checking)
        Button("Explore with Sample Data") { model.setDemoMode(true) }
            .buttonStyle(GlassButtonStyle())
    }

    /// The other ways in, as the website's ruled rows.
    private var alternatives: some View {
        VStack(spacing: 0) {
            RuleLine(thin: true)
            Button { importing = true } label: { alternative("I Have a Setup From Another Device") }
                .buttonStyle(RowButtonStyle())
            Button { joiningSync = true } label: { alternative("Join Marquee Sync") }
                .buttonStyle(RowButtonStyle())
        }
    }

    private func alternative(_ title: String) -> some View {
        HStack(spacing: Theme.Space.s) {
            Text(title)
                .font(Theme.Typeface.control)
                .controlText()
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            Text("→").font(Theme.Typeface.control)
        }
        .frame(minHeight: 32 * Theme.scale)
    }

    private func verify() async {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        checking = true
        defer { checking = false }
        do {
            _ = try await TMDBClient(credential: trimmed, http: model.http).genres(.movie)
            model.credentials.tmdbAPIKey = trimmed
            await model.start()
        } catch {
            withAnimation { self.error = "That key didn't work. Check it and try again." }
        }
    }
}
