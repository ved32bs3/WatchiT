# Playback diagnostics verification

Run date: 2026-10-17 (Asia/Kolkata)  
Application: local development server at `http://localhost:3001`  
Video used for the browser attempt: YouTube `M7lc1UVf-VE`

## What was verified

| Check | Result | Meaning |
| --- | --- | --- |
| Full unit and integration suite | 25 passed, 0 failed | Includes 14 playback-specific unit checks, other application tests, and both playback diagnostics integration checks. |
| Socket.IO propagation integration test | 100 commands; server-to-client p50 0 ms, p95 0 ms, max 1 ms; host-send-to-client p50 0 ms, p95 1 ms, max 28 ms; estimated clock uncertainty 0 ms | Local Socket.IO test clients only; does not include browser rendering or YouTube playback. |
| Pairwise diagnostic ingestion integration test | 2 ready-client test samples; calculated pairwise drift 0.200 s | Confirms that the server accepts two explicit visible/ready samples and calculates time-aligned pairwise drift. Positions are synthetic test inputs, not player measurements. |
| Two browser tabs, actual YouTube player | No valid pairwise result; 0 ready clients; 0 correction attempts; 0 ready actual drift samples; 18 buffering/unavailable samples on the active viewer | The host's last sample was backgrounded and cued (player state 5); the viewer was buffering (state 3). The iframe UI rendered, but both clients did not provide simultaneous valid playing-position samples. |
| Acceptance criterion: actual playback drift ≤ 500 ms after correction | **Not verified** | No valid actual two-client pre/post-correction measurement was obtained. The observed visual estimate is not counted as a measurement. |

The two-tab browser attempt used the same local browser instance. Switching tabs made the other tab hidden; the diagnostics intentionally exclude backgrounded samples. The browser log also showed YouTube media requests ending with `ERR_ABORTED`. Thus the attempt does not satisfy the two-visible-client playback measurement procedure below.

The browser later reported `ERR_INTERNET_DISCONNECTED` and `ERR_NETWORK_CHANGED` for external requests. This is consistent with the viewer remaining in buffering state, but the report does not infer positions or drift from those errors. The raw structured results for this run are saved in [`playback-diagnostics-2026-10-17.json`](./playback-diagnostics-2026-10-17.json).

## Why the room metric can be unavailable

The server retains the latest iframe sample per diagnostic client ID and compares a pair only when both samples are fresh, visible, ready (YouTube state 1 or 2), on the same video, and within the combined clock/jitter precision limit. The earlier browser evidence had one cued player and one buffering player; the current local two-tab attempt had one backgrounded/cued player and one buffering player. In both cases, there were not two eligible samples, so `insufficient-ready-clients` is the correct result. A locally settled correction is a separate measurement against that client's authoritative playback position; it does not establish room pairwise drift.

The diagnostics now require `visible: true` explicitly. Missing visibility metadata is normalized as not visible and cannot qualify for a pair. Correction summaries also show valid measurement counts; absent samples render as an em dash with a count of zero rather than `0.000 s`.

## Repeatable real-player verification

1. Start the local app with its configured database and open a host party with a playable YouTube video.
2. Join the party from a second independent browser session or a separate visible browser window. Keep both windows visible; background tabs are excluded.
3. Start playback from the host and wait until both YouTube players are playing. Open **Playback diagnostics** on either client and confirm two recent participants show `ready`, player state `1`, and finite uncertainty.
4. Export the diagnostics JSON after at least 10 seconds of stable playback. For a correction trial, cause/reproduce a real correction through normal host control or an existing seek condition, then export after the correction settles.
5. Retain the JSON with this report. A valid run must include a measured pair (`pairwise.status === "measured"`, two ready clients), actual `player-sample` events from both client IDs, and finite pre/post values with nonzero valid-measurement counts. Record sample count, max pairwise pre/post drift, correction time, and failures. Do not substitute test fixtures or server snapshot positions for player samples.

Suggested command checks:

```powershell
node --test tests/playback-sync.test.mjs
node --test tests/playback-sync.integration.test.mjs
```

The second command exercises the Socket.IO diagnostic ingestion contract with synthetic test positions. Only the exported two-browser run can establish actual YouTube playback drift.
