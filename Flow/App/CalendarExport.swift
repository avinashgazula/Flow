#if !os(tvOS)
import SwiftUI
import EventKit
import FlowKit

/// Puts an upcoming episode or film in Apple Calendar. Flow only ever writes, so it asks for write-only access
/// and never sees what else is on the calendar.
enum CalendarExport {
    struct Event: Equatable {
        var title: String
        var start: Date
        var end: Date
        var isAllDay: Bool
        var notes: String?
        var url: URL?
    }

    /// "Show — S2E5 · Episode Title", or "Film — in cinemas".
    static func event(item: MediaItem, episode: Episode?, date: Date) -> Event {
        let title: String
        let notes: String?
        let url: URL?
        if let episode {
            title = "\(item.title) — S\(episode.season)E\(episode.number) · \(episode.title)"
            notes = episode.overview?.nonEmpty ?? item.overview?.nonEmpty
            url = item.ids.tmdb.flatMap { URL(string: "https://www.themoviedb.org/tv/\($0)/season/\(episode.season)/episode/\(episode.number)") } ?? item.tmdbWebURL
        } else {
            title = "\(item.title) — in cinemas"
            notes = item.overview?.nonEmpty
            url = item.tmdbWebURL
        }
        // A bare TMDb air date becomes an all-day event on that day; Trakt's first_aired is a real moment.
        if let day = AirDateFormatting.localDay(fromBareDay: date) {
            return Event(title: title, start: day, end: day, isAllDay: true, notes: notes, url: url)
        }
        return Event(title: title, start: date, end: date.addingTimeInterval(3600), isAllDay: false, notes: notes, url: url)
    }

    private enum Outcome { case added, denied, failed }

    @MainActor
    static func add(item: MediaItem, episode: Episode?, date: Date, model: AppModel) async {
        switch await save(event(item: item, episode: episode, date: date)) {
        case .added: model.showToast("Added to Calendar")
        case .denied: model.showToast("Flow can't add to your calendar. Allow access in Settings.")
        case .failed: model.showToast("Couldn't add to your calendar.")
        }
    }

    private static func save(_ event: Event) async -> Outcome {
        let store = EKEventStore()
        do {
            guard try await store.requestWriteOnlyAccessToEvents() else { return .denied }
            guard let calendar = store.defaultCalendarForNewEvents else { return .failed }
            let saved = EKEvent(eventStore: store)
            saved.calendar = calendar
            saved.title = event.title
            saved.isAllDay = event.isAllDay
            saved.startDate = event.start
            saved.endDate = event.end
            saved.notes = event.notes
            saved.url = event.url
            try store.save(saved, span: .thisEvent)
            return .added
        } catch {
            return EKEventStore.authorizationStatus(for: .event) == .denied ? .denied : .failed
        }
    }
}

/// "Add to Calendar" for a menu: an episode, or a film's release when `episode` is nil.
struct AddToCalendarButton: View {
    let item: MediaItem
    var episode: Episode?
    let date: Date
    @Environment(AppModel.self) private var model

    var body: some View {
        Button { Task { await CalendarExport.add(item: item, episode: episode, date: date, model: model) } } label: {
            Label("Add to Calendar", systemImage: "calendar.badge.plus")
        }
    }
}
#endif
