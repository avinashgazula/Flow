/* Sample data, as FlowKit's DemoCatalog and DemoTransport: answers TMDB requests from a curated
   catalogue so every screen fills without keys or accounts. Artwork comes from TMDB's public image
   CDN; the API itself is never called. Loaded only when sample data is on. */

type Row = [id: number, type: 'movie' | 'show', title: string, year: number, genres: number[], poster: string, backdrop: string, rating: number, runtime: number, certification: string, imdb: string, seasons: number, overview: string]

// prettier-ignore
const rows: Row[] = [
  [693134, "movie", "Dune: Part Two", 2024, [878, 12], "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg", "/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg", 8.2, 167, "PG-13", "tt15239678", 0, "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family."],
  [872585, "movie", "Oppenheimer", 2023, [18, 36], "/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg", "/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg", 8.1, 181, "R", "tt15398776", 0, "The story of J. Robert Oppenheimer's role in the development of the atomic bomb during World War II."],
  [157336, "movie", "Interstellar", 2014, [12, 18, 878], "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", "/xJHokMbljvjADYdit5fK5VQsXEG.jpg", 8.4, 169, "PG-13", "tt0816692", 0, "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival."],
  [155, "movie", "The Dark Knight", 2008, [18, 28, 80, 53], "/qJ2tW6WMUDux911r6m7haRef0WH.jpg", "/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg", 8.5, 152, "PG-13", "tt0468569", 0, "Batman raises the stakes in his war on crime, facing a criminal mastermind known as the Joker."],
  [27205, "movie", "Inception", 2010, [28, 878, 12], "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg", "/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg", 8.4, 148, "PG-13", "tt1375666", 0, "A thief who steals corporate secrets through dream-sharing technology is given the inverse task of planting an idea."],
  [496243, "movie", "Parasite", 2019, [35, 53, 18], "/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg", "/TU9NIjwzjoKPwQHoHshkFcQUCG.jpg", 8.5, 133, "R", "tt6751668", 0, "All unemployed, Ki-taek's family takes peculiar interest in the wealthy and glamorous Parks for their livelihood."],
  [569094, "movie", "Spider-Man: Across the Spider-Verse", 2023, [16, 28, 12], "/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg", "/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg", 8.4, 140, "PG", "tt9362722", 0, "Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence."],
  [603, "movie", "The Matrix", 1999, [28, 878], "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg", "/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg", 8.2, 136, "R", "tt0133093", 0, "A hacker learns from mysterious rebels about the true nature of his reality and his role in the war against its controllers."],
  [550, "movie", "Fight Club", 1999, [18, 53], "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg", "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg", 8.4, 139, "R", "tt0137523", 0, "An insomniac office worker and a devil-may-care soap maker form an underground fight club that evolves into much more."],
  [680, "movie", "Pulp Fiction", 1994, [53, 80], "/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg", "/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg", 8.5, 154, "R", "tt0110912", 0, "The lives of two mob hitmen, a boxer, a gangster and his wife intertwine in four tales of violence and redemption."],
  [238, "movie", "The Godfather", 1972, [18, 80], "/3bhkrj58Vtu7enYsRolD1fZdja1.jpg", "/tmU7GeKVybMWFButWEGl2M4GeiP.jpg", 8.7, 175, "R", "tt0068646", 0, "The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant son."],
  [346698, "movie", "Barbie", 2023, [35, 12], "/iuFNMS8U5cb6xfzi51Dbkovj7vM.jpg", "/nHf61UzkfFno5X1ofIhugCPus2R.jpg", 7.0, 114, "PG-13", "tt1517268", 0, "Barbie and Ken are having the time of their lives in Barbie Land — until they get a chance to go to the real world."],
  [438631, "movie", "Dune", 2021, [878, 12], "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg", "/jYEW5xZkZk2WTrdbMGAPFuBqbDc.jpg", 7.8, 155, "PG-13", "tt1160419", 0, "Paul Atreides, a brilliant and gifted young man born into a great destiny beyond his understanding, travels to the most dangerous planet."],
  [475557, "movie", "Joker", 2019, [80, 53, 18], "/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg", "/n6bUvigpRFqSwmPp1m2YADdbRBc.jpg", 8.2, 122, "R", "tt7286456", 0, "During the 1980s, a failed stand-up comedian is driven insane and turns to a life of crime and chaos in Gotham City."],
  [13, "movie", "Forrest Gump", 1994, [35, 18, 10749], "/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg", "/qdIMHd4sEfJSckfVJfKQvisL02a.jpg", 8.5, 142, "PG-13", "tt0109830", 0, "A man with a low IQ has accomplished great things in his life and been present during significant historic events."],
  [299534, "movie", "Avengers: Endgame", 2019, [12, 878, 28], "/or06FN3Dka5tukK1e9sl16pB3iy.jpg", "/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg", 8.2, 181, "PG-13", "tt4154796", 0, "After the devastating events of Infinity War, the Avengers assemble once more to reverse Thanos' actions."],
  [1396, "show", "Breaking Bad", 2008, [18, 80], "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg", "/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg", 8.9, 47, "TV-MA", "tt0903747", 5, "A chemistry teacher diagnosed with cancer turns to manufacturing and selling methamphetamine to secure his family's future."],
  [1399, "show", "Game of Thrones", 2011, [10765, 18, 10759], "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg", "/suopoADq0k8YZr4dQXcU6pToj6s.jpg", 8.4, 60, "TV-MA", "tt0944947", 8, "Seven noble families fight for control of the mythical land of Westeros."],
  [66732, "show", "Stranger Things", 2016, [18, 10765, 9648], "/49WJfeN0moxb9IPfGn8AIqMGskD.jpg", "/56v2KjBlU4XaOv9rVYEQypROD7P.jpg", 8.6, 51, "TV-14", "tt4574334", 4, "When a young boy vanishes, a small town uncovers a mystery involving secret experiments and supernatural forces."],
  [100088, "show", "The Last of Us", 2023, [18], "/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg", "/uDgy6hyPd82kOHh6I95FLtLnj6p.jpg", 8.6, 55, "TV-MA", "tt3581920", 2, "Twenty years after modern civilization has been destroyed, Joel is hired to smuggle Ellie out of an oppressive quarantine zone."],
  [94997, "show", "House of the Dragon", 2022, [10765, 18, 10759], "/z2yahl2uefxDCl0nogcRBstwruJ.jpg", "/etj8E2o0Bud0HkONVQPjyCkIvpv.jpg", 8.4, 63, "TV-MA", "tt11198330", 2, "The Targaryen dynasty is at the absolute apex of its power, two centuries before the events of Game of Thrones."],
  [82856, "show", "The Mandalorian", 2019, [10765, 10759, 18], "/sWgBv7LV2PRoQgkxwlibdGXKz1S.jpg", "/9ijMGlJKqcslswWUzTEwScm82Gs.jpg", 8.5, 40, "TV-14", "tt8111088", 3, "After the fall of the Galactic Empire, a lone gunfighter makes his way through the outer reaches of the lawless galaxy."],
  [119051, "show", "Wednesday", 2022, [10765, 9648, 35], "/9PFonBhy4cQy7Jz20NpMygczOkv.jpg", "/iHSwvRVsRyxpX7FE7GbviaDvgGZ.jpg", 8.5, 50, "TV-14", "tt13443470", 2, "Wednesday Addams is sent to Nevermore Academy, a bizarre boarding school where she attempts to master her psychic powers."],
  [94605, "show", "Arcane", 2021, [16, 10765, 10759], "/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg", "/rkB4LyZHo1NHXFEDHl9vSD9r1lI.jpg", 8.7, 40, "TV-14", "tt11126994", 2, "Amid the stark discord of twin cities Piltover and Zaun, two sisters fight on rival sides of a war between magic technologies."],
  [60059, "show", "Better Call Saul", 2015, [80, 18], "/fC2HDm5t0kHl7mTm7jxMR31b7by.jpg", "/t15KHp3iNfHVQBNIaqUGW12xQA4.jpg", 8.7, 47, "TV-MA", "tt3032476", 6, "Six years before Saul Goodman meets Walter White, small-time lawyer Jimmy McGill struggles to make ends meet."],
  [126308, "show", "Shōgun", 2024, [18, 10768], "/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg", "/2zmTngn1tYC1AvfnrFLhxeD82hz.jpg", 8.6, 59, "TV-MA", "tt2788316", 1, "In Japan in the year 1600, Lord Yoshii Toranaga fights for his life as his enemies on the Council of Regents unite against him."],
  [2316, "show", "The Office", 2005, [35], "/qWnJzyZhyy74gjpSjIXWmuk0ifX.jpg", "/mLyW3UTgi2lsMdtueYODcfAB9Ku.jpg", 8.6, 22, "TV-14", "tt0386676", 9, "The everyday lives of office employees in the Scranton, Pennsylvania branch of the fictional Dunder Mifflin Paper Company."],
  [76331, "show", "Succession", 2018, [18, 35], "/7HW47XbkNQ5fiwQFYGWdw9gs144.jpg", "/bcdUYUFk8GdpZJPiSAas9UeocLH.jpg", 8.4, 62, "TV-MA", "tt7660850", 4, "The Roy family controls one of the biggest media and entertainment conglomerates in the world — and its future is up for grabs."],
]

interface Title { id: number; type: 'movie' | 'show'; title: string; year: number; genres: number[]; poster: string; backdrop: string; rating: number; runtime: number; certification: string; imdb: string; seasons: number; overview: string }
export const titles: Title[] = rows.map(([id, type, title, year, genres, poster, backdrop, rating, runtime, certification, imdb, seasons, overview]) => ({ id, type, title, year, genres, poster, backdrop, rating, runtime, certification, imdb, seasons, overview }))

export const cast: [number, string][] = [
  [1190668, 'Timothée Chalamet'], [505710, 'Zendaya'], [2037, 'Cillian Murphy'], [1892, 'Matt Damon'], [3223, 'Robert Downey Jr.'],
  [17419, 'Bryan Cranston'], [1245, 'Scarlett Johansson'], [6193, 'Leonardo DiCaprio'], [64, 'Gary Oldman'],
]

const movieGenres: Record<number, string> = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western' }
const tvGenres: Record<number, string> = { 10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics', 37: 'Western' }
const genreName = (id: number) => movieGenres[id] ?? tvGenres[id] ?? 'Drama'

const episodeNames = ['Pilot', 'The Long Night', 'Crossing Over', 'Echoes', 'Signal', 'Undertow', 'Glass House', 'Daybreak', 'Fault Lines', 'Homecoming', 'The Reckoning', 'Afterglow']
const services = [
  { provider_id: 8, provider_name: 'Netflix', logo_path: '/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg' },
  { provider_id: 350, provider_name: 'Apple TV+', logo_path: '/6uhKBfmtzFqOcLousHwZuzcrScK.jpg' },
  { provider_id: 337, provider_name: 'Disney Plus', logo_path: '/7rwgEs15tFwyR9NPQ5vpzxTj19Q.jpg' },
  { provider_id: 9, provider_name: 'Amazon Prime Video', logo_path: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
]
const stores = [
  { provider_id: 2, provider_name: 'Apple TV', logo_path: '/peURlLlr8jggOwK53fJ5wdQl05y.jpg' },
  { provider_id: 3, provider_name: 'Google Play Movies', logo_path: '/tbEdFQDwx5LEVr8WpSeXQSIirVq.jpg' },
]

const byId = new Map(titles.map((t) => [t.id, t]))
const ofType = (path: string) => (path.includes('/movie') ? titles.filter((t) => t.type === 'movie') : path.includes('/tv') ? titles.filter((t) => t.type === 'show') : titles)
/** Deterministic shuffle, so different lists look different but stay stable. */
const shuffled = <T extends { id: number }>(list: T[], seed: number) =>
  [...list].sort((a, b) => ((Math.imul(a.id, 2654435761) + seed) >>> 0) % 1000 - ((Math.imul(b.id, 2654435761) + seed) >>> 0) % 1000)

function listJSON(t: Title) {
  const o: Record<string, unknown> = {
    id: t.id, overview: t.overview, poster_path: t.poster, backdrop_path: t.backdrop, vote_average: t.rating, vote_count: 12000,
    genre_ids: t.genres, original_language: t.id === 496243 ? 'ko' : 'en', media_type: t.type === 'movie' ? 'movie' : 'tv',
  }
  if (t.type === 'movie') Object.assign(o, { title: t.title, release_date: `${t.year}-06-15` })
  else Object.assign(o, { name: t.title, first_air_date: `${t.year}-03-10` })
  return o
}

const page = (list: Title[], n = 1) => ({ page: n, total_pages: Math.max(1, Math.ceil(list.length / 20)), results: list.slice((n - 1) * 20, n * 20).map(listJSON) })

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const nextEpisode = (t: Title) => 4 + (t.id % 4)

function demoEpisode(t: Title, season: number, number: number, airDate: string) {
  return {
    id: t.id * 1000 + season * 100 + number, season_number: season, episode_number: number,
    name: episodeNames[(number + season) % episodeNames.length], overview: 'The stakes rise as the season builds toward its turning point.',
    still_path: t.backdrop, air_date: airDate, runtime: t.runtime, vote_average: 7.5 + ((number * 7) % 20) / 10,
  }
}

function detail(t: Title) {
  const o: Record<string, any> = listJSON(t)
  o.genres = t.genres.map((id) => ({ id, name: genreName(id) }))
  o.tagline = ''
  const returning = t.type === 'show' && t.year >= 2016
  o.status = t.type === 'movie' ? 'Released' : returning ? 'Returning Series' : 'Ended'
  o.imdb_id = t.imdb
  o.external_ids = { imdb_id: t.imdb, tvdb_id: t.id + 70000 }
  const roles = ['Paul', 'Chani', 'Jessica', 'Duncan', 'Stilgar', 'Irulan']
  o.credits = {
    cast: shuffled(cast.map(([id, name]) => ({ id, name })), t.id).map((p, i) => ({ id: p.id, name: p.name, character: roles[i % roles.length], order: i })),
    crew: [{ id: 137427, name: 'Denis Villeneuve', job: t.type === 'movie' ? 'Director' : 'Creator' }],
  }
  o.videos = { results: [{ key: 'Way9Dexny3w', name: 'Official Trailer', site: 'YouTube', type: 'Trailer', official: true }] }
  const region: Record<string, unknown> = { link: `https://www.themoviedb.org/${t.type === 'movie' ? 'movie' : 'tv'}/${t.id}/watch?locale=US`, flatrate: [services[t.id % services.length]] }
  if (t.type === 'movie') Object.assign(region, { rent: stores, buy: stores })
  o['watch/providers'] = { results: { US: region } }
  const similar = shuffled(titles.filter((x) => x.type === t.type && x.id !== t.id), t.id)
  o.recommendations = page(similar.slice(0, 10))
  o.similar = page(similar.slice(-6))
  o.images = { logos: [] }
  if (t.type === 'movie') {
    o.runtime = t.runtime
    o.release_dates = { results: [{ iso_3166_1: 'US', release_dates: [{ certification: t.certification, type: 3 }] }] }
  } else {
    o.episode_run_time = [t.runtime]
    o.number_of_seasons = t.seasons
    o.content_ratings = { results: [{ iso_3166_1: 'US', rating: t.certification }] }
    o.networks = [{ name: ['HBO', 'Netflix', 'AMC', 'Disney+', 'Apple TV+'][t.id % 5] }]
    o.seasons = Array.from({ length: Math.max(1, t.seasons) }, (_, i) => ({ season_number: i + 1, name: `Season ${i + 1}`, episode_count: 8 + ((i + 1 + t.id) % 5), air_date: `${t.year + i}-03-10`, poster_path: t.poster }))
    const last = Math.max(1, t.seasons)
    if (returning) {
      const next = nextEpisode(t)
      o.last_episode_to_air = demoEpisode(t, last, next - 1, day(-(1 + (t.id % 6))))
      o.next_episode_to_air = demoEpisode(t, last, next, day(1 + (t.id % 12)))
    }
  }
  return o
}

function season(t: Title, n: number) {
  const count = 8 + ((n + t.id) % 5)
  const returning = t.year >= 2016 && n === Math.max(1, t.seasons)
  return {
    season_number: n,
    episodes: Array.from({ length: count }, (_, i) => {
      const e = i + 1
      const aired = !returning || e < nextEpisode(t)
      return demoEpisode(t, n, e, aired ? `${t.year + n - 1}-${String(3 + Math.floor(i / 4)).padStart(2, '0')}-${String(10 + (i % 4) * 7).padStart(2, '0')}` : day(1 + (t.id % 12) + (e - nextEpisode(t)) * 7))
    }),
  }
}

export async function demoTmdb(rawPath: string, query: Record<string, unknown>): Promise<unknown> {
  // A short delay keeps loading states honest, as on the other platforms.
  await new Promise((r) => setTimeout(r, 60))
  const parts = rawPath.split('/').filter(Boolean)
  const n = Number(query.page ?? 1)
  switch (parts[0]) {
    case 'trending':
      return page(ofType(rawPath), n)
    case 'discover': {
      let list = ofType(rawPath)
      const genres = String(query.with_genres ?? '')
      if (genres) {
        const wanted = new Set(genres.split(/[,|]/).map(Number))
        list = list.filter((t) => t.genres.some((g) => wanted.has(g)))
      }
      const sort = String(query.sort_by ?? '')
      if (sort.startsWith('vote_average')) list = [...list].sort((a, b) => b.rating - a.rating)
      if (sort.includes('date.desc')) list = [...list].sort((a, b) => b.year - a.year)
      return page(list, n)
    }
    case 'search': {
      const q = String(query.query ?? '').toLowerCase()
      const results: unknown[] = titles.filter((t) => t.title.toLowerCase().includes(q)).map(listJSON)
      for (const [id, name] of cast) if (name.toLowerCase().includes(q)) results.push({ id, name, media_type: 'person', known_for_department: 'Acting', known_for: shuffled(titles, id).slice(0, 2).map(listJSON) })
      return { page: 1, total_pages: 1, results }
    }
    case 'genre': {
      const table = rawPath.includes('/movie') ? movieGenres : tvGenres
      return { genres: Object.entries(table).map(([id, name]) => ({ id: Number(id), name })) }
    }
    case 'person': {
      const person = cast.find(([id]) => id === Number(parts[1]))
      if (!person) throw new Error('Not in the sample data')
      return {
        id: person[0], name: person[1], known_for_department: 'Acting', birthday: '1985-04-12', place_of_birth: 'Los Angeles, California',
        biography: `${person[1]} is an acclaimed performer known for work across film and television.`,
        combined_credits: { cast: shuffled(titles, person[0]).slice(0, 10).map(listJSON) },
      }
    }
    case 'movie':
    case 'tv': {
      const lists = ['popular', 'top_rated', 'now_playing', 'upcoming', 'airing_today', 'on_the_air']
      const list = lists.indexOf(parts[1] ?? '')
      if (list >= 0) return page(shuffled(ofType(rawPath), list * 97), n)
      const t = byId.get(Number(parts[1]))
      if (!t) throw new Error('Not in the sample data')
      if (parts.length === 2) return detail(t)
      if (parts[2] === 'season') return season(t, Number(parts[3] ?? 1))
      if (parts[2] === 'external_ids') return { imdb_id: t.imdb, tvdb_id: t.id + 70000 }
      throw new Error('Not in the sample data')
    }
    case 'find':
      return { movie_results: [], tv_results: [] }
    default:
      throw new Error('Not in the sample data')
  }
}

/** Seed data for the library, so Continue Watching, Watchlist and History look lived-in. */
export function seededLibrary() {
  const now = Date.now()
  const it = (id: number) => {
    const t = byId.get(id)!
    return { type: t.type, id: t.id, title: t.title, year: t.year, overview: t.overview, poster: t.poster, backdrop: t.backdrop, rating: t.rating, genres: t.genres }
  }
  const key = (id: number) => `${byId.get(id)!.type}:${id}`
  return {
    progress: {
      [key(1396)]: { key: key(1396), item: it(1396), episode: { season: 3, episode: 7, name: 'One Minute' }, position: 1750, duration: 2820, updatedAt: now - 3600e3 },
      [key(693134)]: { key: key(693134), item: it(693134), position: 3800, duration: 10020, updatedAt: now - 7200e3 },
      [key(100088)]: { key: key(100088), item: it(100088), episode: { season: 2, episode: 3, name: 'The Path' }, position: 590, duration: 3300, updatedAt: now - 86400e3 },
    },
    watchlist: [126308, 94605, 157336, 496243, 82856, 569094].map((id, i) => ({ key: key(id), item: it(id), addedAt: now - i * 3600e3 })),
    favourites: [155, 1396, 603].map((id) => ({ key: key(id), item: it(id), addedAt: now })),
    history: [
      { key: key(872585), item: it(872585), watchedAt: now - 2 * 86400e3 },
      { key: key(155), item: it(155), watchedAt: now - 5 * 86400e3 },
    ],
    watchedEpisodes: {},
  }
}
