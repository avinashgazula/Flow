import SwiftUI
import FlowKit

/// A person, as the website sets them: the giant name and a mono facts line under a 2px rule, a framed portrait beside a
/// serif biography, then what they are known for and everything they have been in under a ruled label.
struct PersonView: View {
    let personID: Int
    let name: String
    @Environment(AppModel.self) private var model
    @State private var person: Person?
    @State private var failed = false
    @State private var expanded = false
    @State private var filter: MediaType?
    @State private var width: CGFloat = Platform.isPhone ? 0 : 1200

    /// The portrait beside the biography once there is room for both.
    private var sideBySide: Bool { Platform.isTV || width >= 600 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                PageHead(title: person?.name ?? name, facts: factParts, width: width)
                    .padding(.top, Theme.Space.l)
                if person != nil { intro }
                if let credits = person?.credits, !credits.isEmpty {
                    // A short career is already all on show below: a Known For row would repeat it.
                    if credits.count > 6 {
                        RuledSection(title: "Known For", paddedContent: false) {
                            PosterRow(items: Array(credits.prefix(12)), context: "known-\(personID)")
                        }
                    }
                    RuledSection(title: "Filmography", note: "\(sorted(credits).count)", paddedContent: false) {
                        VStack(alignment: .leading, spacing: Theme.Space.m) {
                            if credits.contains(where: { $0.type == .movie }) && credits.contains(where: { $0.type == .show }) {
                                typeTabs.padding(.horizontal, Theme.Space.gutter)
                            }
                            PosterGrid(items: sorted(credits), context: "filmography-\(personID)")
                        }
                    }
                } else if person == nil {
                    if failed {
                        Text("Couldn't load details.")
                            .font(Theme.Typeface.body)
                            .foregroundStyle(Theme.Palette.muted)
                            .padding(.horizontal, Theme.Space.gutter)
                            .padding(.top, Theme.Space.xl)
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, Theme.Space.xxl)
                    }
                } else {
                    VStack(alignment: .leading, spacing: Theme.Space.xs) {
                        Text("No Credits Yet").font(Theme.Typeface.title).textCase(.uppercase)
                        Text("TMDB doesn't list any films or shows for this person.").font(Theme.Typeface.reading)
                    }
                    .padding(.horizontal, Theme.Space.gutter)
                }
            }
            .padding(.bottom, Theme.Space.xxl)
        }
        .scrollIndicators(.hidden)
        .background(AmbientBackground(url: nil))
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { new in
            if abs(new - width) > 0.5 { width = new }
        }
        #if !os(tvOS)
        // The head already shows the name, so the bar stays empty rather than repeat it a few points above.
        .navigationTitle("")
        .inlineNavigationTitle()
        #endif
        .task {
            failed = false
            person = try? await model.catalog?.person(personID)
            failed = person == nil && !Task.isCancelled
        }
    }

    /// What they are known for, then the life line.
    private var factParts: [String] {
        guard let person else { return [] }
        return [person.knownFor].compactMap { $0 }.filter { !$0.isEmpty } + lifeParts
    }

    private var typeTabs: some View {
        let options: [(value: MediaType?, title: String)] = [(value: nil, title: "All"), (value: .movie, title: "Movies"), (value: .show, title: "Shows")]
        return SegmentedTabs(options: options, selection: $filter)
    }

    // MARK: Portrait and biography

    private var portraitWidth: CGFloat { (Platform.isPhone ? 120 : 200) * Theme.scale }

    @ViewBuilder
    private var intro: some View {
        let bio = person?.biography.flatMap { $0.isEmpty ? nil : $0 }
        Group {
            if sideBySide {
                HStack(alignment: .top, spacing: Theme.Space.xl) {
                    portrait
                    if let bio { biography(bio) }
                    Spacer(minLength: 0)
                }
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.l) {
                    portrait
                    if let bio { biography(bio) }
                }
            }
        }
        .padding(.horizontal, Theme.Space.gutter)
    }

    /// A framed 2:3 portrait; initials on a flat plate when TMDB has no picture.
    private var portrait: some View {
        ZStack {
            if person?.profilePath == nil {
                Monogram(name: name, fontSize: 48 * Theme.scale)
            } else {
                RemoteImage(url: TMDBImage.url(person?.profilePath, size: .posterLarge), maxPixel: 600)
            }
        }
        .frame(width: portraitWidth, height: portraitWidth * 1.5)
        .clipped()
        .ruleFrame()
        .accessibilityHidden(true)
    }

    /// Eight lines (six on a phone), then More when there is more to read.
    private func biography(_ bio: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(bio)
                .font(Theme.Typeface.reading)
                .foregroundStyle(Theme.Palette.fg)
                .lineSpacing(5)
                .lineLimit(expanded ? nil : (Platform.isPhone ? 6 : 8))
                .fixedSize(horizontal: false, vertical: true)
            if bio.count > 280 {
                Button(expanded ? "Show Less" : "Read More") { withAnimation(Theme.Motion.enter) { expanded.toggle() } }
                    .buttonStyle(QuietButtonStyle())
                    // The word lines up with the text above, not with the button's own padding.
                    .padding(.leading, -(Theme.Space.m + 2))
            }
        }
        .frame(maxWidth: 640 * Theme.scale, alignment: .leading)
    }

    /// TMDb gives birthdays as bare days, parsed as midnight UTC; shown in the local zone they'd land a day early west of Greenwich.
    private static let utc: TimeZone = TimeZone(identifier: "UTC") ?? .gmt

    private func day(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(date: .long, time: .omitted, timeZone: Self.utc))
    }

    /// "Born March 3, 1996 (age 28)", the place and "Died ..." as the separate parts of the facts line.
    private var lifeParts: [String] {
        guard let person else { return [] }
        var parts: [String] = []
        if let birthday = person.birthday {
            var born = "Born \(day(birthday))"
            if person.deathday == nil {
                var calendar = Calendar(identifier: .gregorian)
                calendar.timeZone = Self.utc
                // Today's local date, as a UTC day, so the age turns over on the birthday itself.
                let today = calendar.date(from: Calendar.current.dateComponents([.year, .month, .day], from: Date())) ?? Date()
                if let age = calendar.dateComponents([.year], from: birthday, to: today).year { born += " (age \(age))" }
            }
            parts.append(born)
        }
        if let place = person.placeOfBirth { parts.append(place) }
        if let death = person.deathday { parts.append("Died \(day(death))") }
        return parts
    }

    private func sorted(_ credits: [MediaItem]) -> [MediaItem] {
        let filtered = filter.map { t in credits.filter { $0.type == t } } ?? credits
        return filtered.sorted { ($0.releaseDate ?? .distantPast) > ($1.releaseDate ?? .distantPast) }
    }
}
