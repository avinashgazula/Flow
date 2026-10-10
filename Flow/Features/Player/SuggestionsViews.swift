import SwiftUI
import FlowKit

/// "Because You Watched", offered beside a film's credits: a few films like it, and a way to stay.
struct SuggestionsCard: View {
    let session: PlaybackSession

    private var width: CGFloat { Platform.isPhone ? 132 : 164 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("BECAUSE YOU WATCHED")
                        .font(Theme.Typeface.micro).kerning(1)
                        .foregroundStyle(Theme.Palette.textTertiary)
                    Text(session.request.item.title)
                        .font(.system(.subheadline, weight: .semibold))
                        .lineLimit(1)
                }
                Spacer(minLength: 12)
                Button { session.dismissSuggestions() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .frame(width: 28, height: 28)
                        .background(.white.opacity(0.14), in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Keep watching the credits")
            }
            HStack(spacing: 10) {
                ForEach(session.suggestions.prefix(Platform.isPhone ? 2 : 3)) { item in
                    SuggestionTile(item: item, width: width) { session.openSuggestion(item) }
                }
            }
        }
        .padding(14)
        .flowGlass(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

/// Where a film ends when there's something like it to watch: its backdrop, softly blurred,
/// behind a row of suggestions. Closing returns to wherever the film was started.
struct SuggestionsEndScreen: View {
    let session: PlaybackSession
    @FocusState private var focused: String?

    private var width: CGFloat { Platform.isTV ? 420 : Platform.isPhone ? 200 : 260 }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            RemoteImage(url: session.request.item.backdropURL, maxPixel: 1200)
                .blur(radius: 48)
                .opacity(0.55)
                .ignoresSafeArea()
                .accessibilityHidden(true)
            LinearGradient(colors: [.black.opacity(0.2), .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack(alignment: .leading, spacing: Platform.isTV ? 28 : 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("BECAUSE YOU WATCHED")
                        .font(Theme.Typeface.micro).kerning(1.2)
                        .foregroundStyle(Theme.Palette.textSecondary)
                    Text(session.request.item.title)
                        .font(Theme.Typeface.display)
                        .displayTracking()
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Platform.isTV ? 40 : 14) {
                        ForEach(session.suggestions) { item in
                            SuggestionTile(item: item, width: width) { session.openSuggestion(item) }
                                .focused($focused, equals: item.id)
                        }
                    }
                    // Room for the focus lift on tvOS.
                    .padding(.vertical, Platform.isTV ? 30 : 6)
                }
                .scrollClipDisabled()
                Button { session.dismissSuggestions() } label: {
                    Label("Done", systemImage: "checkmark")
                        .font(.system(.subheadline, weight: .semibold))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 11)
                        .flowGlass(Capsule(), interactive: true)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .focused($focused, equals: "done")
            }
            .padding(.horizontal, Platform.isTV ? 90 : Platform.isPhone ? 64 : 48)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .onAppear { focused = session.suggestions.first?.id }
        #if os(tvOS)
        .onExitCommand { session.dismissSuggestions() }
        #endif
    }
}

/// One suggested film: its backdrop and title.
private struct SuggestionTile: View {
    let item: MediaItem
    let width: CGFloat
    let action: () -> Void

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Platform.isTV ? 16 : 12, style: .continuous) }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                RemoteImage(url: item.smallBackdropURL ?? item.posterURL, maxPixel: Platform.isTV ? 900 : 560, fallbackTitle: item.title)
                    .frame(width: width, height: width * 9 / 16)
                    .clipShape(shape)
                    .hairline(shape)
                Text(item.title)
                    .font(.system(.caption, weight: .semibold))
                    .lineLimit(1)
                    .frame(width: width, alignment: .leading)
                if let year = item.year {
                    Text(String(year))
                        .font(.system(.caption2))
                        .foregroundStyle(Theme.Palette.textSecondary)
                }
            }
        }
        .buttonStyle(CardButtonStyle())
        .accessibilityLabel(item.title)
    }
}
