import SwiftUI
import FlowKit

/// The title's logo art when TMDb has one, otherwise the title in a bold display face.
struct LogoOrTitle: View {
    let logoPath: String?
    let title: String
    var maxHeight: CGFloat = 90
    var alignment: Alignment = .center

    @State private var loadedLogo: (url: URL, image: CGImage)?

    var body: some View {
        let url = TMDBImage.url(logoPath, size: .logo)
        Group {
            if let loadedLogo, loadedLogo.url == url {
                Image(decorative: loadedLogo.image, scale: 1)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxHeight: maxHeight, alignment: alignment)
                    .shadow(color: .black.opacity(0.5), radius: 8)
                    .accessibilityLabel(title)
            } else {
                titleText
            }
        }
        .task(id: url) {
            guard let url else { loadedLogo = nil; return }
            let image = await ImagePipeline.shared.image(url, maxPixel: Platform.isTV ? 1200 : 800)
            guard !Task.isCancelled else { return }
            loadedLogo = image.map { (url, $0) }
        }
    }

    private var titleText: some View {
        Text(title)
            .font(Theme.Typeface.artworkTitle(maxHeight * 0.46))
            .tracking(-0.5)
            .multilineTextAlignment(alignment == .leading ? .leading : .center)
            .lineLimit(3)
            .minimumScaleFactor(0.5)
            .shadow(color: .black.opacity(0.6), radius: 6)
            .frame(maxWidth: .infinity, alignment: alignment)
    }
}

/// Swaps TMDb posters for ratings-on-poster art. The model sets the key when Poster Enhancement or the RPDB key changes.
enum PosterEnhancer {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var key: String?

    static var rpdbKey: String? {
        get { lock.withLock { key } }
        set { lock.withLock { key = newValue } }
    }
}

extension MediaItem {
    /// RPDB's poster when Poster Enhancement is on, otherwise TMDb's.
    var posterURL: URL? { RatingPosterDB.posterURL(apiKey: PosterEnhancer.rpdbKey, item: self) ?? tmdbPosterURL }
    /// What `RemoteImage` falls back to when the enhanced poster won't load.
    var tmdbPosterURL: URL? { TMDBImage.url(posterPath, size: .poster) }
    var backdropURL: URL? { TMDBImage.url(backdropPath, size: .backdropLarge) }
    var smallBackdropURL: URL? { TMDBImage.url(backdropPath, size: .backdrop) }
}
