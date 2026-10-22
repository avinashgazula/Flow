import SwiftUI
import ImageIO
import CoreGraphics

/// Decodes, downsamples and caches artwork, and extracts each image's ambient colour.
/// Downsampling to display size keeps memory flat while scrolling long shelves.
actor ImagePipeline {
    static let shared = ImagePipeline()

    private final class Box: @unchecked Sendable {
        let image: CGImage
        init(_ image: CGImage) { self.image = image }
    }

    nonisolated(unsafe) private let cache: NSCache<NSString, Box> = {
        let c = NSCache<NSString, Box>()
        c.totalCostLimit = 160 * 1024 * 1024
        return c
    }()
    private var inflight: [String: Task<CGImage?, Never>] = [:]
    /// The largest size each image has been decoded at, so a smaller request (a poster after the
    /// detail page showed it bigger) is answered from memory instead of decoding again.
    nonisolated(unsafe) private var largest: [String: Int] = [:]
    private let largestLock = NSLock()
    private var colors: [URL: ArtworkColor] = [:]
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache.shared
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.httpMaximumConnectionsPerHost = 8
        return URLSession(configuration: config)
    }()

    /// Memory-cached, synchronous lookup so cells can render instantly when scrolled back into view.
    nonisolated func cached(_ url: URL, maxPixel: Int) -> CGImage? {
        if let exact = cache.object(forKey: Self.key(url, maxPixel))?.image { return exact }
        let size = largestLock.withLock { largest[url.absoluteString] }
        guard let size, size > maxPixel else { return nil }
        return cache.object(forKey: Self.key(url, size))?.image
    }

    func image(_ url: URL, maxPixel: Int) async -> CGImage? {
        let key = Self.key(url, maxPixel)
        if let hit = cached(url, maxPixel: maxPixel) { return hit }
        if let running = inflight[key as String] { return await running.value }
        let session = self.session
        // Detached: decoding is the expensive part, and inheriting the actor would run every
        // image's decode one after another.
        let task = Task.detached(priority: .userInitiated) { () -> CGImage? in
            guard let (data, response) = try? await session.data(from: url),
                  (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { return nil }
            return Self.downsample(data, maxPixel: maxPixel)
        }
        inflight[key as String] = task
        let image = await task.value
        inflight[key as String] = nil
        if let image {
            cache.setObject(Box(image), forKey: key, cost: image.bytesPerRow * image.height)
            largestLock.withLock {
                if (largest[url.absoluteString] ?? 0) < maxPixel { largest[url.absoluteString] = maxPixel }
            }
        }
        return image
    }

    func color(_ url: URL) async -> ArtworkColor? {
        if let known = colors[url] { return known }
        guard let image = await image(url, maxPixel: 64) else { return nil }
        let color = ArtworkColor(image: image)
        colors[url] = color
        return color
    }

    nonisolated static func key(_ url: URL, _ maxPixel: Int) -> NSString {
        "\(maxPixel)|\(url.absoluteString)" as NSString
    }

    nonisolated static func downsample(_ data: Data, maxPixel: Int) -> CGImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ] as CFDictionary
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options)
    }
}

/// The dominant, saturation-weighted colour of an image, tuned for use as a background glow.
struct ArtworkColor: Hashable, Sendable {
    let red: Double
    let green: Double
    let blue: Double

    init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    init(image: CGImage) {
        let size = 24
        var pixels = [UInt8](repeating: 0, count: size * size * 4)
        let space = CGColorSpaceCreateDeviceRGB()
        pixels.withUnsafeMutableBytes { buffer in
            if let ctx = CGContext(data: buffer.baseAddress, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
                                   space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
                ctx.interpolationQuality = .medium
                ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
            }
        }
        var r = 0.0, g = 0.0, b = 0.0, total = 0.0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let pr = Double(pixels[i]) / 255, pg = Double(pixels[i + 1]) / 255, pb = Double(pixels[i + 2]) / 255
            let maxC = max(pr, pg, pb), minC = min(pr, pg, pb)
            let saturation = maxC == 0 ? 0 : (maxC - minC) / maxC
            // Favour vivid, mid-bright pixels; ignore near-black letterboxing and blown highlights.
            let weight = 0.04 + saturation * saturation * (maxC > 0.12 && maxC < 0.97 ? 1 : 0.15)
            r += pr * weight; g += pg * weight; b += pb * weight; total += weight
        }
        guard total > 0 else { self.init(red: 0.2, green: 0.2, blue: 0.25); return }
        self.init(red: r / total, green: g / total, blue: b / total)
    }

    /// Normalised to a rich but dark tone that white text always reads on.
    var glow: Color {
        let maxC = max(red, green, blue, 0.001)
        let target = 0.62
        let k = target / maxC
        return Color(red: min(1, red * k), green: min(1, green * k), blue: min(1, blue * k))
    }

    var base: Color { Color(red: red, green: green, blue: blue) }
}

/// Artwork view: downsampled, cached, cross-fades in, and falls back to generated art.
struct RemoteImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    /// Longest edge to decode, in pixels. Keep close to the on-screen size.
    var maxPixel: Int = 720
    /// When set, a typographic poster is drawn if the image is missing or fails.
    var fallbackTitle: String?
    /// Tried when `url` fails, e.g. the plain poster behind an enhanced one.
    var fallbackURL: URL?

    @State private var image: CGImage?
    @State private var failed = false

    var body: some View {
        // Always take exactly the offered size: a `.fill` image's natural size must never
        // leak into layout (it would widen whole columns).
        Color.clear
            .overlay {
                if let image {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .transition(.opacity)
                } else if failed || url == nil, let fallbackTitle {
                    GeneratedArtwork(title: fallbackTitle)
                } else {
                    Rectangle().fill(Theme.Palette.surface)
                        .overlay {
                            if failed && fallbackTitle == nil {
                                Image(systemName: "photo").foregroundStyle(Theme.Palette.textTertiary)
                            }
                        }
                }
            }
            .clipped(antialiased: true)
            .task(id: url) { await load() }
    }

    private func load() async {
        guard let url else { image = nil; return }
        if let hit = ImagePipeline.shared.cached(url, maxPixel: maxPixel) {
            image = hit
            return
        }
        image = nil
        failed = false
        var loaded = await ImagePipeline.shared.image(url, maxPixel: maxPixel)
        if loaded == nil, !Task.isCancelled, let fallbackURL, fallbackURL != url {
            loaded = await ImagePipeline.shared.image(fallbackURL, maxPixel: maxPixel)
        }
        guard !Task.isCancelled else { return }
        withAnimation(Theme.Motion.fade) {
            image = loaded
            failed = loaded == nil
        }
    }
}

/// A plain panel carrying the title, for titles without artwork: flat ink, set in system type.
struct GeneratedArtwork: View {
    let title: String

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottomLeading) {
                Theme.Palette.control
                Text(title)
                    .font(Theme.Typeface.artworkTitle(max(11, proxy.size.width * 0.13)))
                    .foregroundStyle(Theme.Palette.textSecondary)
                    .lineLimit(4)
                    .minimumScaleFactor(0.5)
                    .padding(proxy.size.width * 0.09)
            }
        }
    }
}

/// The page ground. It once took a wash of colour from the artwork; the programme is two flat inks,
/// so the artwork arguments stay (every screen still passes them) and nothing is drawn from them.
struct AmbientBackground: View {
    let url: URL?
    var intensity: Double = 1

    var body: some View {
        Theme.Palette.ground
            .ignoresSafeArea()
            .allowsHitTesting(false)
    }
}
