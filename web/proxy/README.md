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
stays in your browser (and in Flow's backup file, so keep that private if it holds a token).

## What it does

- `GET` and `HEAD` to `/?url=<encoded https address>`, and `OPTIONS` for the browser's preflight.
- Adds CORS headers only when the request's `Origin` is in `ALLOWED_ORIGINS`.
- Fetches only `https` addresses, on the standard port, with no sign-in in the address.
- Forwards the `Range` header and a plain `User-Agent`. It never passes on the page's cookies or
  authorisation.
- Streams the answer straight through: the status (200, 206 or 416) and the `Content-Range`,
  `Content-Length`, `Accept-Ranges` and `Content-Type` headers. Other statuses, such as a 404, come
  back with a short message instead of the host's page.

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

`match.test.js` covers the host and header rules, and `worker.test.js` runs the Worker against a
stand-in for the network.
