/* Sample data, as FlowKit's DemoCatalog and DemoTransport: answers TMDB requests from a curated
   catalogue so every screen fills without keys or accounts. Artwork comes from TMDB's public image
   CDN; the API itself is never called. Loaded only when sample data is on. */

import { demoProviderId } from '../sources/demo'
import { lastSourceStore, type LastSource } from '../sources/lastSource'
import { libraryStore } from '../store/library'

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

/* Who is in what, and who made it: each title's principal cast with the characters they played, and its
   director or creator, as the films and series credit them. Only credits that are well established are
   here; a title lists fewer people rather than guess. The same person is one person wherever they appear. */
type Credits = { cast: [name: string, character: string][]; crew: [name: string, job: 'Director' | 'Creator'][] }

// prettier-ignore
const credits: Record<number, Credits> = {
  693134: { cast: [['Timothée Chalamet', 'Paul Atreides'], ['Zendaya', 'Chani'], ['Rebecca Ferguson', 'Lady Jessica'], ['Javier Bardem', 'Stilgar'], ['Josh Brolin', 'Gurney Halleck'], ['Austin Butler', 'Feyd-Rautha Harkonnen']], crew: [['Denis Villeneuve', 'Director']] },
  872585: { cast: [['Cillian Murphy', 'J. Robert Oppenheimer'], ['Emily Blunt', 'Kitty Oppenheimer'], ['Matt Damon', 'Leslie Groves'], ['Robert Downey Jr.', 'Lewis Strauss'], ['Florence Pugh', 'Jean Tatlock'], ['Josh Hartnett', 'Ernest Lawrence']], crew: [['Christopher Nolan', 'Director']] },
  157336: { cast: [['Matthew McConaughey', 'Cooper'], ['Anne Hathaway', 'Brand'], ['Jessica Chastain', 'Murph'], ['Michael Caine', 'Professor Brand'], ['Matt Damon', 'Dr. Mann'], ['Casey Affleck', 'Tom']], crew: [['Christopher Nolan', 'Director']] },
  155: { cast: [['Christian Bale', 'Bruce Wayne / Batman'], ['Heath Ledger', 'Joker'], ['Aaron Eckhart', 'Harvey Dent'], ['Michael Caine', 'Alfred Pennyworth'], ['Maggie Gyllenhaal', 'Rachel Dawes'], ['Gary Oldman', 'James Gordon']], crew: [['Christopher Nolan', 'Director']] },
  27205: { cast: [['Leonardo DiCaprio', 'Cobb'], ['Joseph Gordon-Levitt', 'Arthur'], ['Elliot Page', 'Ariadne'], ['Tom Hardy', 'Eames'], ['Ken Watanabe', 'Saito'], ['Cillian Murphy', 'Robert Fischer']], crew: [['Christopher Nolan', 'Director']] },
  496243: { cast: [['Song Kang-ho', 'Kim Ki-taek'], ['Lee Sun-kyun', 'Park Dong-ik'], ['Cho Yeo-jeong', 'Park Yeon-kyo'], ['Choi Woo-shik', 'Kim Ki-woo'], ['Park So-dam', 'Kim Ki-jung'], ['Jang Hye-jin', 'Chung-sook']], crew: [['Bong Joon-ho', 'Director']] },
  569094: { cast: [['Shameik Moore', 'Miles Morales'], ['Hailee Steinfeld', 'Gwen Stacy'], ['Brian Tyree Henry', 'Jefferson Davis'], ['Luna Lauren Velez', 'Rio Morales'], ['Oscar Isaac', 'Miguel O’Hara'], ['Jake Johnson', 'Peter B. Parker']], crew: [['Joaquim Dos Santos', 'Director'], ['Kemp Powers', 'Director'], ['Justin K. Thompson', 'Director']] },
  603: { cast: [['Keanu Reeves', 'Neo'], ['Laurence Fishburne', 'Morpheus'], ['Carrie-Anne Moss', 'Trinity'], ['Hugo Weaving', 'Agent Smith'], ['Joe Pantoliano', 'Cypher'], ['Gloria Foster', 'Oracle']], crew: [['Lana Wachowski', 'Director'], ['Lilly Wachowski', 'Director']] },
  550: { cast: [['Brad Pitt', 'Tyler Durden'], ['Edward Norton', 'The Narrator'], ['Helena Bonham Carter', 'Marla Singer'], ['Meat Loaf', 'Robert “Bob” Paulson'], ['Jared Leto', 'Angel Face']], crew: [['David Fincher', 'Director']] },
  680: { cast: [['John Travolta', 'Vincent Vega'], ['Samuel L. Jackson', 'Jules Winnfield'], ['Uma Thurman', 'Mia Wallace'], ['Bruce Willis', 'Butch Coolidge'], ['Ving Rhames', 'Marsellus Wallace'], ['Harvey Keitel', 'Winston Wolfe']], crew: [['Quentin Tarantino', 'Director']] },
  238: { cast: [['Marlon Brando', 'Don Vito Corleone'], ['Al Pacino', 'Michael Corleone'], ['James Caan', 'Sonny Corleone'], ['Robert Duvall', 'Tom Hagen'], ['Diane Keaton', 'Kay Adams'], ['John Cazale', 'Fredo Corleone']], crew: [['Francis Ford Coppola', 'Director']] },
  346698: { cast: [['Margot Robbie', 'Barbie'], ['Ryan Gosling', 'Ken'], ['America Ferrera', 'Gloria'], ['Kate McKinnon', 'Weird Barbie'], ['Issa Rae', 'President Barbie'], ['Will Ferrell', 'Mattel CEO']], crew: [['Greta Gerwig', 'Director']] },
  438631: { cast: [['Timothée Chalamet', 'Paul Atreides'], ['Rebecca Ferguson', 'Lady Jessica'], ['Oscar Isaac', 'Duke Leto Atreides'], ['Josh Brolin', 'Gurney Halleck'], ['Jason Momoa', 'Duncan Idaho'], ['Zendaya', 'Chani']], crew: [['Denis Villeneuve', 'Director']] },
  475557: { cast: [['Joaquin Phoenix', 'Arthur Fleck / Joker'], ['Robert De Niro', 'Murray Franklin'], ['Zazie Beetz', 'Sophie Dumond'], ['Frances Conroy', 'Penny Fleck'], ['Brett Cullen', 'Thomas Wayne']], crew: [['Todd Phillips', 'Director']] },
  13: { cast: [['Tom Hanks', 'Forrest Gump'], ['Robin Wright', 'Jenny Curran'], ['Gary Sinise', 'Lieutenant Dan Taylor'], ['Sally Field', 'Mrs. Gump'], ['Mykelti Williamson', 'Bubba Blue']], crew: [['Robert Zemeckis', 'Director']] },
  299534: { cast: [['Robert Downey Jr.', 'Tony Stark / Iron Man'], ['Chris Evans', 'Steve Rogers / Captain America'], ['Mark Ruffalo', 'Bruce Banner / Hulk'], ['Chris Hemsworth', 'Thor'], ['Scarlett Johansson', 'Natasha Romanoff / Black Widow'], ['Jeremy Renner', 'Clint Barton / Hawkeye']], crew: [['Anthony Russo', 'Director'], ['Joe Russo', 'Director']] },
  1396: { cast: [['Bryan Cranston', 'Walter White'], ['Aaron Paul', 'Jesse Pinkman'], ['Anna Gunn', 'Skyler White'], ['Dean Norris', 'Hank Schrader'], ['Betsy Brandt', 'Marie Schrader'], ['RJ Mitte', 'Walter White Jr.']], crew: [['Vince Gilligan', 'Creator']] },
  1399: { cast: [['Emilia Clarke', 'Daenerys Targaryen'], ['Kit Harington', 'Jon Snow'], ['Peter Dinklage', 'Tyrion Lannister'], ['Lena Headey', 'Cersei Lannister'], ['Nikolaj Coster-Waldau', 'Jaime Lannister'], ['Sophie Turner', 'Sansa Stark']], crew: [['David Benioff', 'Creator'], ['D. B. Weiss', 'Creator']] },
  66732: { cast: [['Millie Bobby Brown', 'Eleven'], ['Finn Wolfhard', 'Mike Wheeler'], ['Winona Ryder', 'Joyce Byers'], ['David Harbour', 'Jim Hopper'], ['Gaten Matarazzo', 'Dustin Henderson'], ['Caleb McLaughlin', 'Lucas Sinclair']], crew: [['Matt Duffer', 'Creator'], ['Ross Duffer', 'Creator']] },
  100088: { cast: [['Pedro Pascal', 'Joel Miller'], ['Bella Ramsey', 'Ellie'], ['Gabriel Luna', 'Tommy Miller'], ['Anna Torv', 'Tess'], ['Nick Offerman', 'Bill']], crew: [['Craig Mazin', 'Creator'], ['Neil Druckmann', 'Creator']] },
  94997: { cast: [['Paddy Considine', 'King Viserys I Targaryen'], ['Emma D’Arcy', 'Rhaenyra Targaryen'], ['Matt Smith', 'Daemon Targaryen'], ['Olivia Cooke', 'Alicent Hightower'], ['Rhys Ifans', 'Otto Hightower'], ['Steve Toussaint', 'Corlys Velaryon']], crew: [['Ryan Condal', 'Creator'], ['George R. R. Martin', 'Creator']] },
  82856: { cast: [['Pedro Pascal', 'Din Djarin'], ['Carl Weathers', 'Greef Karga'], ['Gina Carano', 'Cara Dune'], ['Giancarlo Esposito', 'Moff Gideon'], ['Emily Swallow', 'The Armorer']], crew: [['Jon Favreau', 'Creator']] },
  119051: { cast: [['Jenna Ortega', 'Wednesday Addams'], ['Gwendoline Christie', 'Larissa Weems'], ['Riki Lindhome', 'Dr. Valerie Kinbott'], ['Jamie McShane', 'Sheriff Donovan Galpin'], ['Hunter Doohan', 'Tyler Galpin'], ['Percy Hynes White', 'Xavier Thorpe']], crew: [['Alfred Gough', 'Creator'], ['Miles Millar', 'Creator']] },
  94605: { cast: [['Hailee Steinfeld', 'Vi'], ['Ella Purnell', 'Jinx'], ['Kevin Alejandro', 'Silco'], ['Katie Leung', 'Caitlyn'], ['Jason Spisak', 'Vander'], ['Harry Lloyd', 'Viktor']], crew: [['Christian Linke', 'Creator'], ['Alex Yee', 'Creator']] },
  60059: { cast: [['Bob Odenkirk', 'Jimmy McGill / Saul Goodman'], ['Rhea Seehorn', 'Kim Wexler'], ['Jonathan Banks', 'Mike Ehrmantraut'], ['Michael McKean', 'Chuck McGill'], ['Giancarlo Esposito', 'Gus Fring'], ['Patrick Fabian', 'Howard Hamlin']], crew: [['Vince Gilligan', 'Creator'], ['Peter Gould', 'Creator']] },
  126308: { cast: [['Hiroyuki Sanada', 'Yoshii Toranaga'], ['Cosmo Jarvis', 'John Blackthorne'], ['Anna Sawai', 'Toda Mariko'], ['Tadanobu Asano', 'Kashigi Yabushige'], ['Takehiro Hira', 'Toda Hiromatsu']], crew: [['Rachel Kondo', 'Creator'], ['Justin Marks', 'Creator']] },
  2316: { cast: [['Steve Carell', 'Michael Scott'], ['Rainn Wilson', 'Dwight Schrute'], ['John Krasinski', 'Jim Halpert'], ['Jenna Fischer', 'Pam Beesly'], ['B. J. Novak', 'Ryan Howard'], ['Ed Helms', 'Andy Bernard']], crew: [['Greg Daniels', 'Creator']] },
  76331: { cast: [['Brian Cox', 'Logan Roy'], ['Jeremy Strong', 'Kendall Roy'], ['Sarah Snook', 'Shiv Roy'], ['Kieran Culkin', 'Roman Roy'], ['Alan Ruck', 'Connor Roy'], ['Matthew Macfadyen', 'Tom Wambsgans']], crew: [['Jesse Armstrong', 'Creator']] },
}

/** TMDB's own ids for the people the catalogue has always had; everyone else gets a stable id of their own. */
const directors = new Set(Object.values(credits).flatMap((c) => c.crew.map(([name]) => name)))
const knownPeople: Record<string, number> = {
  'Timothée Chalamet': 1190668, Zendaya: 505710, 'Cillian Murphy': 2037, 'Matt Damon': 1892, 'Robert Downey Jr.': 3223,
  'Bryan Cranston': 17419, 'Scarlett Johansson': 1245, 'Leonardo DiCaprio': 6193, 'Gary Oldman': 64,
}
const personId = (name: string) => {
  if (knownPeople[name]) return knownPeople[name]
  let h = 5381
  for (const ch of name) h = (Math.imul(h, 33) + ch.charCodeAt(0)) >>> 0
  return 9_000_000 + (h % 900_000)
}

/** Everyone credited anywhere in the catalogue, as [id, name]. */
export const cast: [number, string][] = [...new Set(Object.values(credits).flatMap((c) => [...c.cast, ...c.crew].map(([name]) => name)))].map((name) => [personId(name), name])
/** The titles a person is credited in, for their page and for "known for" in search. */
const creditedIn = (id: number) => titles.filter((t) => credits[t.id]?.cast.some(([name]) => personId(name) === id) || credits[t.id]?.crew.some(([name]) => personId(name) === id))

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
/** The region's other subscription services, so the filter sheet has a full row to choose from. */
const moreServices = [
  { provider_id: 15, provider_name: 'Hulu', logo_path: '/bxBlRPEPpMVDc4jMhSrTf2339DW.jpg' },
  { provider_id: 1899, provider_name: 'Max', logo_path: '/jbe4gVSfRlbPTdESXhEKpornsfu.jpg' },
  { provider_id: 531, provider_name: 'Paramount Plus', logo_path: '/h5DcR0J2EESLitnhR8xLG1QymTE.jpg' },
  { provider_id: 386, provider_name: 'Peacock Premium', logo_path: '/8VCV78prwd9QzZnEm0ReO6bERDa.jpg' },
]
/** What a title streams on: one of the first four, and every third title is also on one of the rest.
 *  Fixed by the id, so the detail page and the Explore filter agree. */
const streamsOn = (t: { id: number }) => [services[t.id % services.length]!, ...(t.id % 3 === 0 ? [moreServices[t.id % moreServices.length]!] : [])]
const stores = [
  { provider_id: 2, provider_name: 'Apple TV', logo_path: '/peURlLlr8jggOwK53fJ5wdQl05y.jpg', display_priority: 0 },
  { provider_id: 10, provider_name: 'Amazon Video', logo_path: '/seGSXajazLMCKGB5hnRCidtjay1.jpg', display_priority: 1 },
  { provider_id: 3, provider_name: 'Google Play Movies', logo_path: '/tbEdFQDwx5LEVr8WpSeXQSIirVq.jpg', display_priority: 2 },
  { provider_id: 192, provider_name: 'YouTube', logo_path: '/pTnn5JwWr4p3pG8H6VrpiQo7Vs0.jpg', display_priority: 3 },
]

/* The About rows TMDB would give, for the titles the catalogue knows well: where it was made, what it cost and
   took, and who made it. A title not listed here leaves those rows out, as TMDB does when it has nothing. */
// prettier-ignore
const about: Record<number, { countries: string[]; budget?: number; revenue?: number; companies: string[] }> = {
  693134: { countries: ['US'], budget: 190_000_000, revenue: 714_444_358, companies: ['Legendary Pictures', 'Warner Bros. Pictures'] },
  872585: { countries: ['US', 'GB'], budget: 100_000_000, revenue: 975_811_000, companies: ['Universal Pictures', 'Syncopy', 'Atlas Entertainment'] },
  157336: { countries: ['US', 'GB'], budget: 165_000_000, revenue: 746_606_706, companies: ['Legendary Pictures', 'Syncopy', 'Paramount Pictures'] },
  155: { countries: ['US', 'GB'], budget: 185_000_000, revenue: 1_006_234_167, companies: ['Warner Bros. Pictures', 'Legendary Pictures', 'Syncopy'] },
  1396: { countries: ['US'], companies: ['Sony Pictures Television Studios', 'High Bridge Productions', 'Gran Via Productions'] },
  1399: { countries: ['US'], companies: ['HBO Entertainment', 'Television 360', 'Bighead Littlehead'] },
  66732: { countries: ['US'], companies: ['21 Laps Entertainment', 'Monkey Massacre'] },
  100088: { countries: ['US'], companies: ['HBO', 'Sony Pictures Television', 'PlayStation Productions', 'Naughty Dog'] },
}

/* Every title has the same short list of videos, so the trailer picker has something to pick from. The keys are
   Blender Foundation films, which are openly licensed; the names are what a studio's own channel calls these. */
const videos = [
  { key: 'aqz-KE-bpKQ', name: 'Official Trailer', site: 'YouTube', type: 'Trailer', official: true },
  { key: 'eRsGyueVLvQ', name: 'Final Trailer', site: 'YouTube', type: 'Trailer', official: true },
  { key: 'YE7VzlLtp-4', name: 'Official Teaser', site: 'YouTube', type: 'Teaser', official: true },
  { key: 'R6MlUcmOul8', name: 'Behind the Scenes', site: 'YouTube', type: 'Behind the Scenes', official: true },
  { key: 'unlisted-1', name: 'Fan Cut', site: 'Vimeo', type: 'Trailer', official: false },
]

/* The title logos TMDB has for two of them, as the file paths it serves; the rest have none and set their name as
   text, which is what the page does when a title has no logo art. */
const logos: Record<number, string> = { 693134: '/gOWf4IYBP2m1Q7dhbQJkwxH714x.png', 1396: '/h6yDiAXP5AyOzXHTxjUssYOGbG3.png' }

/* Reviews as TMDB returns them: Markdown, HTML and entities left in, which is what the review cleaning is for.
   They say nothing about any one title, so they read true for every one of them. The third marks its ending as a
   spoiler the way reviewers do. Sample data only. */
const sampleReviews = [
  { id: 'demo-1', author: 'frameperfect', rating: 9, created_at: '2026-09-02T18:21:00.000Z', content: '**Stunning** from the first frame, and the sound design is half the experience &amp; then some.\r\n\r\nThe middle stretch is a touch slow, but the last hour earns it. I wrote more about it [on my blog](https://example.com/review).' },
  { id: 'demo-2', author: 'Maren', rating: 7, created_at: '2026-08-14T09:05:00.000Z', content: 'A confident, patient piece of film-making that trusts its audience.<br/><br/>Not for everyone, but _the performances_ carry it, and it looks gorgeous on a big screen.' },
  { id: 'demo-3', author: 'nightowl', rating: 8, created_at: '2026-07-30T22:40:00.000Z', content: 'Go in cold if you can. [spoiler]The twist in the last act changes how everything before it reads, and it holds up on a second watch.[/spoiler] Highly recommended &mdash; I would watch it again tomorrow.' },
  { id: 'demo-4', author: 'Anonymous', created_at: '2026-06-11T12:00:00.000Z', content: 'Better than I expected. It has real heart, a great cast and a score I have not stopped listening to since. The pacing in the opening act is uneven and a couple of subplots never quite land, but the whole is greater than its parts.\r\n\r\nWhat stayed with me are the quiet scenes: two people in a room, saying less than they mean. That is where the film does its best work, and it is why I think it will be rewatched for years.\r\n\r\nOne note for anyone on the fence: give it the full first half hour before deciding. It pays off.' },
]

/** What Trakt's most-liked comments would add, for sample data (which never calls Trakt): one flagged as a spoiler. */
export function demoComments() {
  return [
    { id: 4101, comment: 'A rare one that is **both** a crowd-pleaser and a proper piece of cinema.', spoiler: false, created_at: '2026-09-20T08:00:00.000Z', user: { username: 'popcorn.pat' }, user_stats: { rating: 9 } },
    { id: 4102, comment: 'The last scene recontextualises the opening. Do not read further if you have not seen it: the reveal is the whole point.', spoiler: true, created_at: '2026-05-02T08:00:00.000Z', user: { username: 'reelreg' }, user_stats: { rating: 8 } },
  ]
}

const byId = new Map(titles.map((t) => [t.id, t]))
const ofType = (path: string) => (path.includes('/movie') ? titles.filter((t) => t.type === 'movie') : path.includes('/tv') ? titles.filter((t) => t.type === 'show') : titles)
/** Deterministic shuffle, so different lists look different but stay stable. */
const shuffled = <T extends { id: number }>(list: T[], seed: number) =>
  [...list].sort((a, b) => ((Math.imul(a.id, 2654435761) + seed) >>> 0) % 1000 - ((Math.imul(b.id, 2654435761) + seed) >>> 0) % 1000)

const originalLanguage = (t: Title) => (t.id === 496243 ? 'ko' : 'en')
const releaseDate = (t: Title) => (t.type === 'movie' ? `${t.year}-06-15` : `${t.year}-03-10`)

function listJSON(t: Title) {
  const o: Record<string, unknown> = {
    id: t.id, overview: t.overview, poster_path: t.poster, backdrop_path: t.backdrop, vote_average: t.rating, vote_count: 12000,
    genre_ids: t.genres, original_language: originalLanguage(t), media_type: t.type === 'movie' ? 'movie' : 'tv',
  }
  if (t.type === 'movie') Object.assign(o, { title: t.title, release_date: releaseDate(t) })
  else Object.assign(o, { name: t.title, first_air_date: releaseDate(t) })
  return o
}

/** Discover's filters, applied to the sample titles the way TMDB applies them to its own. */
function discoverFilter(list: Title[], query: Record<string, unknown>): Title[] {
  const date = list[0]?.type === 'show' ? 'first_air_date' : 'primary_release_date'
  const gte = query[`${date}.gte`] ? String(query[`${date}.gte`]) : ''
  const lte = query[`${date}.lte`] ? String(query[`${date}.lte`]) : ''
  const rating = Number(query['vote_average.gte'] ?? 0)
  const language = query.with_original_language ? String(query.with_original_language) : ''
  const wanted = String(query.with_watch_providers ?? '').split('|').filter(Boolean).map(Number)
  return list.filter((t) => {
    const when = releaseDate(t)
    if (gte && when < gte) return false
    if (lte && when > lte) return false
    if (rating && t.rating < rating) return false
    if (language && originalLanguage(t) !== language) return false
    if (wanted.length && !streamsOn(t).some((p) => wanted.includes(p.provider_id))) return false
    return true
  })
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
  const credited = credits[t.id]
  if (t.type === 'show') o.created_by = (credits[t.id]?.crew ?? []).map(([name]) => ({ id: personId(name), name }))
  o.credits = {
    cast: (credited?.cast ?? []).map(([name, character], order) => ({ id: personId(name), name, character, order })),
    crew: (credited?.crew ?? []).map(([name, job]) => ({ id: personId(name), name, job })),
  }
  o.videos = { results: videos }
  const region: Record<string, unknown> = {
    link: `https://www.themoviedb.org/${t.type === 'movie' ? 'movie' : 'tv'}/${t.id}/watch?locale=US`,
    flatrate: streamsOn(t).map((p, i) => ({ ...p, display_priority: i })),
  }
  // Films can be rented and bought; of the series, every other one can be bought (an even id).
  if (t.type === 'movie') Object.assign(region, { rent: stores.slice(0, 3), buy: stores })
  else if (t.id % 2 === 0) Object.assign(region, { buy: [stores[0], stores[1]] })
  const facts = about[t.id]
  if (facts) {
    o[t.type === 'movie' ? 'production_countries' : 'origin_country'] = t.type === 'movie' ? facts.countries.map((c) => ({ iso_3166_1: c })) : facts.countries
    o.production_companies = facts.companies.map((name, id) => ({ id, name }))
    if (facts.budget) o.budget = facts.budget
    if (facts.revenue) o.revenue = facts.revenue
  }
  o['watch/providers'] = { results: { US: region } }
  const similar = shuffled(titles.filter((x) => x.type === t.type && x.id !== t.id), t.id)
  o.recommendations = page(similar.slice(0, 10))
  o.similar = page(similar.slice(-6))
  o.images = { logos: logos[t.id] ? [{ iso_639_1: 'en', file_path: logos[t.id], vote_average: 5.5 }] : [] }
  if (t.type === 'movie') {
    o.runtime = t.runtime
    o.release_dates = { results: [{ iso_3166_1: 'US', release_dates: [{ certification: t.certification, type: 3 }] }] }
  } else {
    o.episode_run_time = [t.runtime]
    o.number_of_seasons = t.seasons
    o.content_ratings = { results: [{ iso_3166_1: 'US', rating: t.certification }] }
    o.networks = [{ name: ['HBO', 'Netflix', 'AMC', 'Disney+', 'Apple TV+'][t.id % 5] }]
    // TMDB lists Specials as season 0, first. Two of them, aired long ago.
    o.seasons = [
      { season_number: 0, name: 'Specials', episode_count: 2, air_date: `${t.year}-01-05`, poster_path: t.poster },
      ...Array.from({ length: Math.max(1, t.seasons) }, (_, i) => ({ season_number: i + 1, name: `Season ${i + 1}`, episode_count: 8 + ((i + 1 + t.id) % 5), air_date: `${t.year + i}-03-10`, poster_path: t.poster })),
    ]
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
  if (n === 0) return { season_number: 0, episodes: [1, 2].map((e) => ({ ...demoEpisode(t, 0, e, `${t.year}-01-0${4 + e}`), name: e === 1 ? 'Behind the Scenes' : 'Cast Reunion' })) }
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
      return page(discoverFilter(list, query), n)
    }
    case 'watch': {
      // /watch/providers/{movie|tv}: the region's services, most used first.
      return { results: [...services, ...moreServices].map((p, i) => ({ ...p, display_priority: i })) }
    }
    case 'search': {
      const q = String(query.query ?? '').toLowerCase()
      const results: unknown[] = titles.filter((t) => t.title.toLowerCase().includes(q)).map(listJSON)
      for (const [id, name] of cast) if (name.toLowerCase().includes(q)) results.push({ id, name, media_type: 'person', known_for_department: directors.has(name) ? 'Directing' : 'Acting', known_for: creditedIn(id).slice(0, 2).map(listJSON) })
      return { page: 1, total_pages: 1, results }
    }
    case 'genre': {
      const table = rawPath.includes('/movie') ? movieGenres : tvGenres
      return { genres: Object.entries(table).map(([id, name]) => ({ id: Number(id), name })) }
    }
    case 'person': {
      const person = cast.find(([id]) => id === Number(parts[1]))
      if (!person) throw new Error('Not in the sample data')
      // Only what the catalogue knows: who they are and which of these titles they are credited in.
      return {
        id: person[0], name: person[1], known_for_department: directors.has(person[1]) ? 'Directing' : 'Acting', biography: '',
        combined_credits: { cast: creditedIn(person[0]).map(listJSON) },
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
      if (parts[2] === 'reviews') return { page: 1, total_pages: 1, results: sampleReviews.map(({ rating, ...r }) => ({ ...r, author_details: { rating: rating ?? null } })) }
      // Every third film has a scene after its credits and every third a scene during them, so both notes can be seen.
      if (parts[2] === 'keywords') return { keywords: t.id % 3 === 2 ? [{ id: 1, name: 'aftercreditsstinger' }] : t.id % 3 === 1 ? [{ id: 2, name: 'duringcreditsstinger' }] : [] }
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
      ...followed.map(([id, days]) => ({ key: key(id), item: it(id), episode: { season: 1, episode: 1 }, watchedAt: now - days * 86400e3 })),
    ],
    watchedEpisodes,
  }
}

/** The series the sample viewer has been watching: how far through each (whole seasons, then episodes of the
 *  next), so Up Next has next episodes and episodes left, Upcoming has caught-up shows, and posters have
 *  something to say about what is watched. Breaking Bad and The Last of Us are part way through an episode. */
const progressThrough: [id: number, wholeSeasons: number, then: number][] = [
  [1396, 2, 6], [100088, 1, 2], [66732, 3, 3], [94997, 1, 4], [119051, 1, 6], [76331, 1, 3],
]
const followed: [id: number, daysAgo: number][] = [[66732, 6], [94997, 7], [119051, 8], [76331, 9]]
const episodesIn = (id: number, n: number) => 8 + ((n + id) % 5)
const watchedEpisodes: Record<string, number> = {}
for (const [id, whole, then] of progressThrough) {
  const at = Date.now() - 3 * 86400e3
  for (let sn = 1; sn <= whole; sn++) for (let e = 1; e <= episodesIn(id, sn); e++) watchedEpisodes[`show:${id}:s${sn}e${e}`] = at
  for (let e = 1; e <= then; e++) watchedEpisodes[`show:${id}:s${whole + 1}e${e}`] = at
}

/** The release the sample add-on offers as its 4K row, remembered as played for the titles in progress, so
 *  Home's strips and the title page show a real format ("2160P · DV · ATMOS 5.1") and Play opens the same
 *  source the label names. It matches by the add-on's binge group, so it holds for every title and episode. */
function seededLastSources(): Record<string, LastSource> {
  const played = (days: number): LastSource => ({
    providerId: demoProviderId, bingeGroup: 'demo-1', resolution: '2160p', quality: 'WEB-DL', hdr: ['DV', 'HDR10'], audio: ['Atmos', 'DD+'], audioChannels: '5.1', date: Date.now() - days * 86400e3,
  })
  return { 'show:1396': played(0), 'movie:693134': played(0), 'show:100088': played(1) }
}

/** Sample data comes with a lived-in library and a last-played source for what is in progress. Whatever the
 *  viewer already has is left as it is. */
export function seedDemo() {
  libraryStore.set(seededLibrary())
  lastSourceStore.set((st) => ({ byTitle: { ...seededLastSources(), ...st.byTitle } }))
}
