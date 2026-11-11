import SwiftUI
import FlowKit

/// First run. A slow-drifting wall of posters, and a single glass card that asks for one thing.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var key = ""
    @State private var checking = false
    @State private var error: String?
    @State private var importing = false
    @State private var joiningSync = false
    @State private var appeared = false

    private static var bandHeight: CGFloat { Platform.isTV ? 300 : Platform.isMac ? 96 : 130 }
    /// The Mac's window can be as short as 768 pt: tighter gaps keep the three ways in on screen without scrolling.
    private static var gap: CGFloat { Platform.isMac ? Theme.Space.l : Theme.Space.xl }

    var body: some View {
        NavigationStack {
            ZStack {
                // The collage sits in a band above the words, so nothing is set over artwork.
                PosterWall()
                    .frame(maxWidth: .infinity, maxHeight: Self.bandHeight, alignment: .top)
                    .clipped()
                    .opacity(appeared ? 0.5 : 0)
                    .mask(LinearGradient(stops: [.init(color: .black, location: 0.5), .init(color: .clear, location: 1)],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(maxHeight: .infinity, alignment: .top)
                ScrollView {
                    VStack(spacing: Self.gap) {
                        Spacer(minLength: Self.bandHeight)
                        VStack(spacing: Theme.Space.s) {
                            Wordmark(size: 56)
                                .padding(.horizontal, Theme.Space.xl)
                                .padding(.vertical, Theme.Space.l)
                                .background(Theme.Palette.blue)
                            Text("Everything you watch, beautifully in one place.")
                                .font(.system(size: 19 * Theme.scale, weight: .medium))
                                .foregroundStyle(Theme.Palette.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 12)

                        card
                            .opacity(appeared ? 1 : 0)
                            .offset(y: appeared ? 0 : 24)

                        VStack(spacing: Theme.Space.m) {
                            Button("Explore with Sample Data") { model.setDemoMode(true) }
                                .buttonStyle(GlassButtonStyle())
                            #if os(macOS)
                            // Side by side on the Mac, where the window has the width and not the height.
                            HStack(spacing: Theme.Space.l) { otherWays }
                            #else
                            otherWays
                            #endif
                        }
                        .opacity(appeared ? 1 : 0)
                    }
                    .padding(.horizontal, Theme.Space.l)
                    .frame(maxWidth: .infinity)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .background(Theme.Palette.canvas)
            .flowModal(isPresented: $importing) {
                NavigationStack { ImportSetupView() }.environment(model)
            }
            .flowModal(isPresented: $joiningSync) {
                NavigationStack { SyncJoinView(isSheet: true) }.environment(model)
            }
            .onAppear { withAnimation(.easeOut(duration: 1.1)) { appeared = true } }
        }
    }

    @ViewBuilder
    private var otherWays: some View {
        Button("I have a setup from another device") { importing = true }
            .font(Theme.Typeface.body)
            .foregroundStyle(Theme.Palette.textSecondary)
            .buttonStyle(.plain)
        Button("Join Marquee Sync") { joiningSync = true }
            .font(Theme.Typeface.body)
            .foregroundStyle(Theme.Palette.textSecondary)
            .buttonStyle(.plain)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            Label("Connect TMDB", systemImage: "film.stack")
                .font(Theme.Typeface.headline)
            Text("Marquee uses The Movie Database for posters, details and discovery. A free key takes a minute at themoviedb.org → Settings → API.")
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            SecureField("API key or read access token", text: $key)
                #if os(macOS)
                // The Mac's own bezel would draw a second box inside the card's field.
                .textFieldStyle(.plain)
                #endif
                .padding(.horizontal, Theme.Space.m)
                .frame(height: 48 * Theme.scale)
                .background(Theme.Palette.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).strokeBorder(Theme.Palette.hairline))
                .onSubmit { Task { await verify() } }
            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(Theme.Typeface.caption)
                    .foregroundStyle(.red)
            }
            Button {
                Task { await verify() }
            } label: {
                HStack {
                    Spacer()
                    if checking { ProgressView().tint(Theme.Palette.onStock) } else { Text("Continue") }
                    Spacer()
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty || checking)
        }
        .padding(Theme.Space.l)
        .frame(maxWidth: 460 * Theme.scale)
        .background(Theme.Palette.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
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

/// Three rows of posters drifting in alternating directions.
struct PosterWall: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let rows: [[String]] = {
        let posters = DemoCatalog.titles.map(\.poster)
        return (0..<3).map { r in Array(posters.dropFirst(r * 7) + posters.prefix(r * 7)) }
    }()

    var body: some View {
        GeometryReader { proxy in
            let width = Platform.isTV ? 220.0 : 120.0
            let spacing = Platform.isTV ? 24.0 : 12.0
            TimelineView(.animation(minimumInterval: nil, paused: reduceMotion)) { timeline in
                let t = timeline.date.timeIntervalSinceReferenceDate
                VStack(spacing: spacing) {
                    ForEach(rows.indices, id: \.self) { r in
                        PosterWallRow(posters: rows[r], width: width, spacing: spacing,
                                      offset: Self.offset(time: t, row: r, count: rows[r].count, width: width, spacing: spacing))
                    }
                }
                .rotationEffect(.degrees(-8))
                .scaleEffect(1.25)
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
                .offset(y: -30)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func offset(time: Double, row: Int, count: Int, width: Double, spacing: Double) -> Double {
        let rowWidth = Double(count) * (width + spacing)
        let raw = (time * (9.0 + Double(row) * 4)).truncatingRemainder(dividingBy: rowWidth)
        return row.isMultiple(of: 2) ? -raw : raw - rowWidth
    }
}

private struct PosterWallRow: View {
    let posters: [String]
    let width: Double
    let spacing: Double
    let offset: Double

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(0..<(posters.count * 2), id: \.self) { i in
                RemoteImage(url: TMDBImage.url(posters[i % posters.count], size: .posterSmall), maxPixel: 300)
                    .frame(width: width, height: width * 1.5)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .offset(x: offset)
    }
}
