# Marquee Accounts

A Marquee Account keeps everything the same on every device: the website, and iPhone, iPad, Mac and Apple TV, including sideloaded builds where iCloud isn't available. It syncs:

- **Settings:** keys, Trakt and Simkl sign-ins, add-ons, servers, stream proxy, playback, requests, sports (as Marquee Sync always did).
- **The library:** watchlist, favourites, watch history, resume points, ratings, rewatch state, Shuffle's memory, the watchlist's custom order, and the source each title last played from.

There is no username and no password. **Create Account** makes a random 16-digit number, shown as `1234 5678 9012 3456`; **Log In** takes only that number. Like Mullvad, the number is the account.

The Worker, the stream proxy in `web/proxy`, stores encrypted values in a KV namespace and never sees what is inside: every device encrypts before upload and decrypts after download, with a key derived from the number.

This document is the contract between the Worker, the web app and the Apple apps. Change it first, then the code. Marquee Sync, the older pairing with a 26-character key, is kept at the end as **Legacy**; its routes and code stay as they are.

## At a glance

| Decision | Value |
|---|---|
| Account number | 16 digits, CSPRNG, uniform (rejection sampling), leading zeros allowed |
| Slow KDF | PBKDF2-HMAC-SHA256, 600,000 iterations, salt `marquee-account-v1`, 32 bytes |
| Key expansion | HKDF-SHA256, salt `marquee-account-hkdf-v1`, info `id` / `auth` / `enc` |
| Value encryption | AES-256-GCM, random 12-byte nonce, AAD = `<id>/<section>` |
| Account server | Built into each client; **no TOKEN** on the account routes; `auth` only |
| Abuse protection | 20 failed requests per address per 10 minutes, 10 new accounts per address per hour, then 429 |
| Storage | One KV value per section, each with its own `rev`, at most 256 KB |
| Library merge | Newest change per item wins; removals are tombstones, kept 90 days; history is append-only by id |

## The account number

- **Generation:** 16 decimal digits from a cryptographically secure random generator, each digit uniform over 0 to 9. Leading zeros are valid (`0000 0000 0000 0001`).
  - **No modulo bias.** Draw random bytes, discard any byte of 250 or more, and take each kept byte modulo 10 (250 is a multiple of 10, so the ten digits are equally likely). Don't take a 64-bit integer modulo 10^16, and don't use `random() * 10`.
  - Web: `crypto.getRandomValues`. Apple: `SecRandomCopyBytes` (or `SystemRandomNumberGenerator` in Swift, which is cryptographically secure on Apple platforms and Linux).
- **Display:** groups of four joined by one space: `1234 5678 9012 3456`. Copy puts this form on the clipboard.
- **Parsing:** ignore spaces, dashes and other separators (`-`, en and em dashes, `.`, line breaks). What is left must be exactly 16 ASCII digits, else refuse with "That account number isn’t complete. It is 16 digits."
- **Entry fields** format as you type: keep only digits, at most 16, regroup by four. A paste arrives clean. Use a numeric keypad.
- **Strength.** 10^16 is about 2^53. That is only safe because the KDF below makes each guess cost real work, and the server limits online guessing. Never offer to choose or edit a number, and never store it anywhere but the device's secure storage (Keychain on Apple, `localStorage` on the web, as the account's one secret). It is never part of a backup, setup file or log.

## Key derivation

```
master = PBKDF2-HMAC-SHA256(password = the 16 ASCII digits (UTF-8, no spaces),
                            salt     = "marquee-account-v1" (UTF-8),
                            iterations = 600000,
                            length   = 32 bytes)
id     = hex(HKDF-SHA256(ikm = master, salt = "marquee-account-hkdf-v1", info = "id",   length = 16))   32 lowercase hex characters
auth   = base64url(HKDF-SHA256(ikm = master, salt = "marquee-account-hkdf-v1", info = "auth", length = 32))   no padding
enc    = HKDF-SHA256(ikm = master, salt = "marquee-account-hkdf-v1", info = "enc",  length = 32)             the AES-256-GCM key
```

- **Why slow.** A leaked KV record yields `authHash` and ciphertext. With 53 bits of number, the only protection against an offline search is that each candidate costs 600,000 PBKDF2 rounds. Don't lower the count, and don't "cache" a cheaper form.
- **Cost.** 600,000 rounds takes about 0.1 to 0.2 s in a desktop browser (measured: 116 to 185 ms in Chromium on the build machine; WebCrypto runs it natively, so CPU throttling doesn't change it). A mid phone is several times slower, which is the half second to second intended. Do it off the main thread / UI actor, and show a busy state on Create and Log In. Derive once per session and keep `id`, `auth` and `enc` in memory; the number itself is stored so the account can be shown and re-derived at launch.
- **Libraries.** Web: `crypto.subtle` (`PBKDF2` then `HKDF`). Apple: `CCKeyDerivationPBKDF` with `kCCPRFHmacAlgSHA256` (CommonCrypto), then CryptoKit `HKDF<SHA256>`. Linux (FlowKit tests): swift-crypto `_CryptoExtras` `KDF.Insecure.PBKDF2` (it is named Insecure for the hash choice, not the construction; PBKDF2-HMAC-SHA256 is correct here) then `HKDF<SHA256>`.
- **Server-side:** the Worker stores `authHash = sha256hex(auth text)` and never receives the number, `master` or `enc`.

### Test vector

Every implementation must reproduce it in a unit test.

```
number      0123 4567 8901 2345      (digits 0123456789012345)
master      6344acd683acbcc2b39499f864630805f207854c02340dce85af69dbc225a1a2
id          6b91a0a5eaaedba1be38e16c44719d9d
auth        krsalCjaziq29vmpL5N-9mFSKKxHw9Gh6kBIXzMtEVs
enc         6f9e0979236f1e7d4b238729e10b8a035b738a56df8a0c4b77e9094d62a2862f
authHash    7f8e801ad50486dc6ae701363fceaa06c36f4a2eacb469cecddee05a82bf9a59   (sha256 hex of the auth text)
section     settings
plaintext   {"v":1,"sections":{}}
nonce       00 01 02 03 04 05 06 07 08 09 0a 0b
blob        AAECAwQFBgcICQoL-YJfmbY_Yl_9mwPbJ5J_OFZ4fU5zMJZ57StJ4zawwoqNrv-vcg
```

`master` was cross-checked against Python's `hashlib.pbkdf2_hmac`.

## Encryption of a value

- AES-256-GCM with `enc`.
- A fresh random 12-byte nonce for every write.
- Additional authenticated data: the UTF-8 text `<id>/<section>`, e.g. `6b91…9d/lists`. A value copied to another section or account doesn't open.
- Stored form: base64url without padding of `nonce || ciphertext || tag` (CryptoKit's `combined`; the same bytes WebCrypto returns with the nonce prepended).
- The plaintext is UTF-8 JSON.
- Opening fails (wrong key, changed value) with "Couldn’t read the synced data. Check that the account number here matches your other devices."

## The account server

Login must need only the number, so each client **has the server's address built in**.

- **Website:** `VITE_ACCOUNT_SERVER` at build time (an origin, `https://flow-stream-proxy.example.workers.dev`). If it is empty the site falls back to a server typed under Settings → Account → Account Server, then to the origin of the stream proxy setting. A site built without any shows the field and says what is missing.
- **Apps:** a build setting in `Config/Secrets.xcconfig` (git-ignored; copy `Secrets.example.xcconfig`): `FLOW_ACCOUNT_SERVER_HOST = flow-stream-proxy.example.workers.dev`. A host name only, because `//` starts a comment in an `.xcconfig`; the apps use `https://` plus the host. `project.yml` passes it to Info.plist as `FlowAccountServerHost: $(FLOW_ACCOUNT_SERVER_HOST)`, and the app reads that key. When it is empty the app shows an Account Server field (Settings → Account) where the owner can type one, and says what is missing. **The owner fills it in. Never commit a real address: the repository is public.**
- **Do not** put the proxy `TOKEN` in a client for this. A token in a public bundle is not a secret. The account routes use `auth` alone and the Worker protects itself with rate limits (below). The existing `/sync/*` routes keep requiring the token, as before.

## Worker API

Everything is under `/account/<id>`, `id` being 32 lowercase hex characters (anything else is 404). A section name is `[a-z0-9][a-z0-9-]{0,39}`.

**Every request except `OPTIONS`** carries `Authorization: Bearer <auth>`. There is no `X-Flow-Token`.

**CORS:**
- A request with an `Origin` that isn't in `ALLOWED_ORIGINS` is refused with `403`, preflight included. Native apps send no `Origin` and are let through.
- Allowed origins get `Access-Control-Allow-Origin` (that origin), methods `GET, POST, PUT, DELETE, OPTIONS`, headers `Authorization, Content-Type`, and `Retry-After` exposed.

**Routes:**

| Request | Answer |
|---|---|
| `POST /account/<id>` | Creates the account, storing `authHash = sha256hex(auth)`. `201 {"createdAt"}`. If it already exists and the caller holds its key, `409` (Create Account then draws another number: a collision, practically never). |
| `GET /account/<id>` | `200 {"createdAt", "sections": {"<name>": {"rev", "updatedAt", "size"}}}`: every value the account holds. Not a read of the values. |
| `DELETE /account/<id>` | `204`. Deletes the record and every value. |
| `GET /account/<id>/<section>` | `200 {"rev", "blob", "updatedAt"}`, or `204` when the account has no such value yet. |
| `PUT /account/<id>/<section>` with `{"rev": <the rev this write is based on, 0 for a new value>, "blob": "<text>"}` | `200 {"rev": <new rev>}`. When the stored rev differs: `409 {"rev", "blob", "updatedAt"}` (or `{"rev":0,"blob":null,"updatedAt":null}` when nothing is stored), and the client merges and writes again on top of it. |
| `DELETE /account/<id>/<section>` | `204`. |

**Rules:**
- **No enumeration.** An unknown account and a wrong `auth` both answer `404 "No account matches that number."` with identical text. A missing or malformed `Authorization` header is `401`.
- **Rate limits, per address** (hashed; the Worker stores no address): 20 failed requests (unknown account, wrong key, missing header) per 10 minutes answer `429` with `Retry-After`, and so does every further request from that address until the window ends. Creating accounts is limited to 10 an hour. Successful requests aren't counted. Counters live in the `SYNC` namespace under `rl:`, with an expiry. The optional Cloudflare Rate Limiting binding `ACCOUNT_LIMITER` is also asked, if bound, as a coarse flood brake. Clients show "Too many tries from this network. Wait ten minutes, then try again."
- **Size:** a blob over 256 KB (262,144 characters) is `413`. An account holds at most 400 values.
- **Storage** (KV namespace `SYNC`): `acct:<id>` is `{authHash, createdAt}`; `acct:<id>:<section>` is `{rev, blob, updatedAt}` with KV metadata `{rev, updatedAt, size}`, which is what `GET /account/<id>` lists. `rev` starts at 1 and goes up by one per write. Compare-then-write is best effort (KV has no transactions), which is fine for one person's devices; clients merge on `409`.
- **Deleted accounts.** After `DELETE`, every request with that number is `404`, and a stale write doesn't bring the account back. Other devices read the `404` on their next sync as "This account no longer exists. If you deleted it on another device, log out here."
- **No KV binding:** `501 "Accounts need a KV namespace bound as SYNC. See web/proxy/README.md."` `OPTIONS` answers `204` without KV.
- **KV consistency:** reads can lag a write made in another location by up to a minute. The merge rules make a late read harmless.

## What an account holds

One encrypted value per **section**, each with its own `rev`, so a change writes only the section it touches, and none passes 256 KB:

| Section | Holds | Written when |
|---|---|---|
| `settings` | The settings sections of Marquee Sync, merged as before (below) | A setting changes |
| `lists` | Watchlist, favourites, ratings, rewatches, Shuffle's memory, the watchlist order, and their removals | A list, rating, rewatch or the order changes |
| `progress` | Resume points, and their removals | A title plays (at most about once a minute), or a point is dropped |
| `sources` | The source each title last played from, and its removals | A title is played from a source |
| `history-YYYY-MM` (`-2`, `-3`… when large) | Plays of that UTC month, and their removals | A title is watched or taken out of History |
| `items-0` … `items-f` | A small display card for each title mentioned anywhere, 16 shards by TMDB id | A new title enters the library |

A value that holds nothing isn't written. A reader lists the account (`GET /account/<id>`), reads the sections whose `rev` differs from what it last saw, and ignores sections it doesn't know (a newer version may add some; leave them alone).

Every document is `{"v": 1, …}`. A reader that sees `v` above 1 leaves that value untouched and says "Your other devices use a newer version of Marquee Accounts. Update Marquee here to keep syncing." **Keep what you don't understand:** unknown fields in a document, and unknown fields inside an entry, are carried through as received.

### Shared shapes

- **Key** (`key`): the app's `MediaKey.description`, `<type>:<tmdbID>`, with type `movie` or `show`: `movie:693134`, `show:1396`. The apps' Codable `MediaKey` encodes as an object `{type, tmdbID}`; **the wire is a string**. Write wire DTOs, don't encode the app models directly. A key that doesn't match `^(movie|show):\d+$` is dropped.
- **Time:** ISO 8601 UTC, with milliseconds when there are some (`2026-10-24T18:00:00.123Z`), read with or without a fraction. This is what `JSONEncoder.flow` writes. Settings sections keep second precision (see legacy rules). An entry with an unreadable time is dropped.
- **Episode:** `{"season": 3, "episode": 7}`. Extra fields (`name`, `still`: the website's) ride along and the apps ignore them.
- **Episode code:** `S03E07` (`String(format: "S%02dE%02d")`), as `EpisodeRef.code`.
- **Card:** `{"title", "year"?, "date"?: "2024-03-01", "poster"?: "/abc.jpg", "backdrop"?: "/xyz.jpg", "rating"?: 8.1, "genres"?: [18, 878], "originalLanguage"?: "en"}`. Paths are TMDB paths. It is the apps' `MediaItem` cache: `title`, `year` from `releaseDate`, `posterPath`, `backdropPath`, `voteAverage`, genre ids, `originalLanguage`. A reader without a card shows what it already knows, else a placeholder and fetches details when it can; **a writer must write a card for every key it puts in the library**. Cards for keys nothing mentions are dropped when writing.

### `lists`

```json
{
  "v": 1,
  "watchlist":  [ { "key": "movie:693134", "addedAt": "2026-10-24T18:00:00.000Z" } ],
  "favourites": [ { "key": "show:1396",    "addedAt": "2026-10-20T09:12:44.500Z" } ],
  "ratings":    { "movie:693134": { "value": 9, "ratedAt": "2026-10-25T21:30:00.000Z" } },
  "rewatches":  [ { "key": "show:1396", "startedAt": "2026-10-01T10:00:00.000Z", "updatedAt": "2026-10-03T20:00:00.000Z",
                    "watched": [ { "season": 1, "episode": 1 }, { "season": 1, "episode": 2 } ] } ],
  "shuffle":    [ { "key": "show:1396", "played": [ { "season": 2, "episode": 4 } ] } ],
  "order":      { "keys": [ "movie:693134", "show:1396" ], "updatedAt": "2026-10-26T08:00:00.000Z" },
  "removed":    { "watchlist:movie:603": "2026-10-27T19:01:00.000Z", "ratings:movie:550": "2026-10-27T19:02:00.000Z" }
}
```

Mapping: `watchlist` and `favourites` entries are `ListEntry` (`key`, `addedAt`). `ratings` values are `LocalLibrary.Rating` (`value` 1 to 10, `ratedAt`). `rewatches` are `Rewatch` (`key`, `startedAt`, `watched` as a sorted array) **plus a new `updatedAt`** the apps must add: the time the set of watched episodes last changed. `shuffle` is `ShuffleRecord`. `order` is the watchlist's arranged order: the apps' `flow.watchlistOrder`, the web's `watchlistOrder`; titles added since are laid after it (`WatchlistOrder.applying`). Empty arrays and objects are written as such.

### `progress`

```json
{ "v": 1,
  "entries": [ { "key": "show:1396", "episode": { "season": 3, "episode": 7 }, "percent": 41.5, "positionSeconds": 1180, "durationSeconds": 2840, "updatedAt": "2026-10-26T20:15:00.000Z" } ],
  "removed": { "progress:show:1396:S03E06": "2026-10-26T20:00:00.000Z" } }
```

`PlaybackProgress` without `remoteID` (a tracker's own id never leaves the device). Identity is `PlaybackProgress.id`: `<key>` for a film, `<key>:S03E07` for an episode, so a show can hold several resume points. `percent` is 0 to 100. The website keeps one point per title (the newest) and ignores a point with no `positionSeconds` or `durationSeconds`. Writers keep the 500 newest.

### `sources`

```json
{ "v": 1,
  "entries": { "movie:693134": { "providerID": "https://addon.example/manifest.json", "providerName": "Torrentio", "filename": "Dune.Part.Two.2024.2160p.mkv",
                                 "bingeGroup": "torrentio|2160p", "releaseGroup": "FLUX", "resolution": 2160, "quality": "WEB-DL", "hdr": ["DV"],
                                 "date": "2026-10-26T20:00:00.000Z" } },
  "removed": {} }
```

`LastSource` with its Codable names: `providerID`, `filename?`, `bingeGroup?`, `releaseGroup?`, `resolution` (the `VideoResolution` raw value: 0, 480, 720, 1080, 1440, 2160), `quality` (the `ReleaseQuality` raw string, `Unknown` when not known), `hdr` (array of text), `date`. It describes the release, never its link: **no URL, token or header ever goes in it.** Keyed by title key (for a show, the release the last episode came from). `providerName` is optional; a device that can't find `providerID` among its own providers (add-on ids differ between platforms) may match by `providerName`, case-insensitively. Writers keep the 300 newest. The website adds `audio` and `audioChannels` for its format print; the apps ignore them.

### `history-YYYY-MM`

```json
{ "v": 1, "month": "2026-10",
  "entries": [ { "key": "show:1396", "episode": { "season": 3, "episode": 7 }, "watchedAt": "2026-10-24T18:00:00.000Z", "runtime": 47 } ],
  "removed": { "history:show:1396:S03E06:1792864800": "2026-10-27T19:00:00.000Z" } }
```

`HistoryEntry` without `remoteID`, plus the website's optional `runtime` (minutes). Identity is `HistoryEntry.id`: `<key>:<S03E07 or ->:<whole seconds since 1970 of watchedAt>`, e.g. `show:1396:S03E07:1792864800`. The **month** is the UTC `YYYY-MM` of `watchedAt`. A removal lives in the value of the month its id's seconds fall in, on page 1.

**Splitting a busy month** (rare: about 1,500 plays) so no value passes the limit. Every device does this the same way, or two devices would rewrite each other's pages for ever:
1. Sort the month's entries ascending by id (plain string order; ids are ASCII).
2. The size of an entry is the length in characters of its canonical JSON plus 1. Canonical JSON has object keys in sorted order, no whitespace, and numbers and strings as `JSON.stringify` writes them.
3. Fill pages in order. Page 1 starts at the length of its canonical `removed` object plus 40, later pages at 40. Start a new page when adding the next entry would take a page past **160,000** characters and the page already has an entry.
4. Page 1 is `history-2026-10`, then `history-2026-10-2`, `-3`…; only page 1 carries `removed`.
5. A reader unions every page of a month, and merges.

Vector: 1,500 entries `{key: "show:1", episode: {season: 1 + floor(i / 100), episode: i % 100 + 1}, watchedAt: 2026-11-01T12:00:00Z minus i seconds}`, limit 20,000, no removals, give seven pages of 217, 217, 217, 217, 215, 214 and 203 entries (first page 19,990 characters).

**Watched episodes** are derived, not stored: an episode is watched when any history entry names it. The website, which keeps a separate watched-episodes table, writes a play for any watched episode that has none, and removes every play of an episode it marks unwatched.

### `items-0` … `items-f`

```json
{ "v": 1, "items": { "movie:693134": { "title": "Dune: Part Two", "year": 2024, "poster": "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg", "genres": [878, 12] } } }
```

The shard is `items-<lowercase hex digit of (tmdbID mod 16)>`. Merging a card keeps the one the writing device already had; cards are only a display cache.

### `settings`

The plaintext is the Marquee Sync payload, unchanged, so the code that merges it is the same:

```json
{ "v": 1, "sections": { "keys": { "updatedAt": "2026-10-24T18:00:00Z", "device": "iPhone", "data": { } }, "accounts": { }, "addons": { }, "servers": { }, "streamProxy": { }, "playback": { }, "requests": { }, "sports": { } } }
```

The sections, their `data` shapes, and the per-section "newer `updatedAt` wins" merge are in **Legacy: Marquee Sync, Payload** below and apply as written, including keeping unknown sections and fields. The apps already have this in `FlowSyncPayload` and `FlowSyncMerge`: reuse it, replacing only the transport.

## Merging

All merging is a pure function of two copies, so it is unit-tested without a network (`web/src/lib/account/wire.ts` is the reference; port it to `FlowKit`). The same rules apply on every device, and merging a copy with itself changes nothing.

- **Per item, the newest change wins.** An entry's time is `addedAt` (watchlist, favourites), `ratedAt` (ratings), `updatedAt` (progress), `date` (sources), `watchedAt` (history). On a tie, keep the entry whose canonical JSON sorts last, so every device picks the same.
- **Removals are tombstones.** Taking something away records `"<list>:<id>": <time>` in the same document's `removed`, where `list` is `watchlist`, `favourites`, `ratings`, `rewatches`, `progress`, `sources` or `history`, and `id` is the key (or the progress or history id). An entry is gone when a tombstone for it is **at or after the entry's own time**, so an item added again later survives its earlier removal. Tombstones merge by the later time. **Writers drop tombstones older than 90 days** (the apps' 180 days may drop to 90). Don't make a tombstone from a cap: dropping a play because a device keeps only its newest 500 isn't a removal.
- **History is append-only by id:** the same play on two devices is one entry; a play is only ever added or tombstoned, never edited. Cards may be merged freely.
- **Rewatches:** the same `startedAt` is the same round, so the episodes ticked are unioned and the later `updatedAt` wins the rest; a different `startedAt` means the later start wins. Ending a rewatch is a `rewatches:<key>` tombstone.
- **Shuffle:** the union of episodes played, per title. A round that starts over doesn't take plays back from other devices.
- **Order:** the later `updatedAt` wins whole.
- **Settings:** per section, the newer `updatedAt` wins (Legacy rules).
- **Local-only state never syncs:** playback position of a stream that isn't a resume point, caches, the demo switch, appearance, the account number itself.

## When devices talk

- **Pull:** at launch, when the app or tab comes back to the front, and every five minutes while it's open. `GET /account/<id>`, then `GET` each section whose `rev` differs from the one last seen. Apply what's newer, never replace: merge the account's copy with what the device holds.
- **Push:** about three seconds after the last local change, so typing a key or ticking several episodes is one write. Write only the sections whose content differs from what the account last said (compare by meaning, with keys in any order, or a hash of canonical JSON), which keeps within KV's free write allowance. **Resume points tick every few seconds while something plays, so a change to `progress` alone waits for up to a minute**, and a device that is going to the background writes what is waiting at once.
- **On 409:** decrypt the returned value, merge, and write again on top of its `rev`. Give up after three tries: "Another device kept changing your account while Marquee was syncing. Try Sync Now again."
- **A device keeps what it last synced** (its merged state and each section's `rev`) so a pull can tell the account's changes from its own and a removal from a title it never had. If that is lost, it reads everything again and merges.
- **Status:** Settings shows the last successful sync time and any error in words: "Couldn’t reach the account server. Check your connection…", "No account matches that number. Check it against the one you wrote down.", "Too many tries from this network. Wait ten minutes, then try again.", "This account no longer exists. If you deleted it on another device, log out here.", "Your library is too big to sync. A value can hold 256 KB." (a section whose plaintext passes about 190,000 characters).

## Lifecycle

- **Create Account.** Draw a number, derive the keys (busy state), `POST /account/<id>`. On `409` draw another (up to five times). Then sync with nothing to adopt: everything this device holds, settings and library, goes up. If that first upload fails the account is deleted again, so a number the person never saw doesn't linger. **Then show the number** with Copy and the step "Write this down. It’s the only way back into your account. There’s no password to reset, and nobody, Marquee included, can recover it for you." with a check box "I’ve written it down somewhere safe" that gates Continue. The number can be shown again later from Settings (hidden until asked for: Show / Hide / Copy).
- **Log In.** Parse the number, derive, `GET /account/<id>`; `404` is "No account matches that number…". Then sync **adopting**: for settings, a section the account has is taken over this device's (a section the account lacks still goes up, and a sign-in the account has no word about is kept); for the library, **the device's data is kept and merged, never silently dropped**: its watchlist, ratings, history and resume points go up and the account's come down.
- **Log Out.** Forget the number, keys, `rev`s and merged state on this device, stop syncing. The person chooses: **Log Out and Keep My Data** (settings and library stay as they are) or **Log Out and Clear This Device** (settings go back to a fresh install, the library and remembered sources are emptied). Clearing never deletes anything from the account, and the account is forgotten before clearing so the clearing isn't mistaken for the person removing everything. The Apple apps also clear the number from the Keychain.
- **Delete Account.** After a confirmation, `DELETE /account/<id>` (every value), then log out keeping this device's data. Other devices find `404` at their next sync.
- **Move to an Account** (from Marquee Sync). One tap in Settings → Data → Sync: create an account as above (this device's settings, already synced, and its library go up), show the number to write down, turn the pairing off on this device. The old `/sync/<id>` record stays on the Worker until someone erases it from a device that still has the pairing; other paired devices keep syncing settings that way until they move too. Once an account is on, a device that isn't paired isn't offered Turn On Sync.
- **Both on one device** is allowed only during the move; the account is the sync from then on.

## Apps: what to build

- `FlowKit/Sync/Account*`: number (generate, format, parse), keys (PBKDF2 then HKDF, the vector above), the wire DTOs and merge functions of this document with unit tests (reuse the web's cases: `web/src/lib/account/*.test.ts` and `web/proxy/account.test.js`), the client (`GET` list, `GET`/`PUT` section, `POST`, `DELETE`, retry on 409, 429 handling) and the history splitter with the vector.
- Map `LocalLibrary` to the wire as above. `removed` already exists in `LocalLibrary` (`"list:id"` keys with `Date`): the same tombstones, plus a `sources` list; `Rewatch` gains `updatedAt`. Hold the last merged state and each section's `rev`, to tell a remote change from a local one.
- `LastSource`s sync only as descriptions; they are already kept out of Share Setup for the same reason.
- UI (Settings → Account): Create Account, Log In (a numeric field that groups as you type), the number (hidden, Show, Copy), Sync Now, Log Out (keep or clear), Delete Account, and **Move to an Account** where Marquee Sync is on. tvOS: show the number large for writing down, type with the remote's number entry, no Cancel (Back dismisses).
- Welcome / onboarding offers **Log In to Your Account** and **Create an Account**.
- The deployment's address goes in `Config/Secrets.xcconfig` as described under The account server.
- iCloud `CloudSync` remains for devices that have it; it is not an account. With an account on, the account is the source of truth and the two merge by the same rules.

## Limits to know

- Sections are not paged except history, so a library whose `lists` outgrows about 190,000 characters (many thousands of ratings, favourites and tombstones) stops syncing with "Your library is too big to sync." (the Worker's `413`). The web doesn't pre-check; a client may, and should then drop the oldest tombstones before giving up. If that becomes real, split `lists` the way history is split.
- KV's free plan allows 1,000 writes and 100,000 reads a day. A busy account syncing every five minutes reads one list and writes only what changed; resume points write at most once a minute while something plays.
- Offline guessing: a leaked `acct:<id>` record costs an attacker 600,000 PBKDF2 rounds per candidate number out of 10^16. Online guessing is stopped by the 20-per-10-minutes limit and a 128-bit `id` that only the right number derives.

---

## Legacy: Marquee Sync (pairing)

Marquee Accounts replace this: a number instead of a key, the Worker's address built in instead of typed with a token, and the library too. The pairing and its `/sync/<id>` routes keep working unchanged for devices that already use them, and **Move to an Account** (above) is the way off. The `settings` section of an account is this payload, so everything under Payload and its merge rules still applies.

Marquee Sync keeps keys, sign-ins, add-ons and playback preferences the same on every device:
- the website;
- iPhone, iPad, Mac and Apple TV, including sideloaded builds where iCloud isn't available.

It stores one encrypted blob in the owner's own Cloudflare Worker, the stream proxy in `web/proxy`, using a KV namespace. The Worker never sees the contents: every device encrypts before upload and decrypts after download, with a key that only the devices hold.

This document is the contract between the Worker, the web app and the Apple apps. Change it first, then the code.

### Pairing

- **The sync key.** One device turns sync on and makes 16 random bytes. That is the only secret.
  - **Written form:** Crockford base32. The alphabet is `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. The bytes are read as one big-endian bit string, padded with zero bits to a multiple of 5, giving 26 characters.
  - **Display:** groups of four joined by `-`.
  - **Parsing:** uppercase the input, drop `-` and whitespace, read `O` as `0`, and read `I` and `L` as `1`. Anything that isn't 26 valid characters is refused with "That sync key isn't complete. Check it against the one on your other device."
- **The server.** The Worker's origin, e.g. `https://flow-stream-proxy.example.workers.dev`, plus its `TOKEN`.
  - On the web, both come from the stream proxy setting: the origin of the template URL and its `token=` value.
  - In the apps they are typed or come from the link.
- **The pairing link.** It carries all three:
  - `flow://sync?k=<key without dashes>&s=<server origin, URL-encoded>&t=<token, URL-encoded>`
  - Web form: `<site origin>/settings#sync=k=<key>&s=<server>&t=<token>`. The fragment never reaches a server log.
  - Apps show the link as a QR code and offer Copy and Share.
  - Apple TV shows the QR code and the grouped key, and lets the viewer type a key plus server and token.

### Derived values

Everything comes from the 16 key bytes through HKDF-SHA256, with salt `flow-sync-v1` (UTF-8) and these `info` strings:

| Value | info | Length | Encoding |
|---|---|---|---|
| `id` | `id` | 16 bytes | lowercase hex (32 chars): the record name on the server |
| `auth` | `auth` | 32 bytes | base64url without padding: proves the device holds the key |
| `enc` | `enc` | 32 bytes | raw: the AES-256-GCM key |

**Blob:** AES-256-GCM.
- Use a fresh random 12-byte nonce for every upload.
- The additional authenticated data is the UTF-8 `id`.
- Stored form: base64url without padding of `nonce || ciphertext || tag`. This is CryptoKit's `combined` form, and the same bytes WebCrypto returns when the nonce is prepended.

**Test vector.** Every implementation must reproduce it in a unit test.

```
key bytes   00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f
key text    000G40R40M30E209185GR38E1W   (shown as 000G-40R4-0M30-E209-185G-R38E-1W)
id          625ee37823f4fad87a1591ef9038d5c6
auth        MF8YRcz1DFlJqMdCJgMOrexYxSLXV50cYLJsfg2ts50
enc         7216fa3c9cdb9f4f1cd4b5a76c3aa5414ec5d741e8eb1b5f1f8b242fbad13eca
plaintext   {"v":1,"sections":{}}
nonce       00 01 02 03 04 05 06 07 08 09 0a 0b
blob        AAECAwQFBgcICQoLGAP4YCx3YYoDIGnxPMRrrawbsS-rAxRzm-9OU5yZM8MHg9rlLg
authHash    4c921fbf5d2aa65f33ff2423208ef4628a74ddb6f96196e2ff212c073cbd02b0   (sha256 hex of the auth text)
```

### Worker API

All routes sit under `/sync/<id>`, where `id` is 32 lowercase hex characters; anything else gets 404.

**Every request:**
- `X-Flow-Token: <TOKEN>`. `?token=` is accepted too, the same check as the proxy.
- `Authorization: Bearer <auth>`.

**CORS:**
- Origins are the existing `ALLOWED_ORIGINS`.
- Methods: `GET, PUT, DELETE, OPTIONS`.
- Allowed headers: `Authorization, Content-Type, X-Flow-Token`.
- Native apps send no `Origin`. They are let through as the proxy already does for requests without one.

**Routes:**
- `GET`:
  - `200 {"rev": <int>, "blob": "<text>", "updatedAt": "<ISO 8601>"}`;
  - `404` when there is no record yet.
- `PUT` with body `{"rev": <the rev this write is based on, 0 for a new record>, "blob": "<text>"}`:
  - success: `200 {"rev": <new rev>}`;
  - when the stored rev differs: `409 {"rev", "blob", "updatedAt"}`. The client merges, then writes again on top of the returned rev.
- `DELETE`: `204`. It removes the record (Turn Off Sync and Erase).

**Server rules:**
- **Ownership:**
  - The first `PUT` stores `authHash = sha256hex(auth)` with the record.
  - From then on, every request whose auth hashes differently gets `403 "This sync key doesn't match."`.
  - A `GET` of a missing record is a 404 whatever the auth.
- **Errors:**
  - A missing or malformed `Authorization` header, or a missing or wrong token, gets `401`. The token check comes before the 501 check.
  - `OPTIONS` answers `204` even without KV. A `DELETE` of a missing record is `204`.
  - Error bodies are plain text.
- **Erased records:** a `PUT` with a non-zero `rev` on a missing record gets `404` "This sync was erased from another device…" and doesn't recreate it, which keeps Erase meaningful. Clients show that and turn sync off; only `rev` 0 creates a record.
- **Size:** a blob over 256 KB gets `413`.
- **No KV binding:** without a KV binding called `SYNC`, every sync route answers `501 "Sync needs a KV namespace bound as SYNC. See web/proxy/README.md."`.
- **Storage:** KV value `{"authHash", "rev", "blob", "updatedAt"}`.
  - `rev` starts at 1 and goes up by one per write.
  - The compare-then-write is best effort; KV has no transactions. That's acceptable for one person's devices, and clients merge on 409.

### Payload

The plaintext is JSON:

```json
{
  "v": 1,
  "sections": {
    "keys":        { "updatedAt": "2026-10-24T18:00:00Z", "device": "iPhone", "data": { ... } },
    "accounts":    { "updatedAt": "...", "device": "...", "data": { ... } },
    "addons":      { "updatedAt": "...", "device": "...", "data": [ ... ] },
    "servers":     { "updatedAt": "...", "device": "...", "data": [ ... ] },
    "streamProxy": { "updatedAt": "...", "device": "...", "data": { "template": "..." } },
    "playback":    { "updatedAt": "...", "device": "...", "data": { ... } },
    "requests":    { "updatedAt": "...", "device": "...", "data": { "seerr": { ... } | null } },
    "sports":      { "updatedAt": "...", "device": "...", "data": { ... } }
  }
}
```

**Sections:**
- **`keys`:** string or null fields:
  - `tmdbAPIKey`, `tvdbAPIKey`, `mdblistAPIKey`;
  - `openSubtitlesAPIKey`, `openSubtitlesUsername`, `openSubtitlesPassword`;
  - `subdlAPIKey`, `subSourceAPIKey`, `wyzieAPIKey`, `rpdbAPIKey`;
  - `introDBAPIKey`, `publicMetaDBAPIKey`, used for Skip Intro, Recap and Credits;
  - `traktClientID`, `traktClientSecret`, `simklClientID`.

  The web app maps `tmdbKey` to `tmdbAPIKey`, and its Trakt Client ID and Simkl Client ID fields to `traktClientID` and `simklClientID`. A client id this device never had is not written as a blank over one another device set.
- **`accounts`:** `{"trakt": token|null, "simkl": token|null}`. A token is `{"accessToken", "refreshToken", "expiresAt" (ISO 8601 or null), "redirectURI"}`.
  - The website signs in to Trakt too and writes its token here, so a sign-in made anywhere reaches every device. It uses PKCE with no client secret and a redirect URI of `<site origin>/settings/trakt-callback`, which the owner adds to the Trakt app next to the apps' own. `redirectURI` on the token is the one it was issued against, and a refresh on any device quotes it back.
  - The website signs in to Simkl as well (its PIN flow) and writes the token to `accounts.simkl`. A Simkl token has an `accessToken` only: `refreshToken`, `expiresAt` and `redirectURI` are null, and there is nothing to rotate. A device that never held a Simkl sign-in leaves the record's `simkl` as it is, and one that signs out writes `null`.
  - A device that already holds a token keeps it when it joins a sync whose record has none.
  - When a device refreshes a token, it writes the new one at once, since the old refresh token stops working.
  - Before refreshing, a device pulls first in case another device already did.
- **`addons`:** `[{"url": "<manifest URL>", "name", "enabled"}]`, in order.
- **`servers`:** `[{"id", "kind": "jellyfin"|"emby"|"plex", "name", "url", "token", "userId", "username", "machineId"}]`.
- **`streamProxy`:** `{"template": "<proxy URL template>"}`. Only the web uses it; the apps keep it unchanged.
- **`playback`:** `{"audioLanguages": [...], "subtitleLanguages": [...], "subtitleStyle": { native SubtitleSettings key names: fontScale, font, weight, color, edgeStyle, background, backgroundOpacity, verticalPosition }}`.
- **`requests`:** `{"seerr": {"url": "<instance address>", "apiKey": "<its API key>"} | null}`: the Seerr, Overseerr or Jellyseerr instance the Request button asks. `url` is the apps' `SeerrConfig.baseURL` written as text; the website's `seerr.key` is `apiKey`. `null` means none is connected, and a disconnect on any device travels as `null`.
  - A value that isn't an object with a readable `url` and a text `apiKey` is ignored, so junk never disconnects a device.
  - The website writes the section only once it has a Seerr (or has had one and cleared it), so a browser that never connected one can't clear the apps' copy.
- **`sports`:** `{"followedTeams": [...], "apiKey": "<TheSportsDB key>", "showScoreSpoilers": bool, "chooseChannelOnTap": bool}`, under the apps' `SportsSettings` names.
  - A team is `{"id", "name", "league"?, "sport"?, "badgeURL"?, "country"?}`, and `badgeURL` is text. Teams are matched by `id`. A team without an `id` and a `name` is dropped.
  - A field the record doesn't carry, or carries in a shape this version can't read, is left as it is on the device. `apiKey` is text, and a blank or `null` one reads as "unset", which the apps and the website show as TheSportsDB's free test key `123`.
  - A device that has never changed any of it (no teams, key `123`, both switches at their defaults) doesn't write the section.

**Merge rules:**
- **Timestamps** are ISO 8601 UTC. Write them to the second (`2026-10-24T18:00:00Z`) and read them with or without fractional seconds. A local change made within the same second as the section's stored time is stamped one second later, so it can't tie and lose.
- **Section by section, the newer `updatedAt` wins.** A device bumps a section's `updatedAt` (to now, UTC) only when its own value of that section changes. Pulling and applying a section doesn't bump it.
- **Keep what you don't understand.** Unknown sections, and unknown fields inside known sections, are kept as received and written back untouched. The apps carry `streamProxy`, and a newer app can add sections without an older one dropping them. A section a version doesn't know yet (`requests` and `sports` before they existed) is the same case.
- **Clearing is a change.** A cleared value, null or an empty list, is a change like any other and wins when it's newer.
- **Local values never sync.** Device-specific state stays on the device: playback position, caches, the demo switch, appearance.

### When devices talk

- **Pull:** at launch, when the app or tab comes back to the front, and every five minutes while it's open. Apply sections newer than the local copy.
- **Push:** about three seconds after the last local change to a synced value, so typing a key makes one write rather than one per character. Push only when the encrypted payload would differ from the last one sent, which keeps within KV's free write allowance.
- **On 409:** decrypt the returned blob, merge, and write again. Give up after three tries and say so.
- **Status:** Settings shows the last successful sync time and any error in words. Examples: "Couldn't reach your sync server. Check its address and token.", "This sync key doesn't match.", "Sync needs a KV namespace…".

### Turning it off

- **Turn Off Sync** forgets the key on this device and keeps the local settings.
- **Turn Off and Erase** also sends `DELETE`, so no other device can sync until someone turns it on again.
