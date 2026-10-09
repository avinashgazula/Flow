import SwiftUI

private struct ZoomNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    /// Shared by cards and detail pages in one navigation stack for the zoom transition.
    var zoomNamespace: Namespace.ID? {
        get { self[ZoomNamespaceKey.self] }
        set { self[ZoomNamespaceKey.self] = newValue }
    }
}

/// Owns a namespace for a NavigationStack and publishes it to cards inside it.
struct ZoomNamespaceProvider<Content: View>: View {
    @Namespace private var namespace
    @ViewBuilder var content: Content

    var body: some View {
        content.environment(\.zoomNamespace, namespace)
    }
}

private struct ZoomSourceModifier: ViewModifier {
    let id: String
    @Environment(\.zoomNamespace) private var namespace

    func body(content: Content) -> some View {
        #if os(iOS)
        if #available(iOS 18.0, *), let namespace {
            content.matchedTransitionSource(id: id, in: namespace) { source in
                source.clipShape(RoundedRectangle(cornerRadius: Theme.Radius.poster, style: .continuous))
            }
        } else {
            content
        }
        #else
        content
        #endif
    }
}

private struct ZoomDestinationModifier: ViewModifier {
    let id: String?
    @Environment(\.zoomNamespace) private var namespace

    func body(content: Content) -> some View {
        #if os(iOS)
        if #available(iOS 18.0, *), let namespace, let id {
            content.navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            content
        }
        #else
        content
        #endif
    }
}

extension View {
    func zoomSource(_ id: String) -> some View { modifier(ZoomSourceModifier(id: id)) }
    func zoomDestination(_ id: String?) -> some View { modifier(ZoomDestinationModifier(id: id)) }
}

/// Shimmering placeholder for loading content.
struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { proxy in
                    LinearGradient(colors: [.clear, .white.opacity(0.08), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: proxy.size.width * 0.6)
                        .offset(x: phase * proxy.size.width * 1.6)
                }
                .mask(content)
            }
            .onAppear {
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

extension View {
    func shimmering() -> some View { modifier(Shimmer()) }
}
