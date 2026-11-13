import SwiftUI
import FlowKit

/// Hosts the built-in player's Metal layer in SwiftUI. The layer belongs to the player, which outlives
/// any one view (SwiftUI may rebuild this one), so the view only places it.
#if os(iOS) || os(tvOS)
final class UniversalSurfaceUIView: UIView {
    private var hosted: CALayer?

    func host(_ layer: CALayer) {
        guard hosted !== layer else { return }
        hosted?.removeFromSuperlayer()
        hosted = layer
        self.layer.addSublayer(layer)
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let hosted else { return }
        // Moving or resizing the layer would otherwise animate, and the picture would swim.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        hosted.frame = bounds
        let scale = window?.screen.nativeScale ?? UIScreen.main.nativeScale
        hosted.contentsScale = scale
        if let metal = hosted as? CAMetalLayer {
            metal.drawableSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        }
        CATransaction.commit()
    }
}

struct UniversalSurface: UIViewRepresentable {
    let player: UniversalPlayer
    var fill = false

    func makeUIView(context: Context) -> UniversalSurfaceUIView {
        let view = UniversalSurfaceUIView()
        view.backgroundColor = .black
        view.host(player.layer)
        player.setFill(fill)
        return view
    }

    func updateUIView(_ view: UniversalSurfaceUIView, context: Context) {
        view.host(player.layer)
        if context.coordinator.fill != fill {
            context.coordinator.fill = fill
            player.setFill(fill)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(fill: fill) }

    final class Coordinator {
        var fill: Bool
        init(fill: Bool) { self.fill = fill }
    }
}
#else
final class UniversalSurfaceNSView: NSView {
    private var hosted: CAMetalLayer?

    func host(_ layer: CAMetalLayer) {
        guard hosted !== layer else { return }
        hosted = layer
        // A layer-hosting view, in the order of MPVKit's Demo-macOS: backing layer first, then the Metal layer
        // takes its place.
        wantsLayer = true
        self.layer = layer
        wantsLayer = true
        needsLayout = true
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        needsLayout = true
    }

    override func layout() {
        super.layout()
        guard let hosted else { return }
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        hosted.frame = CGRect(origin: .zero, size: bounds.size)
        hosted.contentsScale = scale
        hosted.drawableSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        CATransaction.commit()
    }
}

struct UniversalSurface: NSViewRepresentable {
    let player: UniversalPlayer
    var fill = false

    func makeNSView(context: Context) -> UniversalSurfaceNSView {
        let view = UniversalSurfaceNSView()
        view.host(player.layer)
        player.setFill(fill)
        return view
    }

    func updateNSView(_ view: UniversalSurfaceNSView, context: Context) {
        view.host(player.layer)
        if context.coordinator.fill != fill {
            context.coordinator.fill = fill
            player.setFill(fill)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(fill: fill) }

    final class Coordinator {
        var fill: Bool
        init(fill: Bool) { self.fill = fill }
    }
}
#endif
