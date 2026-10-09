import SwiftUI
import FlowKit

/// Poster with watched check and media-server badge; navigates to the detail page.
struct PosterCard: View {
    let item: MediaItem
    var width: CGFloat = Platform.posterWidth
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationLink(value: Route.detail(item)) {
            PosterCardContent(item: item, width: width)
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu { MediaContextMenu(item: item) }
    }
}

struct PosterCardContent: View {
    let item: MediaItem
    var width: CGFloat
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RemoteImage(url: item.posterURL)
                .frame(width: width, height: width * 1.5)
                .overlay {
                    if item.posterPath == nil {
                        Text(item.title).font(.caption.weight(.semibold)).multilineTextAlignment(.center).padding(8)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Platform.isTV ? 14 : 10, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if model.settings.mediaServers.showBadgeOnPosters && model.isOnServer(item) {
                        Image(systemName: "server.rack")
                            .font(.system(size: 10, weight: .bold))
                            .padding(5)
                            .background(.black.opacity(0.65), in: Circle())
                            .padding(6)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if model.settings.general.showWatchedBadges && model.isWatched(item) {
                        WatchedCheck().padding(8)
                    }
                }
            if model.settings.general.showPosterTitles {
                Text(item.title)
                    .font(Platform.isTV ? .callout : .subheadline)
                    .lineLimit(1)
                    .frame(width: width, alignment: .leading)
                    .foregroundStyle(.primary)
            }
        }
    }
}

struct WatchedCheck: View {
    var body: some View {
        Image(systemName: "checkmark")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(.black)
            .frame(width: 26, height: 26)
            .background(.white, in: Circle())
            .shadow(radius: 3)
    }
}

/// Wide card for Continue Watching: still/backdrop, SxxEyy, time left and progress bar.
struct ContinueWatchingCard: View {
    let entry: ContinueWatchingBuilder.Entry
    let item: MediaItem
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            Task { await model.play(item, episode: nil) }
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                ZStack(alignment: .bottom) {
                    RemoteImage(url: item.smallBackdropURL ?? item.posterURL)
                        .frame(width: Platform.landscapeWidth, height: Platform.landscapeWidth * 9 / 16)
                    LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom)
                    VStack(spacing: 8) {
                        HStack {
                            if let ep = entry.episode {
                                Text(ep.code).font(.caption.weight(.bold))
                            }
                            Spacer()
                            if let remaining = remainingText {
                                Text(remaining).font(.caption.weight(.semibold))
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(.black.opacity(0.55), in: Capsule())
                            } else if entry.isNextUp {
                                Text("Up Next").font(.caption.weight(.semibold))
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(.black.opacity(0.55), in: Capsule())
                            }
                        }
                        if let p = entry.progress {
                            ProgressView(value: min(1, p.percent / 100)).tint(.white).scaleEffect(x: 1, y: 0.7)
                        }
                    }
                    .padding(10)
                }
                .frame(width: Platform.landscapeWidth, height: Platform.landscapeWidth * 9 / 16)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.subheadline.weight(.medium)).lineLimit(1)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(width: Platform.landscapeWidth, alignment: .leading)
            }
        }
        .buttonStyle(CardButtonStyle())
        .contextMenu {
            NavigationLink(value: Route.detail(item)) { Label("Go to Details", systemImage: "info.circle") }
            Button(role: .destructive) {
                Task { await model.removeFromContinueWatching(entry) }
            } label: { Label("Remove from Continue Watching", systemImage: "xmark.circle") }
        }
    }

    private var remainingText: String? {
        guard let p = entry.progress else { return nil }
        if let r = p.remainingSeconds { return TimeFormat.remaining(r) }
        if let runtime = item.runtimeMinutes { return TimeFormat.remaining(Double(runtime) * 60 * (1 - p.percent / 100)) }
        return "\(Int(p.percent))%"
    }

    private var subtitle: String {
        if entry.episode != nil, let year = item.year { return entry.isNextUp ? "Next episode" : "\(year)" }
        return item.year.map(String.init) ?? ""
    }
}

/// Lifts cards on focus (tvOS) and dims on press elsewhere.
struct CardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(FocusLift())
            .opacity(configuration.isPressed ? 0.75 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// tvOS focus effect for custom button styles: scale up and cast a shadow. No-op elsewhere.
struct FocusLift: ViewModifier {
    @Environment(\.isFocused) private var focused

    func body(content: Content) -> some View {
        #if os(tvOS)
        content
            .scaleEffect(focused ? 1.08 : 1)
            .shadow(color: .black.opacity(focused ? 0.5 : 0), radius: 18, y: 10)
            .brightness(focused ? 0.06 : 0)
            .animation(.easeOut(duration: 0.18), value: focused)
        #else
        content
        #endif
    }
}

struct MediaContextMenu: View {
    let item: MediaItem
    @Environment(AppModel.self) private var model

    var body: some View {
        Button { Task { await model.play(item) } } label: { Label("Play", systemImage: "play.fill") }
        Button { Task { await model.toggleWatchlist(item) } } label: {
            Label(model.isWatchlisted(item) ? "Remove from Watchlist" : "Add to Watchlist", systemImage: model.isWatchlisted(item) ? "bookmark.slash" : "bookmark")
        }
        Button { Task { await model.setWatched(item, episodes: nil, watched: !model.isWatched(item)) } } label: {
            Label(model.isWatched(item) ? "Mark Unwatched" : "Mark Watched", systemImage: model.isWatched(item) ? "eye.slash" : "eye")
        }
        Button { Task { await model.toggleFavourite(item) } } label: {
            Label(model.isFavourite(item) ? "Remove Favourite" : "Favourite", systemImage: model.isFavourite(item) ? "heart.slash" : "heart")
        }
    }
}

struct PersonCard: View {
    let id: Int
    let name: String
    let role: String
    let profilePath: String?

    var body: some View {
        NavigationLink(value: Route.person(id: id, name: name)) {
            VStack(spacing: 6) {
                RemoteImage(url: TMDBImage.url(profilePath, size: .profile))
                    .overlay { if profilePath == nil { Image(systemName: "person.fill").font(.title).foregroundStyle(.secondary) } }
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                Text(name).font(.caption.weight(.medium)).lineLimit(1)
                Text(role).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(width: size + 16)
        }
        .buttonStyle(CardButtonStyle())
    }

    private var size: CGFloat { Platform.isTV ? 150 : 84 }
}
