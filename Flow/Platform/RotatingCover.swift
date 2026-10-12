#if os(iOS)
import SwiftUI

extension View {
    /// A full-screen cover that may turn to landscape. SwiftUI's own `fullScreenCover` only allows
    /// portrait on iPhone, so a player inside it can't rotate (iOS refuses the request); this one is
    /// presented by UIKit with a controller that allows every orientation but upside down.
    /// The content closes it with the `close` it's handed.
    /// `startsInLandscape` turns an iPhone to landscape as the cover appears (Settings → Playback → Auto Rotate).
    func rotatingCover<Item: Identifiable, Cover: View>(item: Binding<Item?>, startsInLandscape: Bool = false,
                                                        @ViewBuilder content: @escaping (Item, _ close: @escaping () -> Void) -> Cover) -> some View {
        background(RotatingCoverPresenter(item: item, startsInLandscape: startsInLandscape, content: content))
    }
}

private final class RotatingHostingController: UIHostingController<AnyView> {
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
}

private struct RotatingCoverPresenter<Item: Identifiable, Cover: View>: UIViewControllerRepresentable {
    @Binding var item: Item?
    let startsInLandscape: Bool
    let content: (Item, @escaping () -> Void) -> Cover
    @Environment(AppModel.self) private var model

    final class Coordinator {
        var presented: UIViewController?
        var presentedID: AnyHashable?
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIViewController(context: Context) -> UIViewController { UIViewController() }

    func updateUIViewController(_ host: UIViewController, context: Context) {
        let coordinator = context.coordinator
        if let item {
            guard coordinator.presentedID != AnyHashable(item.id) else { return }
            coordinator.presented?.dismiss(animated: false)
            let binding = $item
            let close = { binding.wrappedValue = nil }
            let cover = RotatingHostingController(rootView: AnyView(content(item, close).environment(model)))
            cover.modalPresentationStyle = .fullScreen
            cover.view.backgroundColor = .black
            coordinator.presented = cover
            coordinator.presentedID = AnyHashable(item.id)
            let landscape = startsInLandscape
            // The representable's own controller may not be in a window yet on the first pass.
            DispatchQueue.main.async {
                guard coordinator.presented === cover else { return }
                (host.view.window?.rootViewController?.topmostPresented ?? host).present(cover, animated: true) {
                    // Asked once the cover is on screen and deciding orientations; asked any earlier, iOS keeps portrait.
                    guard landscape, Platform.isPhone, let scene = cover.view.window?.windowScene else { return }
                    cover.setNeedsUpdateOfSupportedInterfaceOrientations()
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape)) { _ in }
                }
            }
        } else if let presented = coordinator.presented {
            coordinator.presented = nil
            coordinator.presentedID = nil
            presented.dismiss(animated: true) { OrientationLock.restore() }
        }
    }
}

private extension UIViewController {
    var topmostPresented: UIViewController {
        presentedViewController?.topmostPresented ?? self
    }
}
#endif
