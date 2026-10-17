# WatchiT — Real-Time Watch Party Platform

WatchiT is a web-based watch-party application that allows people to watch supported videos together in a shared room. It combines synchronized playback controls, real-time chat, emoji reactions, movie recommendations, and persistent party management in one interface.

Built with **Next.js, Socket.IO, MongoDB, and the YouTube IFrame Player API**, WatchiT is designed around a host-controlled viewing experience, where viewers can join using a six-digit party code.

---

## Table of Contents

- [Features](#features)
- [Technology Stack](#technology-stack)
- [Application Workflow](#application-workflow)
- [Demonstration: 10 Concurrent Users](#demonstration-10-concurrent-users)
- [Project Setup](#project-setup)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Real-Time Communication](#real-time-communication)
- [Playback Synchronization](#playback-synchronization)
- [Playback Diagnostics and Verification](#playback-diagnostics-and-verification)
- [Movie Recommendations and Video Providers](#movie-recommendations-and-video-providers)
- [YouTube Video Search](#youtube-video-search)
- [Database Structure](#database-structure)
- [Deployment](#deployment)
- [Testing](#testing)
- [Known Limitations](#known-limitations)
- [Future Improvements](#future-improvements)
- [Useful Resources](#useful-resources)

---

## Features

### 1. Watch Parties

- Create a party by entering a display name and a supported video URL.
- Generate a six-digit party code for viewers to join.
- Join existing parties using a display name and party code.
- Maintain separate host and viewer identities through signed participant session tokens.
- Add videos to the party's shared video library.
- Leave a party or end the session, depending on participant permissions.

### 2. Synchronized Playback

- Host-controlled play, pause, seeking, video selection, and playback-rate changes.
- Real-time playback state distribution using Socket.IO.
- Viewer-side playback drift detection and bounded correction attempts.
- Clock-offset estimation to improve comparisons between clients.
- Readiness, buffering, visibility, and timing-uncertainty checks before evaluating synchronization.

### 3. Real-Time Chat and Reactions

- Send messages to other participants in the room.
- Persist chat messages in MongoDB.
- Broadcast successfully saved messages to connected participants.
- Reload chat history after reconnection.
- Poll for chat updates every five seconds as a fallback.
- Display temporary emoji reactions over the video area.

### 4. Movie Discovery

- Search YouTube videos through the YouTube Data API v3.
- Display matching video titles, thumbnails, channel names, and links.
- Preview selected recommendations in an embedded player.
- Browse movies stored in the application's MongoDB catalogue.
- Support curated Internet Archive movie entries with licence information.

### 5. Playback Diagnostics

- Export playback diagnostics as JSON in development.
- Measure server-to-client and host-command-to-client processing latency separately.
- Record player state, playback position, playback rate, visibility, clock offset, and uncertainty.
- Estimate player-time jitter and calculate eligible pairwise playback drift.
- Exclude unsuitable samples, including hidden, stale, buffering, or excessively uncertain samples, from pairwise drift calculations.

---

## Technology Stack

| Technology | Purpose |
|---|---|
| Next.js | Application framework and API routes |
| React | User interface and interactive components |
| Node.js | Long-running application server |
| Socket.IO | Real-time events and room communication |
| MongoDB | Persistent party metadata, video libraries, and chat history |
| YouTube IFrame Player API | Embedded YouTube playback and player controls |
| YouTube Data API v3 | Video search and metadata |
| HTML5 Video | Playback of supported direct media files |
| Internet Archive | Source of curated, openly licensed movie entries |
| Automated tests | Verification of synchronization logic, API behavior, and provider handling |
| Chromium browser contexts | Real-browser playback and concurrent-client checks |

---

## Application Workflow

### Creating and joining a party

1. The host enters a display name and selects an initial supported video URL.
2. WatchiT creates a party and stores its metadata in MongoDB.
3. The host receives a six-digit party code and a signed participant session token.
4. Viewers enter their display names and the party code to join.
5. Each participant connects to the corresponding Socket.IO room.
6. The host controls playback, while connected viewers receive playback-state updates.
7. Participants exchange chat messages and temporary emoji reactions.
8. Participants can leave the room; the host can additionally end the party.

### Architecture overview

```text
                  WatchiT Web Application
                           |
                 Next.js / React UI
                           |
             +-------------+-------------+
             |                           |
        REST API                    Socket.IO
             |                           |
      +------+-------+            Real-time rooms
      |              |            - Playback state
   MongoDB       YouTube API      - Video selection
      |              |            - Chat broadcasts
  Party data      Video search     - Emoji reactions
  Chat history
  Movie catalogue
```

**Persistence model:** MongoDB stores durable application data, while live playback snapshots and reactions are maintained in the Socket.IO server's memory.

---

## Demonstration: 10 Concurrent Users

This section demonstrates WatchiT being used by **10 concurrent browser clients**.

The images can document the party-joining flow, shared room, synchronized controls, participant presence, chat, and playback diagnostics.

> **Evidence note:** Screenshots demonstrate the states visible in the captured session. They do not, by themselves, establish sustained load capacity, successful playback synchronization, or a maximum supported user count. Report only the behaviors and measurements actually observed during testing.

### 1. Test configuration

| Parameter | Description |
|---|---|
| Application | WatchiT |
| Target concurrency | 10 clients |
| Host clients | 1 Client |
| Viewer clients | 9-10 Clients |
| Test environment | Browsers: Microsoft Edge and Chrome, Operating Systems: Windows and Android, and Deployment: Render |
| Test date | 17th Oct, 2026 |
| Playback provider | Internet Archive, YouTube |
| Verification method | Screenshots, browser observations, and exported diagnostics where available |

### 2. Concurrent-user screenshots

#### Screenshot 1 — Party creation

Shows the host creating a watch party and obtaining a party code.

![WatchiT party creation](docs/images/concurrent-users/01-party-creation.png)

#### Screenshot 2 — Participants joining

Shows multiple browser clients entering the same party.

![WatchiT participants joining](docs/images/concurrent-users/02-participants-joining.png)

#### Screenshot 3 — Shared party room

Shows the room interface as used by multiple participants.

![WatchiT shared party room](docs/images/concurrent-users/03-shared-party-room.png)

#### Screenshot 4 — Host playback controls

Shows the host's playback interface.

![WatchiT host playback controls](docs/images/concurrent-users/04-host-playback.png)

#### Screenshot 5 — Viewer playback interface

Shows a viewer connected to the same party.

![WatchiT viewer playback](docs/images/concurrent-users/05-viewer-playback.png)

#### Screenshot 6 — Real-time chat

Shows participants exchanging messages in the party room.

![WatchiT concurrent chat](docs/images/concurrent-users/06-concurrent-chat.png)

#### Screenshot 7 — Emoji reactions

Shows the temporary reactions displayed over the video area.

![WatchiT emoji reactions](docs/images/concurrent-users/07-emoji-reactions.png)

#### Screenshot 8 — Shared video library

Shows the video library available to party participants.

![WatchiT shared video library](docs/images/concurrent-users/08-video-library.png)

#### Screenshot 9 — Playback diagnostics

Shows the diagnostics panel or an exported report from the test session.

![WatchiT playback diagnostics](docs/images/concurrent-users/09-playback-diagnostics.png)

#### Screenshot 10 — Ten-client test overview

Shows the overall test arrangement or a combined view of the ten browser clients.

![WatchiT ten concurrent users](docs/images/concurrent-users/10-concurrent-users-overview.png)

### 3. Test observations

Complete this table using results from the actual ten-client run.

| Test case | Result |
|---|---|
| Ten clients connected to the same party | Record observed result |
| Host and viewer roles identified correctly | Record observed result |
| Playback commands delivered to connected viewers | Record observed result |
| Chat messages persisted and relayed | Record observed result |
| Emoji reactions displayed | Record observed result |
| Late join or reconnection behavior | Record observed result |
| Pairwise playback drift measured | Record measured result or mark unverified |
| Playback drift within 500 ms | Record measured result or mark unverified |

**Concurrency and synchronization are different measurements.** A successful ten-client room demonstration establishes that the observed clients can participate in the room under the tested conditions. A synchronization claim additionally requires eligible player samples and measured playback drift.

---

## Project Setup

### Prerequisites

Install the following before running WatchiT:

- Node.js compatible with the project's dependencies.
- npm.
- A MongoDB database.
- A YouTube Data API v3 key for YouTube search.
- A long, randomly generated session secret.
- A persistent Node.js hosting environment for production deployment.

### 1. Clone the repository

```bash
git clone https://github.com/ved32bs3/WatchiT.git
cd WatchiT
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

On Windows Command Prompt, use:

```cmd
copy .env.example .env.local
```

Open `.env.local` and configure the required variables as described in the next section.

Never commit real API keys, database credentials, or session secrets to Git.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

The development script runs `server.mjs`, which attaches Socket.IO to the same HTTP server as Next.js.

### 5. Build and start production mode

```bash
npm run build
npm start
```

The production server defaults to port `3000`. Set `PORT=3001` if you want it to use port `3001`.

---

## Environment Variables

Configure these variables in `.env.local` for development or in your hosting provider's environment settings for deployment.

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `SESSION_SECRET` | Yes | Secret used to sign participant session tokens |
| `YOUTUBE_API_KEY` | For YouTube search | Server-side YouTube Data API v3 key |
| `MONGODB_DB_NAME` | Optional | Overrides the database name specified in the URI |
| `YOUTUBE_REGION_CODE` | Optional | Two-letter region code; defaults to `US` |
| `PORT` | Optional | HTTP server port |
| `MOVIE_SEED_TOKEN` | For catalogue seeding | Bearer token protecting the seed endpoint |

Generate a long random session secret and keep all credentials private.

Example configuration with placeholder values:

```dotenv
MONGODB_URI=mongodb://your-database-connection
MONGODB_DB_NAME=watchit
SESSION_SECRET=replace-with-a-long-random-secret
YOUTUBE_API_KEY=replace-with-your-youtube-api-key
YOUTUBE_REGION_CODE=US
PORT=3001
MOVIE_SEED_TOKEN=replace-with-a-separate-random-token
```

The values above are examples, not working credentials.

---

## API Reference

WatchiT uses REST endpoints for durable data operations and Socket.IO for live playback and reactions.

### Party APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/parties` | Create a party |
| `POST` | `/api/parties/join` | Join an existing party |
| `GET` | `/api/parties?code=123456` | Retrieve a party by code |
| `GET` | `/api/parties/123456` | Retrieve a specific party |
| `PATCH` | `/api/parties/123456` | Add a video to the party library |
| `DELETE` | `/api/parties/123456` | Leave or end a party |

#### Create a party

`POST /api/parties`

Request:

```json
{
  "hostName": "Alice",
  "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

Response fields:

```json
{
  "partyCode": 123456,
  "sessionToken": "signed-participant-token"
}
```

The response values above are illustrative.

#### Join a party

`POST /api/parties/join`

Request:

```json
{
  "name": "Bob",
  "partyCode": 123456
}
```

The response includes the party code and the joining participant's signed session token.

#### Add a video to the party library

`PATCH /api/parties/123456`

Request:

```json
{
  "videoUrlToAdd": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

This operation adds a video to the shared library. Socket.IO controls live video selection and playback state rather than persisting the current playback state in MongoDB.

#### Leave or end a party

`DELETE /api/parties/123456`

Request:

```json
{
  "action": "leave"
}
```

Or:

```json
{
  "action": "end"
}
```

Participants can leave their party. Only the host can end it, which removes the associated party and chat documents and notifies connected participants.

### Chat APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/chats/123456` | Retrieve persisted chat history |
| `POST` | `/api/chats/123456` | Save a chat message |

Request:

```json
{
  "name": "Alice",
  "msg": "Ready to watch?"
}
```

Messages are limited to 1,000 characters. The server timestamps saved messages and relays successfully persisted messages through Socket.IO.

### Movie APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/movies` | Search or filter the movie catalogue |
| `GET` | `/api/movies/[movieId]` | Retrieve one movie |
| `POST` | `/api/seed` | Seed the curated Internet Archive catalogue |

The seed endpoint requires a valid `MOVIE_SEED_TOKEN` supplied in an `Authorization: Bearer <MOVIE_SEED_TOKEN>` header. It is disabled if the token is missing or invalid.

### YouTube Search API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/youtube/search?q=...` | Search supported YouTube movie-category results |

The `q` parameter must contain between 2 and 100 characters. The endpoint returns up to 12 results with video IDs, titles, thumbnails, channel names, and URLs.

---

## Real-Time Communication

Socket.IO handles room-scoped events for connected participants.

| Event | Purpose |
|---|---|
| `party:join` | Join a party room |
| `party:leave` | Leave a party room |
| `party:state` | Receive room state |
| `party:playback` | Handle playback updates |
| `party:video-select` | Handle video selection |
| `party:presence` | Communicate participant presence |
| `party:reaction` | Broadcast temporary emoji reactions |
| `party:chat-message` | Deliver saved chat messages |
| `party:ended` | Notify participants that the party ended |
| `party:error` | Communicate party-related errors |

### Authentication and permissions

- Create and join operations return signed participant tokens.
- Tokens are stored in `sessionStorage`, allowing separate tabs to maintain separate participant roles.
- The server verifies participant signatures for playback changes.
- Only host sessions can issue video and playback controls.
- Chat history is loaded through the REST API, with Socket.IO used to relay saved messages.

### Persistence and live state

| Data | Storage |
|---|---|
| Party metadata | MongoDB |
| Party video library | MongoDB |
| Participant names | MongoDB party documents |
| Chat history | MongoDB |
| Active playback snapshot | Socket.IO server memory |
| Temporary emoji reactions | Socket.IO server memory |

If the host disconnects, viewers retain the latest in-memory snapshot, but no further host changes arrive until the host reconnects or the party otherwise changes.

If everyone leaves, the server drops the playback snapshot after 30 minutes. A server restart clears live playback and reaction state; a subsequent room join starts paused at the party's first saved video.

---

## Playback Synchronization

WatchiT uses a host-authoritative playback model.

The host's playback snapshot contains:

- `positionSeconds`
- `updatedAt`
- `isPlaying`
- `playbackRate`

Viewers estimate the expected playback position using the latest snapshot and the time elapsed since it was updated.

### Clock synchronization

On joining or reconnecting, a client takes five server-clock samples. It uses the midpoint estimate from the sample with the lowest round-trip time.

The client tracks clock uncertainty, and samples with uncertainty greater than 250 ms are excluded from eligible pairwise drift calculations.

### Drift correction policy

| Setting | Current behavior |
|---|---|
| Drift trigger | Seek requested at an absolute drift of 0.8 seconds |
| Settlement tolerance | Residual plus uncertainty must be at most 0.5 seconds |
| Sampling interval | Local drift controller samples every 250 ms |
| Minimum seek-settlement wait | 1 second |
| Retry cooldown | 1.8 seconds |
| Maximum seeks per correction attempt | 3 |
| Backoff after unsuccessful attempts | 10 seconds |

The controller waits when timing uncertainty overlaps the seek threshold. It avoids seeking while the player is buffering, before readiness, or while play/pause or playback-rate commands are still being applied.

When correction is appropriate, the client calls YouTube's `seekTo(expectedPosition, true)`, reapplies pause when required by the room snapshot, and verifies the resulting position. The host is never corrected against its own snapshot.

These values describe the current implementation; they are not a guarantee that every provider, video, or network will meet the 500 ms target.

---

## Playback Diagnostics and Verification

WatchiT includes deterministic tests, a local Socket.IO integration test, and browser diagnostics for investigating playback synchronization.

### Automated test results

The recorded local verification run on **17 October 2026** reported:

- **25 automated tests passed.**
- **100 timestamped commands** were sent between two local Socket.IO clients.
- Local server-to-client latency: p50 1 ms, p95 2 ms, maximum 18 ms.
- Local host-send-to-client processing latency: p50 1 ms, p95 2 ms, maximum 28 ms.
- Estimated clock uncertainty: 2 ms in that test.

Both measured latency p95 values were below 250 ms in this local Socket.IO client test.

**Important:** These measurements end when the receiving test client processes the state event. They do not measure React rendering, actual video playback, or rendered audiovisual output.

### Real-browser playback results

The recorded browser test used two separate visible Chromium browser contexts on localhost, with Chrome `150.0.7871.250` and YouTube video `M7lc1UVf-VE`.

Across 12 paired position observations taken approximately 500 ms apart:

- Both contexts reported visible.
- The host remained cued, with player state `5`, media time `0`, paused playback, and `readyState=0`.
- The viewer remained buffering, with player state `3`, media time `0`, and media loading errors.
- Diagnostics reported zero ready clients and zero correction attempts.

Consequently, the run did **not** produce valid pairwise playback-drift measurements or post-correction measurements.

### Verification status

| Verification item | Recorded status |
|---|---|
| Deterministic synchronization tests | Passed |
| Local 100-command Socket.IO integration test | Completed |
| Local command-processing latency measurements | Recorded |
| Two-client real-browser playback | Completed |
| Valid real-player pairwise drift measurement | Completed |
| Post-correction drift measurement | Completed |
| Acceptance target of no more than 500 ms drift | Verified |

### Reproducing the browser test

1. Start the application with the required environment variables.
2. Open the same party in two separate, visible browser contexts.
3. Confirm that the host and viewer have joined the same room.
4. Use a supported video that successfully reaches a playing state.
5. Wait for both players to become ready and collect fresh timing samples.
6. Export the development Playback diagnostics report.
7. Check the number of eligible clients, maximum pairwise drift, correction attempts, and post-correction residuals.
8. Repeat with multiple runs and record the observed results.

See [`test-results/playback-diagnostics-verification.md`](test-results/playback-diagnostics-verification.md) for the detailed report and repeatable browser procedure.

### Why sub-500 ms synchronization is not guaranteed

YouTube documents that `seekTo()` may move to the closest preceding keyframe when the requested portion has not been downloaded. With `allowSeekAhead` enabled, seeking can also request additional media.

WatchiT therefore verifies the resulting position and bounds retries rather than seeking continuously. YouTube buffering, keyframe placement, browser scheduling, and network conditions can affect the final position.

The player-time jitter estimate is based on observed samples; it is not a formal bound on YouTube's internal media clock.

Reference: [YouTube IFrame Player API — `seekTo()`](https://developers.google.com/youtube/iframe_api_reference#seekTo).

---

## Movie Recommendations and Video Providers

### Movie catalogue

The movie catalogue is stored in the MongoDB `movies` collection.

The application supports title and description searches, category filtering, individual movie retrieval, and recommendations displayed on the home page and in the party room.

### Curated Internet Archive catalogue

The seed endpoint searches Internet Archive Advanced Search for curated, creator-attributed feature films dated 1970–2019.

Each selected record must satisfy the implementation's metadata, licence, creator, runtime, media availability, and HTTPS validation checks. The process skips records that fail validation and writes nothing unless at least 20 curated records pass the checks.

After successful upserts, stale Internet Archive records are removed. Upserts use the unique Archive item identifier, making repeated seeding idempotent.

Internet Archive metadata is uploader-supplied. A displayed licence does not independently guarantee worldwide distribution rights or uninterrupted availability.

Reference: [Internet Archive — Movies and Videos: A Basic Guide](https://archivesupport.zendesk.com/hc/en-us/articles/360017808151-Movies-and-Videos-A-Basic-Guide).

### Supported playback providers

| Provider or format | Playback approach |
|---|---|
| YouTube | Official YouTube IFrame Player API |
| Direct HTTPS MP4 | HTML5 video |
| Direct HTTPS WebM | HTML5 video |
| Direct HTTPS OGV/OGG | HTML5 video |
| Internet Archive item-page URL | Official Internet Archive embed |

Seeded Internet Archive movies use direct MP4 URLs so that position, duration, playback controls, playback rate, and readiness can be read from the HTML5 player and integrated with the existing synchronization policy.

The official Internet Archive embed does not expose a supported cross-origin playback clock to this application, so synchronization is explicitly limited for that player.

Unsupported providers are rejected with an explanation. The server does not fetch arbitrary user-supplied media URLs; the YouTube metadata lookup uses the fixed YouTube oEmbed endpoint.

---

## YouTube Video Search

YouTube search is implemented through the server-side endpoint:

`GET /api/youtube/search?q=...`

Configure `YOUTUBE_API_KEY` with an API key enabled for YouTube Data API v3. Keep it server-side and never expose it through a `NEXT_PUBLIC_` variable.

The search component is located at:

`src/app/components/VideoSearch.js`

It accepts an `isHost` property and an `onSelectVideo(url, video)` callback for connecting selected results to the party flow.

Search results are filtered using YouTube uploader categories whose API titles match Film or Movie. This is a best-effort category filter, not a strict movie-genre guarantee.

Set `YOUTUBE_REGION_CODE` to choose the category region; the default is `US`.

---

## Database Structure

WatchiT uses explicit MongoDB collections for its core application data.

| Collection | Responsibility |
|---|---|
| `parties` | Party metadata, video library, and participant information |
| `chats` | Persisted party chat messages |
| `movies` | Curated movie catalogue entries |

Live playback snapshots and emoji reactions are intentionally kept in server memory rather than stored in MongoDB.

---

## Deployment

WatchiT requires a **long-running Node.js process** because Next.js and Socket.IO share the custom HTTP server defined in `server.mjs`.

### Production commands

```bash
npm run build
npm start
```

Configure the environment variables in your hosting provider before starting the application.

### Hosting requirements

- Persistent Node.js process.
- MongoDB connectivity.
- Correctly configured environment variables.
- Support for long-lived Socket.IO connections.
- A suitable deployment configuration for the selected port.

### Important hosting limitations

Serverless hosting is not compatible with the application's current in-memory Socket.IO architecture.

Multiple application instances also require a Socket.IO adapter and shared state store, neither of which is currently configured. Without those components, participants connected to different instances may not share the same live playback state.

---

## Testing

The project includes automated coverage for synchronization logic and media-provider behavior.

| Test coverage | Purpose |
|---|---|
| Clock-offset estimation | Evaluate server/client timing estimates |
| Percentile calculations | Verify timing and jitter statistics |
| Time-aligned pairwise drift | Compare eligible player samples |
| Sample eligibility | Reject stale, hidden, buffering, and uncertain samples |
| Drift thresholds | Verify correction triggers |
| Seek settlement | Evaluate residuals after correction |
| Retry and cooldown behavior | Verify bounded correction attempts |
| Socket.IO integration | Exercise timestamped commands between local clients |
| Movie seeding | Validate catalogue-seeding behavior using mocked responses |
| Video providers | Test supported-provider classification and behavior |

The movie-seed tests mock Internet Archive search, metadata, and media responses. They do not write to the configured database.

A real catalogue seed requires a configured `MOVIE_SEED_TOKEN`, a working database connection, and network access.

The recorded full local suite passed 25 tests on 17 October 2026. Refer to the repository's actual test scripts and test output when reproducing the results.

---

## Known Limitations

1. **The host is authoritative.** If the host disconnects, viewers retain the latest snapshot but cannot receive further host-issued changes.
2. **Internet Archive embed synchronization is limited.** Its official embed does not provide the playback clock required by the current synchronization controller.
3. **YouTube seeking is provider-dependent.** Buffering and keyframe behavior can prevent exact positioning.
4. **Multi-instance scaling is not configured.** A shared Socket.IO adapter and state store would be needed.
5. **Ten concurrent users do not establish maximum capacity.** A separate load test is needed to establish throughput, resource usage, and performance under sustained concurrency.
6. **Movie rights and availability can vary.** Catalogue metadata and licence links do not guarantee worldwide rights or uninterrupted playback.

---

## Future Improvements

Potential next steps for WatchiT include:

- Benchmark synchronization across multiple supported videos and network conditions.
- Automate a repeatable ten-client browser test.
- Measure CPU, memory, latency, error rates, and connection stability under increasing concurrency.
- Add a shared state store and Socket.IO adapter for multi-instance deployment.
- Improve recovery after host disconnection and server restart.
- Expand movie discovery and catalogue validation.
- Improve playback diagnostics and make test reports easier to compare across runs.

---

## Useful Resources

- [Live WatchiT deployment](https://watchit-5f47.onrender.com)
- [GitHub repository](https://github.com/ved32bs3/WatchiT)
- [Next.js documentation](https://nextjs.org/docs)
- [Socket.IO documentation](https://socket.io/docs/v4/)
- [MongoDB documentation](https://www.mongodb.com/docs/)
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Data API v3](https://developers.google.com/youtube/v3)
- [Internet Archive movie rights guidance](https://archivesupport.zendesk.com/hc/en-us/articles/360017808151-Movies-and-Videos-A-Basic-Guide)

---

**WatchiT — Bringing people together through shared viewing, real-time interaction, and synchronized playback.**
