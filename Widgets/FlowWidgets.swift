import WidgetKit
import SwiftUI
import UIKit

@main
struct FlowWidgets: WidgetBundle {
    var body: some Widget {
        ContinueWatchingWidget()
    }
}

// MARK: Timeline

struct ContinueEntry: TimelineEntry {
    struct Card {
        let item: FlowSnapshot.Item
        let image: UIImage?
    }

    let date: Date
    let cards: [Card]

    static let placeholder = ContinueEntry(date: .now, cards: [])
}

struct ContinueProvider: TimelineProvider {
    func placeholder(in context: Context) -> ContinueEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (ContinueEntry) -> Void) {
        Task { completion(await entry(for: context.family)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ContinueEntry>) -> Void) {
        Task {
            let entry = await entry(for: context.family)
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
        }
    }

    private func entry(for family: WidgetFamily) async -> ContinueEntry {
        guard let snapshot = FlowSnapshot.load() else { return .placeholder }
        let items = snapshot.continueWatching.isEmpty ? snapshot.watchlist : snapshot.continueWatching
        let count = family == .systemLarge ? 3 : 1
        var cards: [ContinueEntry.Card] = []
        for item in items.prefix(count) {
            cards.append(.init(item: item, image: await Self.image(item.imageURL ?? item.posterURL)))
        }
        return ContinueEntry(date: .now, cards: cards)
    }

    /// Widgets render synchronously, so artwork is fetched and shrunk here, ahead of time.
    private static func image(_ url: URL?) async -> UIImage? {
        guard let url, let (data, _) = try? await URLSession.shared.data(from: url),
              let image = UIImage(data: data) else { return nil }
        let width: CGFloat = 800
        guard image.size.width > width else { return image }
        let size = CGSize(width: width, height: image.size.height * width / image.size.width)
        return UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }
}

// MARK: Palette

/// Marquee's dark tokens (web/DESIGN.md): ink ground, paper text, one red for progress and labels. A widget is
/// always dark, over artwork. It uses the system's monospaced face rather than bundling Plex Mono into the
/// extension: a few small labels don't justify duplicating the font files, and the system's is close.
private enum Ink {
    static let ground = Color(red: 0x0A / 255, green: 0x0A / 255, blue: 0x0A / 255)
    static let paper = Color(red: 0xF2 / 255, green: 0xF2 / 255, blue: 0xEE / 255)
    static let muted = Color(red: 0xB0 / 255, green: 0xB0 / 255, blue: 0xAC / 255)
    static let red = Color(red: 0xFF / 255, green: 0x5A / 255, blue: 0x4E / 255)
    static let track = Color(red: 0x33 / 255, green: 0x33 / 255, blue: 0x33 / 255)

    static func mono(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

// MARK: Widget

struct ContinueWatchingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.flow.continue", provider: ContinueProvider()) { entry in
            ContinueWatchingView(entry: entry)
                .containerBackground(for: .widget) { Ink.ground }
        }
        .configurationDisplayName("Continue Watching")
        .description("Pick up where you left off.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

struct ContinueWatchingView: View {
    let entry: ContinueEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let first = entry.cards.first {
            if family == .systemLarge {
                VStack(spacing: 0) {
                    Hero(card: first, compact: false)
                    VStack(spacing: 10) {
                        ForEach(Array(entry.cards.dropFirst().enumerated()), id: \.offset) { _, card in
                            Link(destination: card.item.link) { Row(card: card) }
                        }
                    }
                    .padding(14)
                    .frame(maxHeight: .infinity, alignment: .top)
                }
                .widgetURL(first.item.playLink ?? first.item.link)
            } else {
                Hero(card: first, compact: family == .systemSmall)
                    .widgetURL(first.item.playLink ?? first.item.link)
            }
        } else {
            Empty()
        }
    }
}

private struct Hero: View {
    let card: ContinueEntry.Card
    let compact: Bool

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Artwork(image: card.image)
            // Ink over the picture's foot, so paper text reads on bright artwork.
            LinearGradient(colors: [.clear, Ink.ground.opacity(0.92)], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 3) {
                if !compact {
                    Text("Continue Watching")
                        .font(Ink.mono(10)).textCase(.uppercase).kerning(1.2)
                        .foregroundStyle(Ink.red)
                }
                Text(card.item.title)
                    .font(.system(size: compact ? 16 : 20, weight: .bold).width(.condensed))
                    .lineLimit(compact ? 2 : 1)
                if !card.item.subtitle.isEmpty {
                    Text(card.item.subtitle)
                        .font(Ink.mono(10, .regular))
                        .foregroundStyle(Ink.muted)
                        .lineLimit(1)
                }
                if let progress = card.item.progress { ProgressLine(value: progress).padding(.top, 4) }
            }
            .foregroundStyle(Ink.paper)
            .padding(compact ? 12 : 14)
        }
    }
}

private struct Row: View {
    let card: ContinueEntry.Card

    var body: some View {
        HStack(spacing: 12) {
            Artwork(image: card.image)
                .frame(width: 96, height: 54)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.item.title).font(.system(size: 16, weight: .bold).width(.condensed)).lineLimit(1)
                Text(card.item.subtitle).font(Ink.mono(10, .regular)).foregroundStyle(Ink.muted).lineLimit(1)
                if let progress = card.item.progress { ProgressLine(value: progress).padding(.top, 3) }
            }
            Spacer(minLength: 0)
            Image(systemName: "play.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(Ink.paper)
        }
        .foregroundStyle(Ink.paper)
    }
}

private struct Artwork: View {
    let image: UIImage?

    var body: some View {
        Color.clear.overlay {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Ink.track
            }
        }
        .clipped()
    }
}

private struct ProgressLine: View {
    let value: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle().fill(Ink.track)
                Rectangle().fill(Ink.red).frame(width: max(3, proxy.size.width * min(1, max(0, value))))
            }
        }
        .frame(height: 3)
    }
}

private struct Empty: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "play.rectangle.on.rectangle.fill")
                .font(.system(size: 22, weight: .semibold))
            Text("Nothing in progress")
                .font(.system(size: 16, weight: .bold).width(.condensed))
            Text("Start something in Marquee and it will wait for you here.")
                .font(Ink.mono(10, .regular))
                .foregroundStyle(Ink.muted)
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(Ink.paper)
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Ink.ground)
    }
}
