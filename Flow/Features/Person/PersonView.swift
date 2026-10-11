import SwiftUI
import FlowKit

struct PersonView: View {
    let personID: Int
    let name: String
    @Environment(AppModel.self) private var model
    @State private var person: Person?
    @State private var failed = false
    @State private var expanded = false
    @State private var filter: MediaType?

    private var portraitURL: URL? { TMDBImage.url(person?.profilePath, size: .posterLarge) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                header
                if let bio = person?.biography, !bio.isEmpty {
                    VStack(alignment: .leading, spacing: Theme.Space.xs) {
                        Text(bio)
                            .font(Theme.Typeface.body)
                            .foregroundStyle(Theme.Palette.textSecondary)
                            .lineSpacing(3)
                            .lineLimit(expanded ? nil : 5)
                        if !expanded && bio.count > 280 {
                            Text("MORE").font(Theme.Typeface.micro).kerning(1).foregroundStyle(.white.opacity(0.85))
                        }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation(Theme.Motion.gentle) { expanded.toggle() } }
                    .padding(.horizontal, Theme.Space.gutter)
                }
                if let credits = person?.credits, !credits.isEmpty {
                    VStack(alignment: .leading, spacing: Theme.Space.s) {
                        SectionHeader<Route>("Known For")
                        PosterRow(items: Array(credits.prefix(12)), context: "known-\(personID)")
                    }
                    VStack(alignment: .leading, spacing: Theme.Space.m) {
                        HStack {
                            Text("Filmography").font(Theme.Typeface.sectionTitle).displayTracking()
                            Spacer()
                            Picker("Type", selection: $filter) {
                                Text("All").tag(MediaType?.none)
                                Text("Movies").tag(MediaType?.some(.movie))
                                Text("Shows").tag(MediaType?.some(.show))
                            }
                            .pickerStyle(.segmented)
                            .frame(maxWidth: 260)
                        }
                        .padding(.horizontal, Theme.Space.gutter)
                        PosterGrid(items: sorted(credits), context: "filmography-\(personID)")
                    }
                } else if person == nil {
                    if failed {
                        Text("Couldn't load details.").font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary)
                            .frame(maxWidth: .infinity).padding(.top, Theme.Space.xxl)
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, Theme.Space.xxl)
                    }
                }
            }
            .padding(.bottom, Theme.Space.xxl)
        }
        .scrollIndicators(.hidden)
        .background(AmbientBackground(url: TMDBImage.url(person?.profilePath, size: .profile), intensity: 0.8))
        #if !os(tvOS)
        // The header already shows the name; on TV a second, larger copy would sit right above it.
        .navigationTitle(name)
        .inlineNavigationTitle()
        #endif
        .task {
            failed = false
            person = try? await model.catalog?.person(personID)
            failed = person == nil && !Task.isCancelled
        }
    }

    private var header: some View {
        VStack(spacing: Theme.Space.m) {
            ZStack {
                if person?.profilePath == nil {
                    Monogram(name: name, fontSize: 48 * Theme.scale)
                } else {
                    RemoteImage(url: portraitURL, maxPixel: 600)
                }
            }
            .frame(width: 168 * Theme.scale, height: 168 * Theme.scale)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(Theme.Palette.hairline, lineWidth: 1))
            .artworkShadow()
            VStack(spacing: 4) {
                Text(name).font(Theme.Typeface.display).displayTracking().multilineTextAlignment(.center)
                if let known = person?.knownFor {
                    Text(known).font(Theme.Typeface.headline).foregroundStyle(Theme.Palette.textSecondary)
                }
                if let line = lifeLine {
                    Text(line).font(Theme.Typeface.caption).foregroundStyle(Theme.Palette.textTertiary).multilineTextAlignment(.center)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Theme.Space.l)
        .padding(.horizontal, Theme.Space.gutter)
    }

    /// TMDb gives birthdays as bare days, parsed as midnight UTC; shown in the local zone they'd land a day early west of Greenwich.
    private static let utc: TimeZone = TimeZone(identifier: "UTC") ?? .gmt

    private func day(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(date: .long, time: .omitted, timeZone: Self.utc))
    }

    private var lifeLine: String? {
        guard let person else { return nil }
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
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func sorted(_ credits: [MediaItem]) -> [MediaItem] {
        let filtered = filter.map { t in credits.filter { $0.type == t } } ?? credits
        return filtered.sorted { ($0.releaseDate ?? .distantPast) > ($1.releaseDate ?? .distantPast) }
    }
}
