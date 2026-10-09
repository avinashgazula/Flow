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

// MARK: Widget

struct ContinueWatchingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.flow.continue", provider: ContinueProvider()) { entry in
            ContinueWatchingView(entry: entry)
                .containerBackground(for: .widget) { Color.black }
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
            LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 3) {
                if !compact {
                    Text("CONTINUE WATCHING")
                        .font(.system(size: 10, weight: .bold)).kerning(1)
                        .foregroundStyle(.white.opacity(0.6))
                }
                Text(card.item.title)
                    .font(.system(size: compact ? 14 : 17, weight: .bold))
                    .lineLimit(compact ? 2 : 1)
                if !card.item.subtitle.isEmpty {
                    Text(card.item.subtitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
                if let progress = card.item.progress { ProgressLine(value: progress).padding(.top, 4) }
            }
            .foregroundStyle(.white)
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
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(card.item.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                Text(card.item.subtitle).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                if let progress = card.item.progress { ProgressLine(value: progress).padding(.top, 3) }
            }
            Spacer(minLength: 0)
            Image(systemName: "play.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(.white.opacity(0.8))
        }
        .foregroundStyle(.white)
    }
}

private struct Artwork: View {
    let image: UIImage?

    var body: some View {
        Color.clear.overlay {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                LinearGradient(colors: [Color(white: 0.16), Color(white: 0.06)], startPoint: .topLeading, endPoint: .bottomTrailing)
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
                Capsule().fill(.white.opacity(0.28))
                Capsule().fill(.white).frame(width: max(3, proxy.size.width * min(1, max(0, value))))
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
                .font(.system(size: 13, weight: .semibold))
            Text("Start something in Flow and it will wait for you here.")
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(.white)
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(LinearGradient(colors: [Color(white: 0.12), .black], startPoint: .top, endPoint: .bottom))
    }
}
