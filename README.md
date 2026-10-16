This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

Configure the server environment before starting the app. Copy `.env.example`
to `.env.local`, set a MongoDB connection string, a long random `SESSION_SECRET`,
and a YouTube Data API v3 key. Never add real credentials to source control.

Install dependencies and run the Socket.IO-capable custom server:

```bash
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) with your browser to see the result.

## Watch-party entry flows

The landing page has a host form (display name and initial supported video URL) and a
viewer form (display name and six-digit party code). Hosts can open movie search,
select a recommendation to fill the initial URL, and preview it in the embedded
player above search results.

The client calls `POST /api/parties` with `{ "hostName": string, "videoUrl": string }`
to create a party and receives `{ "partyCode": number, "sessionToken": string }`. Joining calls
`POST /api/parties/join` with `{ "name": string, "partyCode": number }` and
receives `{ "partyCode": number, "sessionToken": string }`. Both operations persist
their party data in MongoDB and keep the signed participant token in the current tab.

## Party room APIs and realtime sync

- `GET /api/parties?code=123456` and `GET /api/parties/123456` retrieve a party.
- `POST /api/parties/join` accepts `{ "name": string, "partyCode": number }` and registers the viewer.
- `PATCH /api/parties/123456` accepts `{ "videoUrlToAdd": string }` to add a video to the party library. The active video and playback state are controlled through Socket.IO and are not written to MongoDB.
- `DELETE /api/parties/123456` accepts `{ "action": "leave" | "end" }` with the participant's signed session. A viewer or host can leave; only the host can end the party, which removes its party/chat documents and notifies connected participants.
- `GET /api/chats/123456` returns persisted messages; `POST /api/chats/123456` saves `{ "name": string, "msg": string }` with a server timestamp.

Party and chat documents use the explicit MongoDB collections `parties` and `chats`.
Set `MONGODB_URI`, optionally `MONGODB_DB_NAME` (which overrides the database
name in the URI), `SESSION_SECRET`, and `YOUTUBE_API_KEY` in `.env.local` or the
server environment. `YOUTUBE_REGION_CODE` and `PORT` are optional. Create/join returns a signed
participant token that the current tab stores in `sessionStorage`; each tab can
therefore keep its own host or viewer role even when several participants use
the same browser profile. The server verifies the signature for playback changes.

The development and production scripts run `server.mjs`, which attaches Socket.IO
to the same long-running HTTP server as Next.js. Run `npm run dev` to start the
app at `http://localhost:3001`; set `PORT` to override it. For production, run
`npm run build` and then `npm start` (default port 3000; set `PORT=3001` to use
3001). The host must support a persistent Node.js process. Serverless hosting
does not support this in-memory Socket.IO setup; multiple server instances also
need a Socket.IO adapter/shared state store, which is not configured.
The party room includes a chat panel beside the video on wide screens and below
it on small screens. Chat history and sends use the authenticated REST API and
MongoDB; after a successful save, Socket.IO relays the saved message to the
room. Reconnecting clients reload history, and clients poll every five seconds
as a fallback. Messages are limited to 1000 characters. Playback snapshots and
emoji reactions remain in Socket.IO server memory only.
The room menu lets any participant leave; hosts also have a separate end-party
action. The five reactions float over the video area for two seconds and remain
transient.

Socket.IO events are scoped to each party: `party:join`, `party:leave`,
`party:state`, `party:playback`, `party:video-select`, `party:presence`,
`party:reaction`, `party:chat-message`, `party:ended`, and `party:error`. Playback snapshots and reactions live only
in the Socket.IO server's memory. MongoDB stores party metadata, the party's
video URL library, viewer names, and chat history; it does not store playback or
reactions. The host's signed participant token is verified on socket handshake,
and only host sessions can emit video/playback controls.

If the host disconnects while viewers remain, viewers keep the latest in-memory
snapshot but no further host changes arrive. If everyone leaves, the server drops
the snapshot after 30 minutes. A server restart clears all live playback and
reaction state; the next room join starts paused at the party's first saved video.
This requires a long-running Node host. Serverless deployments are not compatible
with this in-memory Socket.IO setup; multiple server instances would also need a
Socket.IO adapter and shared state store, which are not configured here.

## Playback drift correction and verification

The host remains authoritative. Viewers estimate the expected position from the
latest room snapshot (`positionSeconds`, `updatedAt`, `isPlaying`, and
`playbackRate`). On join and reconnect, the client takes five server clock
samples and uses the lowest round-trip sample's midpoint estimate. Clock
uncertainty is carried into diagnostics; latency samples with uncertainty above
250 ms are excluded. The viewer drift controller samples locally every 250 ms.

In development, the room's **Playback diagnostics** panel exports a JSON report.
Playback commands carry a command ID, host send timestamp, and server acceptance
timestamp; clients record when they process the command. It separates
server-to-client latency from host-send-to-client processing latency. The latter
starts when the host app submits the command, not at physical input or rendered
video output.

Each ready client sends actual `YT.Player.getCurrentTime()` samples once per
second, including player state, playback rate, visibility, clock offset, and
uncertainty. During stable playback, the client estimates player-time jitter
as the 95th percentile of up to 20 residuals between consecutive 250 ms player
samples and expected rate-based progress. The controller includes that jitter
and clock-offset uncertainty in its seek threshold and settlement decision.
The server projects positions to a common server timestamp and
reports maximum pairwise drift only for fresh, visible, same-video samples from
playing or paused players. Clock uncertainty plus observed player jitter must
be at most 250 ms; buffering, cued, hidden, stale, and uncertain samples remain
visible as statuses but are not used for pairwise drift. The jitter estimate is
not a formal bound on YouTube's internal media clock. Diagnostics are bounded
in memory, disabled in production, and not written to server logs.

The current correction policy is deliberately separate from its acceptance
tolerance:

- A viewer requests a seek after absolute drift reaches 0.8 seconds. Smaller
  differences are left alone to avoid reacting to short sampling variations.
  This threshold is provisional: the local YouTube player never reached a
  playing state in the browser check, so its live timing noise could not be
  measured and used to tune the trigger.
- It waits when timing uncertainty overlaps the seek threshold and only marks a
  correction settled when measured residual plus uncertainty is at most 0.5 s.
- It does not seek while the player is buffering, before player readiness, or
  while play/pause or playback-rate commands are still being applied.
- It calls YouTube `seekTo(expectedPosition, true)`, pauses again when the room
  snapshot is paused, then waits at least 1 second for the asynchronous seek to
  settle. A measured residual plus uncertainty of 0.5 seconds or less is
  considered settled.
- A residual above 0.5 seconds can be retried after an 1.8-second cooldown,
  with at most three seeks in one correction attempt. If those attempts do not
  settle, the client backs off for 10 seconds rather than seeking continuously.
- The host is not corrected by its own snapshot. This prevents a correction
  from fighting host controls or being echoed back as a new host command.

The deterministic tests cover clock-offset estimation, percentile calculations,
time-aligned pairwise drift, stale/buffering/hidden/uncertain sample rejection,
drift thresholds, seek settling, retries, and cooldowns. A separate integration
test sends 100 timestamped commands between two local Socket.IO clients. On
2026-10-17, the full local suite reported **n=100; server-to-client p50 0 ms,
p95 0 ms, max 1 ms; host-send-to-client p50 0 ms, p95 1 ms, max 28 ms;
estimated clock uncertainty 0 ms**. Both latency p95 values are below 250 ms
for this local Socket.IO-client measurement. It ends when the receiving test
client processes the state event; it does not measure React rendering or video
output. The full automated suite passed 25 tests.

A real-player run used two separate visible Chromium browser contexts in one
room (Chrome 150.0.7871.250, localhost, video `M7lc1UVf-VE`), with 12 paired
position observations approximately 500 ms apart. Both contexts reported
visible. The host player remained cued (state 5), with its media element at
`currentTime=0`, paused, and `readyState=0`; the viewer remained buffering
(state 3), at `currentTime=0`, with media loading errors. The diagnostics panel
reported **0 ready clients, insufficient-ready-clients, and 0 correction
attempts**. **No valid pairwise playback drift or post-correction drift was
measured; the ≤500 ms acceptance target remains unverified.** The real-player
check could not exercise a playing video in this environment.

This limitation matters because YouTube documents that `seekTo()` may seek to
the closest preceding keyframe when the requested portion is not already
downloaded, and can request more media when `allowSeekAhead` is true. The
client therefore verifies the resulting position and retries only a bounded
number of times; YouTube buffering/keyframe behavior means a sub-500 ms result
cannot be guaranteed for every video or network. Playback-rate changes are
also constrained to the rates supported by the current video. See the [YouTube
IFrame Player API reference](https://developers.google.com/youtube/iframe_api_reference#seekTo).

The follow-up diagnostics check confirms the pairwise ingestion path with two
ready-client test samples (synthetic pairwise result 0.200 s), but another
two-tab actual-player attempt still did not produce two eligible live samples:
the hidden host was cued and the active viewer was buffering. The real-playback
≤500 ms criterion remains unverified. See the [playback diagnostics
verification report](./test-results/playback-diagnostics-verification.md) for
the exact results and repeatable browser procedure.

## Movie recommendations and provider playback

The movie catalog is stored in the `movies` MongoDB collection. `GET /api/movies`
provides title/description search and category filtering; `GET /api/movies/[movieId]`
returns one item. The room and home recommendation components read from this API
and keep the existing YouTube search separate.

The seed route is `POST /api/seed` (implemented by `src/app/api/seed/router.js`).
Set `MOVIE_SEED_TOKEN` in the server environment and invoke it with
Use an `Authorization: Bearer <MOVIE_SEED_TOKEN>` header. The endpoint is disabled if the token is unset or the header is invalid. It searches Internet Archive's own
Advanced Search only for curated creator-attributed Feature Films dated
1970–2019; it does not ingest broad search results, which can contain
commercial movies with inaccurate rights labels. Each selected item must
report a supported Creative Commons license in its metadata, have a creator
and an MP4 derivative of at least 40 minutes, and respond successfully to a
bounded `HEAD` request. Redirects are followed only over HTTPS within
`archive.org` subdomains. Records with missing or inconsistent dates, missing
rights/creator metadata, short runtimes, missing MP4s, or unverified playback
are skipped; nothing is written unless at least 20 curated records pass all
checks. After successful upserts, stale Internet Archive records are removed
so the database reflects this catalogue. Upserts use the unique Archive item
identifier, so rerunning the seed is idempotent.

Rights, hosting, and availability are stored separately. Internet Archive
metadata is uploader-supplied and is not a guarantee of worldwide rights or
uninterrupted playback; the catalog displays the license link and retains that
caveat. See [Internet Archive's movie rights
guidance](https://archivesupport.zendesk.com/hc/en-us/articles/360017808151-Movies-and-Videos-A-Basic-Guide).

The shared player supports the official YouTube IFrame API, direct HTTPS MP4,
WebM, OGV and OGG files through HTML5 video, and the official Internet Archive
embed for item-page URLs. Seeded movies use direct Internet Archive MP4 URLs so
position, duration, play/pause, seek, rate and readiness can be read from the
HTML5 player and use the existing room state/drift policy. The official Archive
embed does not expose a supported cross-origin clock in this app; the player
shows that synchronization limitation. Other unsupported providers are rejected
with an explanation. The server classifies URLs but does not fetch arbitrary
user-supplied media URLs; only the fixed YouTube oEmbed endpoint is used for
YouTube metadata.

Verification coverage is in `tests/movie-seed.test.mjs` and
`tests/video-providers.test.mjs`. The seed tests use mocked Internet Archive
search, metadata, and media responses and do not write to the configured
database. A real catalog seed requires a configured `MOVIE_SEED_TOKEN`,
database, and working network.

## YouTube video search

Video search uses the YouTube Data API v3 through the server-side route
`/api/youtube/search?q=...`. Configure `YOUTUBE_API_KEY` in your local `.env.local`
file (or in the deployment environment) with an API key enabled for YouTube Data
API v3. Keep the key server-side; do not prefix it with `NEXT_PUBLIC_`. Environment
files are ignored by Git in this project.

The search endpoint accepts a `q` parameter between 2 and 100 characters and
returns up to 12 videos with their ID, title, thumbnail, channel name, and URL.
The host search component is available at `src/app/components/VideoSearch.js`;
render it with `isHost` and pass `onSelectVideo(url, video)` to connect a selected
video to a future party flow.

Search results are constrained to assignable YouTube categories whose API titles
match Film or Movie. The category filter is loaded from `videoCategories.list`;
video length and ordering use YouTube's search filters. Optionally set
`YOUTUBE_REGION_CODE` to a two-letter country code (defaults to `US`) to choose
which region's categories are used. These are YouTube uploader categories, so
they are a best-effort movie filter rather than a strict movie-genre guarantee.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
