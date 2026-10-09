import SwiftUI
import FlowKit

/// The title's logo art when TMDb has one, otherwise the title in a bold display face.
struct LogoOrTitle: View {
    let logoPath: String?
    let title: String
    var maxHeight: CGFloat = 90
    var alignment: Alignment = .center

    var body: some View {
        if let url = TMDBImage.url(logoPath, size: .logo) {
            AsyncImage(url: url) { phase in
                if case .success(let image) = phase {
                    image.resizable().aspectRatio(contentMode: .fit)
                        .frame(maxHeight: maxHeight, alignment: alignment)
                        .shadow(color: .black.opacity(0.5), radius: 8)
                } else {
                    titleText
                }
            }
        } else {
            titleText
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

extension MediaItem {
    var posterURL: URL? { TMDBImage.url(posterPath, size: .poster) }
    var backdropURL: URL? { TMDBImage.url(backdropPath, size: .backdropLarge) }
    var smallBackdropURL: URL? { TMDBImage.url(backdropPath, size: .backdrop) }
}
