# Flow stream proxy

A small Cloudflare Worker that lets Flow for the web read files from hosts that block web pages.

## What it's for

Flow in a browser reads Matroska files with range requests, and that needs the file's host to send
CORS headers. Most debrid download servers (Real-Debrid and the like) send none, so Flow can't read
them. In that case the browser plays the file by itself, with the first audio track only: TrueHD, DTS
and Dolby Digital come out silent, and there's no choice of audio track.

This Worker sits in between. Flow asks it for a file, it fetches the file from the host, and it
answers with the CORS headers a web page needs. With the bytes readable, Flow can pick an audio
track and convert audio the browser can't decode.

Flow only sends a file through the proxy when it has to: for hosts it knows are blocked, such as the
debrid services, and for add-ons whose links it has learned are blocked. Files from hosts that allow
web pages are read directly and never touch the Worker.

MediaFlow Proxy does the same job if you already run
it. Paste its address into Flow in the same way, as described below.

## Deploy

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and Node.js.

1. Copy the example settings and edit them:

   ```bash
   cd web/proxy
   cp wrangler.toml.example wrangler.toml
   ```

2. Set the values in `wrangler.toml`:

   - `ALLOWED_ORIGINS`: the address Flow is served from, for example `https://flow.example.com`.
     Only pages on these origins can read the proxy's answers. Add `http://localhost:5173` if you
     run Flow locally.
   - `ALLOWED_HOSTS`: the hosts the proxy may fetch from (see below).

3. Deploy it:

   ```bash
   npx wrangler deploy
   ```

   Wrangler asks you to sign in the first time and prints the Worker's address, like
   `https://flow-stream-proxy.example.workers.dev`.

4. Optional, but a good idea: set a token, so only you can use the proxy.

   ```bash
   npx wrangler secret put TOKEN
   ```

   Type a long random value when it asks. Without a token, anyone who finds the Worker's address
   can use it to download from the hosts you allow, and the bandwidth is yours.

## Flow Sync (optional)

The same Worker can keep your keys, sign-ins, add-ons, servers and playback settings the same on
every device, so you don't type an API key on each one. Flow encrypts everything on your device
before it is sent, with a key only your devices hold. The Worker stores one scrambled record and
cannot read it. Setting it up takes three steps, once:

1. Make the place the record is kept (a Cloudflare KV namespace). In `web/proxy` run:

   ```bash
   npx wrangler kv namespace create SYNC
   ```

   Wrangler prints an `id`, a long string of letters and numbers. Copy it.

2. Tell the Worker about it. In your `wrangler.toml`, add this at the end, with your own id:

   ```toml
   [[kv_namespaces]]
   binding = "SYNC"
   id = "the-id-wrangler-printed"
   ```

   The name must be exactly `SYNC`. `wrangler.toml.example` has the same block.

3. Deploy again:

   ```bash
   npx wrangler deploy
   ```

Set a `TOKEN` too (step 4 above). Sync uses the same token as the proxy, and without one anyone who
finds the Worker's address could store data in your account. Don't commit `wrangler.toml` with a
real id in it; it is yours alone.

Then, in Flow's **Settings → Data → Sync**, choose **Turn On Sync**. Flow makes a sync key and shows
a pairing link and a QR code. Open the link on your other devices, or choose **Join a Sync** and paste
it. The Apple apps pair the same way. If sync says "Sync needs a KV namespace", one of the steps above
was missed: check that the binding is called `SYNC` and that you deployed after adding it.

Sync uses the free KV allowance: Flow writes only when something changed, about three seconds after
you stop typing. A record is capped at 256 KB. **Turn Off and Erase** in Flow deletes the record.

## Which hosts to allow

`ALLOWED_HOSTS` is a comma-separated list of host names. `*.` at the start matches any subdomain, so
`*.real-debrid.com` covers every Real-Debrid download server, but not `real-debrid.com` itself.
List the bare domain too if you need it. A Worker with no `ALLOWED_HOSTS` refuses everything.

Add-ons such as AIOStreams give Flow a play link that redirects to the debrid host. The proxy
follows redirects itself and checks every host on the way, so **both hosts need to be allowed**:

```toml
ALLOWED_HOSTS = "aiostreams.example.com,*.real-debrid.com"
```

If you'd rather keep the first list short, put the debrid hosts in `ALLOWED_REDIRECT_HOSTS`. Those
are accepted as the target of a redirect, but not as an address Flow asks for directly:

```toml
ALLOWED_HOSTS = "aiostreams.example.com"
ALLOWED_REDIRECT_HOSTS = "*.real-debrid.com"
```

Other debrid services work the same way: allow their download hosts (`*.alldebrid.com`,
`*.premiumize.me`, `*.torbox.app`, `*.debrid-link.com`, `*.offcloud.com`, or whatever host the
redirect lands on). If a file fails, the Worker's answer says which host it refused.

## Use it in Flow

Open Flow's **Settings → Playback → Stream Proxy** and paste the Worker's address with `{url}` where
the file's address goes:

```
https://flow-stream-proxy.example.workers.dev/?url={url}
```

With a token:

```
https://flow-stream-proxy.example.workers.dev/?url={url}&token=YOUR_TOKEN
```

If you leave out `{url}`, Flow adds `url=` and the encoded address to the end for you. The setting
stays in your browser (and in Flow's backup file, so keep that private if it holds a token). With
Flow Sync on, it is also kept, encrypted, in your Worker, so your other devices pick it up.

## What it does

- `GET` and `HEAD` to `/?url=<encoded https address>`, and `OPTIONS` for the browser's preflight.
- Adds CORS headers only when the request's `Origin` is in `ALLOWED_ORIGINS`.
- Fetches only `https` addresses, on the standard port, with no sign-in in the address.
- Forwards the `Range` header and a plain `User-Agent`. It never passes on the page's cookies or
  authorisation.
- Streams the answer straight through: the status (200, 206 or 416) and the `Content-Range`,
  `Content-Length`, `Accept-Ranges` and `Content-Type` headers. Other statuses, such as a 404, come
  back with a short message instead of the host's page: which host answered with what, and the
  first 160 characters of its reason when it gave one as plain text or JSON.
- Answers `GET`, `PUT`, `DELETE` and `OPTIONS` on `/sync/<id>` for Flow Sync, ahead of the proxy
  route. It checks the `TOKEN` (`X-Flow-Token` or `?token=`), then that the request's
  `Authorization: Bearer` key is the one the record was created with (`403` if not), refuses a write
  based on an old revision (`409`, with the stored record so the device can merge) or a record over
  256 KB (`413`), and answers `501` when no KV namespace is bound as `SYNC`. The contract is
  `docs/SYNC.md`.
- Adds `X-Flow-Proxy-Hops` (hosts and statuses only) to the answers it fetched, and logs one line a
  request for `wrangler tail`.

## When it doesn’t work

If Flow says "Your stream proxy couldn’t open this file", the reason follows in the same place: in
the audio panel and in the notice about the sound. It comes from the Worker, and it names the host
that answered. To see the same thing from the Worker's side, run this in `web/proxy` and play the
file again:

```bash
npx wrangler tail
```

Each request prints one line: the method, the range asked for, the status the Worker answered with,
and the hosts it talked to, in order. It never prints a path or query string, since those hold
tokens and file ids:

```
GET bytes=0-524287 -> 403 | media.example.com 302, files.example.com 403
```

The same list goes to Flow in an `X-Flow-Proxy-Hops` header. What the messages mean:

- **The file’s host (files.example.com) answered 403.** The download host refused the Worker. If it
  adds what it said, such as an address that isn’t allowed, that is its own reason. Some hosts
  refuse the addresses Cloudflare's servers use. A 404 means the link has expired or the file is
  gone, and a 503 is the host being busy, or turning the Worker away.
- **Couldn’t reach files.example.com.** The Worker couldn’t connect to that host at all.
- **The file redirects to cdn.example.net, which isn’t in ALLOWED_HOSTS or ALLOWED_REDIRECT_HOSTS.**
  Add that host (`*.example.net` covers its subdomains) to one of the two lists and deploy again.
- **files.example.com isn’t in ALLOWED_HOSTS.** The address Flow asked for isn’t on the list.
- **The token is missing or wrong.** The `token=` in Flow's Stream Proxy setting doesn’t match the
  Worker's `TOKEN` secret.
- **This server can’t seek inside the file.** A host on the way sent the whole file when Flow asked
  for a piece of it further in. The Worker skips Cloudflare's own cache (which treats video files as
  cacheable and can do this) and cuts a whole-file answer down when the piece is the file's start,
  so if this still shows, the host named last doesn't take ranges at all.
- **This page isn’t allowed to use this proxy.** Add the address Flow is served from to
  `ALLOWED_ORIGINS`.
- **The stream proxy didn’t answer.** Shown by Flow itself when nothing came back from the Worker at
  all: the address in Settings is wrong, the Worker isn’t deployed, or the browser refused the
  request because `ALLOWED_ORIGINS` doesn’t list this page. `wrangler tail` shows no line for it.

## Limits

Every byte Flow reads through the proxy passes through the Worker, so a long film is a few gigabytes
of traffic through your Cloudflare account. Cloudflare's free plan limits requests per day, and a
film read in chunks makes many of them, so watch the plan's limits if you stream a lot this way.
Anything you set in `ALLOWED_HOSTS` is a host the Worker will fetch for whoever holds the token.

## Tests

```bash
cd web
npm test
```

`match.test.js` covers the host and header rules, `worker.test.js` runs the Worker against a
stand-in for the network, and `sync.test.js` runs the sync routes against an in-memory stand-in for KV.
