import SwiftUI
import FlowKit

/// "Because You Watched", offered beside a film's credits: a few films like it, and a way to stay.
struct SuggestionsCard: View {
    let session: PlaybackSession

    private var width: CGFloat { Platform.isPhone ? 132 : 164 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Text("Because You Watched \(session.request.item.title)")
                    .font(Theme.Typeface.heading)
                    .foregroundStyle(Theme.Palette.fg)
                    .lineLimit(2)
                Spacer(minLength: 12)
                Button { session.dismissSuggestions() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(PlayerButtonStyle())
                .accessibilityLabel("Keep watching the credits")
            }
            HStack(spacing: 10) {
                ForEach(session.suggestions.prefix(Platform.isPhone ? 2 : 3)) { item in
                    SuggestionTile(item: item, width: width, isNext: item.id == session.nextInCollection?.id) { session.openSuggestion(item) }
                }
            }
        }
        .padding(14)
        .playerPanel()
    }
}

/// Where a film ends when there's something like it to watch: its backdrop, softly blurred,
/// behind a row of suggestions. Closing returns to wherever the film was started.
struct SuggestionsEndScreen: View {
    let session: PlaybackSession
    @FocusState private var focused: String?

    private var width: CGFloat { Platform.isTV ? 420 : Platform.isPhone ? 200 : 300 }

    var body: some View {
        ZStack {
            // Flat base-2: the artwork is in the frames, not behind them.
            Theme.Palette.panel.opacity(0.94).ignoresSafeArea()
            VStack(alignment: .leading, spacing: Platform.isTV ? 28 : 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Because You Watched \(session.request.item.title)")
                        .font(Theme.Typeface.display)
                        .textCase(.uppercase)
                        .tracking(-0.03 * 36)
                        .foregroundStyle(Theme.Palette.fg)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                    // While it's fresh: a score for the film just watched.
                    HStack(spacing: Theme.Space.s) {
                        SectionLabel("How was it?")
                        RatingStars(item: session.request.item, size: 20)
                    }
                    .padding(.top, 4)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Platform.isTV ? 40 : 14) {
                        ForEach(session.suggestions) { item in
                            SuggestionTile(item: item, width: width, isNext: item.id == session.nextInCollection?.id) { session.openSuggestion(item) }
                                .focused($focused, equals: item.id)
                        }
                    }
                    // Room for the focus lift on tvOS.
                    .padding(.vertical, Platform.isTV ? 30 : 6)
                }
                .scrollClipDisabled()
                Button { session.dismissSuggestions() } label: {
                    Label("Done", systemImage: "checkmark")
                }
                .buttonStyle(PlayerActionStyle(compact: true))
                .focused($focused, equals: "done")
            }
            .padding(.horizontal, Platform.isTV ? 90 : Platform.isPhone ? 20 : 48)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .onAppear { focused = session.suggestions.first?.id }
        #if os(tvOS)
        .onExitCommand { session.dismissSuggestions() }
        #endif
    }
}

/// One suggested film: its still in the shared frame with a print-only strip, then its title and year.
private struct SuggestionTile: View {
    let item: MediaItem
    let width: CGFloat
    /// The next film in the same collection.
    var isNext = false
    let action: () -> Void
    @Environment(AppModel.self) private var model

    /// Runtime and rating, with "Next" as the key fact on the next film in the collection.
    private var strip: EdgePrint {
        let print = model.posterPrint(for: item, runtime: item.runtimeMinutes)
        guard isNext else { return print }
        return EdgePrint(lead: print.lead, key: "Next", tail: print.tail)
    }

    var body: some View {
        Button(action: action) {
            FilmCard(art: .still(item), strip: strip, title: item.title, meta: item.year.map { String($0) },
                     width: width, spoken: isNext ? "Next: \(item.title)" : item.title)
        }
        .buttonStyle(CardButtonStyle(lift: 1.04))
    }
}

/// Five stars for a 1–10 score: each star is two points. Tapping the score already given clears it.
struct RatingStars: View {
    let item: MediaItem
    var size: CGFloat = 26
    @Environment(AppModel.self) private var model

    var body: some View {
        let stars = (model.rating(for: item) ?? 0) / 2
        HStack(spacing: 6 * Theme.scale) {
            ForEach(1...5, id: \.self) { star in
                Button {
                    Task { await model.rate(item, star == stars ? nil : star * 2) }
                } label: {
                    Image(systemName: star <= stars ? "star.fill" : "star")
                        .font(.system(size: size * Theme.scale, weight: .semibold))
                        .foregroundStyle(star <= stars ? Theme.Palette.red : Theme.Palette.faint)
                        .contentTransition(.symbolEffect(.replace))
                        .frame(minWidth: 36 * Theme.scale, minHeight: 36 * Theme.scale)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(star) star\(star == 1 ? "" : "s")")
                .accessibilityAddTraits(star == stars ? .isSelected : [])
            }
        }
        .sensoryFeedbackIfAvailable(stars)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your rating")
    }
}
