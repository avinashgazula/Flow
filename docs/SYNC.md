# Flow Sync

Flow Sync keeps keys, sign-ins, add-ons and playback preferences the same on every device:
- the website;
- iPhone, iPad, Mac and Apple TV, including sideloaded builds where iCloud isn't available.

It stores one encrypted blob in the owner's own Cloudflare Worker, the stream proxy in `web/proxy`, using a KV namespace. The Worker never sees the contents: every device encrypts before upload and decrypts after download, with a key that only the devices hold.

This document is the contract between the Worker, the web app and the Apple apps. Change it first, then the code.

## Pairing

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

## Derived values

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

## Worker API

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

## Payload

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
    "playback":    { "updatedAt": "...", "device": "...", "data": { ... } }
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
  - A device that already holds a token keeps it when it joins a sync whose record has none.
  - When a device refreshes a token, it writes the new one at once, since the old refresh token stops working.
  - Before refreshing, a device pulls first in case another device already did.
- **`addons`:** `[{"url": "<manifest URL>", "name", "enabled"}]`, in order.
- **`servers`:** `[{"id", "kind": "jellyfin"|"emby"|"plex", "name", "url", "token", "userId", "username", "machineId"}]`.
- **`streamProxy`:** `{"template": "<proxy URL template>"}`. Only the web uses it; the apps keep it unchanged.
- **`playback`:** `{"audioLanguages": [...], "subtitleLanguages": [...], "subtitleStyle": { native SubtitleSettings key names: fontScale, font, weight, color, edgeStyle, background, backgroundOpacity, verticalPosition }}`.

**Merge rules:**
- **Timestamps** are ISO 8601 UTC. Write them to the second (`2026-10-24T18:00:00Z`) and read them with or without fractional seconds. A local change made within the same second as the section's stored time is stamped one second later, so it can't tie and lose.
- **Section by section, the newer `updatedAt` wins.** A device bumps a section's `updatedAt` (to now, UTC) only when its own value of that section changes. Pulling and applying a section doesn't bump it.
- **Keep what you don't understand.** Unknown sections, and unknown fields inside known sections, are kept as received and written back untouched. The apps carry `streamProxy`, and a newer app can add sections without an older one dropping them.
- **Clearing is a change.** A cleared value, null or an empty list, is a change like any other and wins when it's newer.
- **Local values never sync.** Device-specific state stays on the device: playback position, caches, the demo switch, appearance.

## When devices talk

- **Pull:** at launch, when the app or tab comes back to the front, and every five minutes while it's open. Apply sections newer than the local copy.
- **Push:** about three seconds after the last local change to a synced value, so typing a key makes one write rather than one per character. Push only when the encrypted payload would differ from the last one sent, which keeps within KV's free write allowance.
- **On 409:** decrypt the returned blob, merge, and write again. Give up after three tries and say so.
- **Status:** Settings shows the last successful sync time and any error in words. Examples: "Couldn't reach your sync server. Check its address and token.", "This sync key doesn't match.", "Sync needs a KV namespace…".

## Turning it off

- **Turn Off Sync** forgets the key on this device and keeps the local settings.
- **Turn Off and Erase** also sends `DELETE`, so no other device can sync until someone turns it on again.
