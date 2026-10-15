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

The landing page has a host form (display name and initial YouTube URL) and a
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
