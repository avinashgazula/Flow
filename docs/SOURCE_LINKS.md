# "Opened on a different connection": links tied to one internet connection

## What you see

You pick a source and, instead of the film, a short video plays: "Opened on a different connection. This stream link only works on the internet connection that requested it. Open the title again on this device. Expected IP: A, Current IP: B", signed "Brought to you by ElfHosted".

This is not a Marquee error and not a copyright notice. It is a slate: a short video an add-on serves in place of the file when it refuses a request, so it looks like a video and not like an error.

## What it means

ElfHosted's public add-ons (AIOStreams, Comet, MediaFusion and others) tie every play link to the internet connection that asked for the stream list. A link opened from any other connection gets the slate. "Expected IP" is the connection that asked for the link; "Current IP" is the one that opened it. A home connection that has both IPv4 and IPv6 is accepted. Links from a private ElfHosted instance are not tied to a connection.
Sources: [Wrong IP, Link expired, Your setup is shared](https://docs.elfhosted.com/stremio-addons/guide/public-addon-messages/), [external players](https://docs.elfhosted.com/stremio-addons/guide/external-players/) and [AIOStreams instances](https://docs.elfhosted.com/stremio-addons/guide/aiostreams-instances/).

## Who asked for the link

Marquee asks add-ons for the stream list from the device that plays (the iPhone, iPad, Mac or Apple TV, or the browser), and opens the play link from the same device. Prefetching on the title page only fetches the list of sources, never a play link. The apps never send add-on requests through a relay, so when "Expected IP" is a data-centre address and not your own, the add-on's own server asked for the link. That happens when your add-on is a wrapper: AIOStreams (or another aggregator) calls a public Comet or MediaFusion on its own, so the link it returns is tied to the aggregator's server and not to you.

On the website there was one way Marquee itself could cause it: a play link that the browser can't read (no CORS headers) was retried through your stream proxy, whose address is a different connection. Marquee no longer sends links from ElfHosted hosts through the proxy; the browser's own player opens them.

## What to change in your add-on

- Use a private ElfHosted instance, whose links are not tied to a connection, or an AIOStreams plan with its own proxy, which serves the video from the proxy's address.
- In AIOStreams, turn on the proxy (StremThru or MediaFlow) for the streams, so that every link is served through one address and the connection that asked is the proxy's, not your phone's. Or use AIOStreams' built-in providers instead of wrapping a public Comet or MediaFusion add-on inside it.
- Don't change networks between choosing a source and playing it (Wi-Fi to mobile data, VPN on or off, casting to a device on another connection). Open the title again on the device that plays.

## What Marquee does now

Marquee treats a slate as a failed source. It spots one when the final address after redirects has "slate" in its host or path, when the video is a few seconds or minutes for a title that runs 20 minutes or more, or when the file is tiny next to the size in the listing. It pauses it, shows "This link only works on the connection that asked for it, so Marquee tried the next source. Check your add-on's proxy setting." and, with Try the Next Source Automatically on, plays the next source. Skip Intro and Skip Credits never show over a slate or an error. The rules are `StreamSlate` in FlowKit and `web/src/lib/sources/slate.ts`, with tests.
