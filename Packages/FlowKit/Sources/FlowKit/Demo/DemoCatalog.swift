import Foundation

/// A curated, offline catalogue used by Demo mode (App Review, first-run exploration, screenshots).
/// Artwork paths point at TMDb's public image CDN; the API itself is never called.
public enum DemoCatalog {
    public struct Title: Sendable {
        public let id: Int
        public let type: MediaType
        public let title: String
        public let year: Int
        public let genres: [Int]
        public let poster: String
        public let backdrop: String
        public let overview: String
        public let rating: Double
        public let runtime: Int
        public let certification: String
        public let imdb: String
        public let seasons: Int

        init(_ id: Int, _ type: MediaType, _ title: String, _ year: Int, _ genres: [Int], _ poster: String, _ backdrop: String, _ rating: Double, _ runtime: Int, _ certification: String, _ imdb: String, seasons: Int = 0, _ overview: String) {
            self.id = id
            self.type = type
            self.title = title
            self.year = year
            self.genres = genres
            self.poster = poster
            self.backdrop = backdrop
            self.overview = overview
            self.rating = rating
            self.runtime = runtime
            self.certification = certification
            self.imdb = imdb
            self.seasons = seasons
        }
    }

    public static let titles: [Title] = [
        Title(693134, .movie, "Dune: Part Two", 2024, [878, 12], "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg", "/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg", 8.2, 167, "PG-13", "tt15239678",
              "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family."),
        Title(872585, .movie, "Oppenheimer", 2023, [18, 36], "/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg", "/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg", 8.1, 181, "R", "tt15398776",
              "The story of J. Robert Oppenheimer's role in the development of the atomic bomb during World War II."),
        Title(157336, .movie, "Interstellar", 2014, [12, 18, 878], "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", "/xJHokMbljvjADYdit5fK5VQsXEG.jpg", 8.4, 169, "PG-13", "tt0816692",
              "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival."),
        Title(155, .movie, "The Dark Knight", 2008, [18, 28, 80, 53], "/qJ2tW6WMUDux911r6m7haRef0WH.jpg", "/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg", 8.5, 152, "PG-13", "tt0468569",
              "Batman raises the stakes in his war on crime, facing a criminal mastermind known as the Joker."),
        Title(27205, .movie, "Inception", 2010, [28, 878, 12], "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg", "/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg", 8.4, 148, "PG-13", "tt1375666",
              "A thief who steals corporate secrets through dream-sharing technology is given the inverse task of planting an idea."),
        Title(496243, .movie, "Parasite", 2019, [35, 53, 18], "/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg", "/TU9NIjwzjoKPwQHoHshkFcQUCG.jpg", 8.5, 133, "R", "tt6751668",
              "All unemployed, Ki-taek's family takes peculiar interest in the wealthy and glamorous Parks for their livelihood."),
        Title(569094, .movie, "Spider-Man: Across the Spider-Verse", 2023, [16, 28, 12], "/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg", "/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg", 8.4, 140, "PG", "tt9362722",
              "Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence."),
        Title(603, .movie, "The Matrix", 1999, [28, 878], "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg", "/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg", 8.2, 136, "R", "tt0133093",
              "A hacker learns from mysterious rebels about the true nature of his reality and his role in the war against its controllers."),
        Title(550, .movie, "Fight Club", 1999, [18, 53], "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg", "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg", 8.4, 139, "R", "tt0137523",
              "An insomniac office worker and a devil-may-care soap maker form an underground fight club that evolves into much more."),
        Title(680, .movie, "Pulp Fiction", 1994, [53, 80], "/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg", "/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg", 8.5, 154, "R", "tt0110912",
              "The lives of two mob hitmen, a boxer, a gangster and his wife intertwine in four tales of violence and redemption."),
        Title(238, .movie, "The Godfather", 1972, [18, 80], "/3bhkrj58Vtu7enYsRolD1fZdja1.jpg", "/tmU7GeKVybMWFButWEGl2M4GeiP.jpg", 8.7, 175, "R", "tt0068646",
              "The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant son."),
        Title(346698, .movie, "Barbie", 2023, [35, 12], "/iuFNMS8U5cb6xfzi51Dbkovj7vM.jpg", "/nHf61UzkfFno5X1ofIhugCPus2R.jpg", 7.0, 114, "PG-13", "tt1517268",
              "Barbie and Ken are having the time of their lives in Barbie Land — until they get a chance to go to the real world."),
        Title(438631, .movie, "Dune", 2021, [878, 12], "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg", "/jYEW5xZkZk2WTrdbMGAPFuBqbDc.jpg", 7.8, 155, "PG-13", "tt1160419",
              "Paul Atreides, a brilliant and gifted young man born into a great destiny beyond his understanding, travels to the most dangerous planet."),
        Title(475557, .movie, "Joker", 2019, [80, 53, 18], "/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg", "/n6bUvigpRFqSwmPp1m2YADdbRBc.jpg", 8.2, 122, "R", "tt7286456",
              "During the 1980s, a failed stand-up comedian is driven insane and turns to a life of crime and chaos in Gotham City."),
        Title(13, .movie, "Forrest Gump", 1994, [35, 18, 10749], "/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg", "/qdIMHd4sEfJSckfVJfKQvisL02a.jpg", 8.5, 142, "PG-13", "tt0109830",
              "A man with a low IQ has accomplished great things in his life and been present during significant historic events."),
        Title(299534, .movie, "Avengers: Endgame", 2019, [12, 878, 28], "/or06FN3Dka5tukK1e9sl16pB3iy.jpg", "/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg", 8.2, 181, "PG-13", "tt4154796",
              "After the devastating events of Infinity War, the Avengers assemble once more to reverse Thanos' actions."),
        Title(1396, .show, "Breaking Bad", 2008, [18, 80], "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg", "/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg", 8.9, 47, "TV-MA", "tt0903747", seasons: 5,
              "A chemistry teacher diagnosed with cancer turns to manufacturing and selling methamphetamine to secure his family's future."),
        Title(1399, .show, "Game of Thrones", 2011, [10765, 18, 10759], "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg", "/suopoADq0k8YZr4dQXcU6pToj6s.jpg", 8.4, 60, "TV-MA", "tt0944947", seasons: 8,
              "Seven noble families fight for control of the mythical land of Westeros."),
        Title(66732, .show, "Stranger Things", 2016, [18, 10765, 9648], "/49WJfeN0moxb9IPfGn8AIqMGskD.jpg", "/56v2KjBlU4XaOv9rVYEQypROD7P.jpg", 8.6, 51, "TV-14", "tt4574334", seasons: 4,
              "When a young boy vanishes, a small town uncovers a mystery involving secret experiments and supernatural forces."),
        Title(100088, .show, "The Last of Us", 2023, [18], "/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg", "/uDgy6hyPd82kOHh6I95FLtLnj6p.jpg", 8.6, 55, "TV-MA", "tt3581920", seasons: 2,
              "Twenty years after modern civilization has been destroyed, Joel is hired to smuggle Ellie out of an oppressive quarantine zone."),
        Title(94997, .show, "House of the Dragon", 2022, [10765, 18, 10759], "/z2yahl2uefxDCl0nogcRBstwruJ.jpg", "/etj8E2o0Bud0HkONVQPjyCkIvpv.jpg", 8.4, 63, "TV-MA", "tt11198330", seasons: 2,
              "The Targaryen dynasty is at the absolute apex of its power, two centuries before the events of Game of Thrones."),
        Title(82856, .show, "The Mandalorian", 2019, [10765, 10759, 18], "/sWgBv7LV2PRoQgkxwlibdGXKz1S.jpg", "/9ijMGlJKqcslswWUzTEwScm82Gs.jpg", 8.5, 40, "TV-14", "tt8111088", seasons: 3,
              "After the fall of the Galactic Empire, a lone gunfighter makes his way through the outer reaches of the lawless galaxy."),
        Title(119051, .show, "Wednesday", 2022, [10765, 9648, 35], "/9PFonBhy4cQy7Jz20NpMygczOkv.jpg", "/iHSwvRVsRyxpX7FE7GbviaDvgGZ.jpg", 8.5, 50, "TV-14", "tt13443470", seasons: 2,
              "Wednesday Addams is sent to Nevermore Academy, a bizarre boarding school where she attempts to master her psychic powers."),
        Title(94605, .show, "Arcane", 2021, [16, 10765, 10759], "/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg", "/rkB4LyZHo1NHXFEDHl9vSD9r1lI.jpg", 8.7, 40, "TV-14", "tt11126994", seasons: 2,
              "Amid the stark discord of twin cities Piltover and Zaun, two sisters fight on rival sides of a war between magic technologies."),
        Title(60059, .show, "Better Call Saul", 2015, [80, 18], "/fC2HDm5t0kHl7mTm7jxMR31b7by.jpg", "/t15KHp3iNfHVQBNIaqUGW12xQA4.jpg", 8.7, 47, "TV-MA", "tt3032476", seasons: 6,
              "Six years before Saul Goodman meets Walter White, small-time lawyer Jimmy McGill struggles to make ends meet."),
        Title(126308, .show, "Shōgun", 2024, [18, 10768], "/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg", "/2zmTngn1tYC1AvfnrFLhxeD82hz.jpg", 8.6, 59, "TV-MA", "tt2788316", seasons: 1,
              "In Japan in the year 1600, Lord Yoshii Toranaga fights for his life as his enemies on the Council of Regents unite against him."),
        Title(2316, .show, "The Office", 2005, [35], "/qWnJzyZhyy74gjpSjIXWmuk0ifX.jpg", "/mLyW3UTgi2lsMdtueYODcfAB9Ku.jpg", 8.6, 22, "TV-14", "tt0386676", seasons: 9,
              "The everyday lives of office employees in the Scranton, Pennsylvania branch of the fictional Dunder Mifflin Paper Company."),
        Title(76331, .show, "Succession", 2018, [18, 35], "/7HW47XbkNQ5fiwQFYGWdw9gs144.jpg", "/bcdUYUFk8GdpZJPiSAas9UeocLH.jpg", 8.4, 62, "TV-MA", "tt7660850", seasons: 4,
              "The Roy family controls one of the biggest media and entertainment conglomerates in the world — and its future is up for grabs."),
    ]

    public static let cast: [(Int, String, String)] = [
        (1190668, "Timothée Chalamet", "Lead"), (505710, "Zendaya", "Co-Lead"), (2037, "Cillian Murphy", "Supporting"),
        (1892, "Matt Damon", "Supporting"), (3223, "Robert Downey Jr.", "Supporting"), (17419, "Bryan Cranston", "Supporting"),
        (1245, "Scarlett Johansson", "Supporting"), (6193, "Leonardo DiCaprio", "Supporting"), (64, "Gary Oldman", "Supporting"),
    ]

    public static func title(_ id: Int) -> Title? { titles.first { $0.id == id } }

    /// Seed data for "This Device" so Continue Watching, Watchlist and History look lived-in.
    public static func seededLibrary(now: Date = Date()) -> LocalLibrary {
        var lib = LocalLibrary()
        lib.progress = [
            PlaybackProgress(key: MediaKey(type: .show, tmdbID: 1396), episode: EpisodeRef(season: 3, episode: 7), percent: 62, positionSeconds: 1750, durationSeconds: 2820, updatedAt: now.addingTimeInterval(-3600)),
            PlaybackProgress(key: MediaKey(type: .movie, tmdbID: 693134), percent: 38, positionSeconds: 3800, durationSeconds: 10020, updatedAt: now.addingTimeInterval(-7200)),
            PlaybackProgress(key: MediaKey(type: .show, tmdbID: 100088), episode: EpisodeRef(season: 2, episode: 3), percent: 18, positionSeconds: 590, durationSeconds: 3300, updatedAt: now.addingTimeInterval(-86400)),
        ]
        lib.watchlist = [126308, 94605, 157336, 496243, 82856, 569094].compactMap { id in
            title(id).map { ListEntry(key: MediaKey(type: $0.type, tmdbID: id), addedAt: now.addingTimeInterval(-Double(id % 50) * 3600)) }
        }
        lib.favourites = [155, 1396, 603].compactMap { id in title(id).map { ListEntry(key: MediaKey(type: $0.type, tmdbID: id)) } }
        lib.history = [
            HistoryEntry(key: MediaKey(type: .movie, tmdbID: 872585), watchedAt: now.addingTimeInterval(-2 * 86400)),
            HistoryEntry(key: MediaKey(type: .movie, tmdbID: 155), watchedAt: now.addingTimeInterval(-5 * 86400)),
        ] + (1...6).map { HistoryEntry(key: MediaKey(type: .show, tmdbID: 1396), episode: EpisodeRef(season: 3, episode: $0), watchedAt: now.addingTimeInterval(-Double(10 - $0) * 86400)) }
        return lib
    }
}
