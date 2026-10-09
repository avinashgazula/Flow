import SwiftUI
import FlowKit

struct PersonView: View {
    let personID: Int
    let name: String
    @Environment(AppModel.self) private var model
    @State private var person: Person?
    @State private var expanded = false
    @State private var filter: MediaType?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top, spacing: 18) {
                    RemoteImage(url: TMDBImage.url(person?.profilePath, size: .posterLarge))
                        .frame(width: Platform.isTV ? 240 : 130, height: Platform.isTV ? 360 : 195)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(name).font(.title.weight(.bold))
                        if let known = person?.knownFor { Text(known).foregroundStyle(.secondary) }
                        if let birthday = person?.birthday {
                            Text("Born \(birthday.formatted(date: .long, time: .omitted))" + (person?.placeOfBirth.map { " · \($0)" } ?? ""))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if let death = person?.deathday {
                            Text("Died \(death.formatted(date: .long, time: .omitted))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.horizontal, Platform.horizontalPadding)

                if let bio = person?.biography, !bio.isEmpty {
                    Text(bio)
                        .lineLimit(expanded ? nil : 6)
                        .onTapGesture { withAnimation { expanded.toggle() } }
                        .padding(.horizontal, Platform.horizontalPadding)
                }

                if let credits = person?.credits, !credits.isEmpty {
                    Picker("Type", selection: $filter) {
                        Text("All").tag(MediaType?.none)
                        Text("Movies").tag(MediaType?.some(.movie))
                        Text("Shows").tag(MediaType?.some(.show))
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, Platform.horizontalPadding)
                    PosterGrid(items: filter.map { t in credits.filter { $0.type == t } } ?? credits)
                } else if person == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(name)
        .inlineNavigationTitle()
        .task { person = try? await model.catalog?.person(personID) }
    }
}
