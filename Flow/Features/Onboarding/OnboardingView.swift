import SwiftUI
import FlowKit

/// First run. A slow-drifting wall of posters, and a single glass card that asks for one thing.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var key = ""
    @State private var checking = false
    @State private var error: String?
    @State private var importing = false
    @State private var appeared = false

    var body: some View {
        NavigationStack {
            ZStack {
                PosterWall()
                    .opacity(appeared ? 1 : 0)
                LinearGradient(stops: [.init(color: .black.opacity(0.35), location: 0), .init(color: .black.opacity(0.7), location: 0.45), .init(color: .black, location: 0.8)],
                               startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                ScrollView {
                    VStack(spacing: Theme.Space.xl) {
                        Spacer(minLength: Platform.isTV ? 200 : 180)
                        VStack(spacing: Theme.Space.s) {
                            Text("Flow")
                                .font(.system(size: 64 * Theme.scale, weight: .heavy))
                                .tracking(-2)
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
                            Button("I have a setup from another device") { importing = true }
                                .font(Theme.Typeface.body)
                                .foregroundStyle(Theme.Palette.textSecondary)
                                .buttonStyle(.plain)
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
            .onAppear { withAnimation(.easeOut(duration: 1.1)) { appeared = true } }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            Label("Connect TMDb", systemImage: "film.stack")
                .font(Theme.Typeface.headline)
            Text("Flow uses The Movie Database for posters, details and discovery. A free key takes a minute at themoviedb.org → Settings → API.")
                .font(Theme.Typeface.caption)
                .foregroundStyle(Theme.Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            SecureField("API key or read access token", text: $key)
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
                    if checking { ProgressView().tint(.black) } else { Text("Continue") }
                    Spacer()
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty || checking)
            .opacity(key.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
        }
        .padding(Theme.Space.l)
        .frame(maxWidth: 460 * Theme.scale)
        .flowGlass(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
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
    private let rows: [[String]] = {
        let posters = DemoCatalog.titles.map(\.poster)
        return (0..<3).map { r in Array(posters.dropFirst(r * 7) + posters.prefix(r * 7)) }
    }()

    var body: some View {
        GeometryReader { proxy in
            let width = Platform.isTV ? 220.0 : 120.0
            let spacing = Platform.isTV ? 24.0 : 12.0
            TimelineView(.animation) { timeline in
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
