#if os(iOS)
import SwiftUI
import FlowKit

/// iPhone's tab bar: a small glass capsule of icons, the current tab grown into a white pill with
/// its name. It slides between tabs, and tapping the current one again goes back to its start.
struct FlowTabBar: View {
    @Environment(AppModel.self) private var model
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 2) {
            ForEach(model.settings.general.orderedTabs) { tab in
                item(tab)
            }
        }
        .padding(5)
        // Darker than clear glass, so the icons hold up over a bright poster scrolling beneath.
        .flowGlass(Capsule(), tint: Color.black.opacity(0.32))
        .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        // Stays put behind the keyboard rather than riding up on it.
        .ignoresSafeArea(.keyboard)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .sensoryFeedback(.selection, trigger: model.selectedTab)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isTabBar)
    }

    private func item(_ tab: AppTab) -> some View {
        let selected = model.selectedTab == tab
        return Button {
            if selected {
                // The system bar's habit: the current tab again means "take me back to the top of it".
                withAnimation(Theme.Motion.snappy) { model.paths[tab] = [] }
            } else {
                withAnimation(Theme.Motion.snappy) { model.selectedTab = tab }
            }
        } label: {
            HStack(spacing: 7) {
                Image(systemName: tab.systemImage)
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 24)
                if selected {
                    Text(tab.title)
                        .font(.system(.subheadline, weight: .semibold))
                        .lineLimit(1)
                        .fixedSize()
                        .transition(.opacity.combined(with: .scale(scale: 0.8, anchor: .leading)))
                }
            }
            .foregroundStyle(selected ? Color.black : Color.white.opacity(0.78))
            .padding(.horizontal, selected ? 16 : 13)
            .frame(height: 46)
            .background {
                if selected {
                    Capsule().fill(.white).matchedGeometryEffect(id: "pill", in: pill)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(TabItemButtonStyle())
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityShowsLargeContentViewer {
            Label(tab.title, systemImage: tab.systemImage)
        }
    }
}

/// A press dims and shrinks the item a touch, as the system bar's items do.
private struct TabItemButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
    }
}
#endif
