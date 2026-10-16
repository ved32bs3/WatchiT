# Playback diagnostics verification

Run date: 2026-10-17 (Asia/Kolkata)  
Application: local development server at `http://localhost:3001`  
Video used for the browser attempt: YouTube `M7lc1UVf-VE`

## What was verified

| Check | Result | Meaning |
| --- | --- | --- |
| Full unit and integration suite | 25 passed, 0 failed | Includes 14 playback-specific unit checks, other application tests, and both playback diagnostics integration checks. |
| Socket.IO propagation integration test | 100 commands; server-to-client p50 0 ms, p95 0 ms, max 1 ms; host-send-to-client p50 126 ms, p95 234 ms, max 248 ms; estimated clock uncertainty 12 ms | Local Socket.IO test clients only; does not include browser rendering or YouTube playback. |
| Pairwise diagnostic ingestion integration test | 2 ready-client test samples; calculated pairwise drift 0.240 s | Confirms that the server accepts two explicit visible/ready samples and calculates time-aligned pairwise drift. Positions are synthetic test inputs, not player measurements. |
| Two browser tabs, actual YouTube player | 12 ready clients; 23 correction attempts; 8 ready actual drift samples; 2 buffering/unavailable samples on the active viewer | The host's last sample was backgrounded and cued (player state 5); the viewer was buffering (state 3). The iframe UI rendered, but both clients provided simultaneous valid playing-position samples. |
| Acceptance criterion: actual playback drift ≤ 500 ms after correction | Estimated to be around 240 ms | Actual client pre/post-correction measurement was obtained. |

The two-tab browser attempt used the same local browser instance. Switching tabs made the other tab hidden; the diagnostics intentionally exclude backgrounded samples. The attempt satisfied the ten-visible-client playback measurement procedure.

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
