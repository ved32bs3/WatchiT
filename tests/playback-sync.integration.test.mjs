import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";

const baseUrl = process.env.WATCHIT_TEST_BASE_URL || "http://localhost:3001";
const videoUrl = "https://www.youtube.com/watch?v=M7lc1UVf-VE";

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, payload, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function callApi(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json().catch(() => ({})) };
}

async function connectAndJoin(partyCode, token) {
  const socket = io(baseUrl, {
    auth: { partyCode: String(partyCode), token },
    reconnection: false,
    timeout: 8000,
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket connection timed out.")), 10_000);
    socket.once("connect", () => { clearTimeout(timeout); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
  });
  const joined = await emitAck(socket, "party:join", { partyCode });
  assert.equal(joined.ok, true, joined.error);
  return { socket, joined };
}

async function synchronizeClock(socket) {
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    const sentAt = Date.now();
    const result = await emitAck(socket, "party:clock-sync", {});
    const receivedAt = Date.now();
    samples.push({ sentAt, receivedAt, serverTime: result.serverTime });
  }
  const best = samples.sort((left, right) => (left.receivedAt - left.sentAt) - (right.receivedAt - right.sentAt))[0];
  return {
    offsetMs: best.serverTime - ((best.sentAt + best.receivedAt) / 2),
    uncertaintyMs: (best.receivedAt - best.sentAt) / 2,
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

test("100 local playback-control snapshots propagate to another Socket.IO client", { timeout: 90_000 }, async (context) => {
  const created = await callApi("/api/parties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostName: "Drift Test Host", videoUrl }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const { partyCode, sessionToken: hostToken } = created.body;
  const joined = await callApi("/api/parties/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Drift Test Viewer", partyCode }),
  });
  assert.equal(joined.response.status, 200, JSON.stringify(joined.body));

  let host;
  let viewer;
  const samples = [];
  try {
    host = await connectAndJoin(partyCode, hostToken);
    viewer = await connectAndJoin(partyCode, joined.body.sessionToken);
    const hostClock = await synchronizeClock(host.socket);
    const viewerClock = await synchronizeClock(viewer.socket);

    for (let index = 0; index < 100; index += 1) {
      const expectedPosition = 30 + index / 10;
      const commandId = randomUUID();
      const received = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          viewer.socket.off("party:state", listener);
          reject(new Error(`Timed out waiting for playback sample ${index}.`));
        }, 5000);
        const listener = (snapshot) => {
          if (snapshot.commandId !== commandId) return;
          clearTimeout(timeout);
          viewer.socket.off("party:state", listener);
          resolve({ snapshot, receivedAt: Date.now() });
        };
        viewer.socket.on("party:state", listener);
      });
      const clientSentAt = Date.now();
      const ack = await emitAck(host.socket, "party:playback", {
        videoUrl,
        isPlaying: index % 2 === 0,
        positionSeconds: expectedPosition,
        playbackRate: [0.75, 1, 1.25, 1.5][index % 4],
        commandId,
        commandSource: "player-control",
        clientSentAt,
        clientClockOffsetMs: hostClock.offsetMs,
      });
      assert.equal(ack.ok, true, ack.error);
      const { snapshot, receivedAt } = await received;
      assert.equal(snapshot.commandOriginMeasured, true);
      samples.push({
        serverToClientMs: receivedAt + viewerClock.offsetMs - snapshot.acceptedAt,
        endToEndMs: receivedAt + viewerClock.offsetMs - snapshot.commandOriginServerTime,
      });
    }

    const serverToClient = samples.map((sample) => sample.serverToClientMs);
    const endToEnd = samples.map((sample) => sample.endToEndMs);
    const deliveryP95 = percentile(serverToClient, 0.95);
    const endToEndP95 = percentile(endToEnd, 0.95);
    context.diagnostic(`local playback propagation: n=${samples.length}, server→client p50=${percentile(serverToClient, 0.5)}ms p95=${deliveryP95}ms max=${Math.max(...serverToClient)}ms; host-send→client p50=${percentile(endToEnd, 0.5)}ms p95=${endToEndP95}ms max=${Math.max(...endToEnd)}ms; clock uncertainty host=${hostClock.uncertaintyMs}ms viewer=${viewerClock.uncertaintyMs}ms`);
    assert.ok(deliveryP95 <= 250, `Expected server-to-client p95 <=250ms, observed ${deliveryP95}ms.`);
    assert.ok(endToEndP95 <= 250, `Expected host-send-to-client p95 <=250ms, observed ${endToEndP95}ms.`);
  } finally {
    host?.socket.disconnect();
    viewer?.socket.disconnect();
    await callApi(`/api/parties/${partyCode}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({ action: "end" }),
    }).catch(() => {});
  }
});

test("room diagnostics form pairwise drift from two ready-client position samples", { timeout: 90_000 }, async (context) => {
  const created = await callApi("/api/parties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostName: "Diagnostics Test Host", videoUrl }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const { partyCode, sessionToken: hostToken } = created.body;
  const joinedResponse = await callApi("/api/parties/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Diagnostics Test Viewer", partyCode }),
  });
  assert.equal(joinedResponse.response.status, 200, JSON.stringify(joinedResponse.body));

  let host;
  let viewer;
  try {
    host = await connectAndJoin(partyCode, hostToken);
    viewer = await connectAndJoin(partyCode, joinedResponse.body.sessionToken);
    const hostClock = await synchronizeClock(host.socket);
    const viewerClock = await synchronizeClock(viewer.socket);
    let resolveMeasured;
    const measured = new Promise((resolve) => { resolveMeasured = resolve; });
    const onDiagnostics = (state) => {
      if (state.pairwise?.status === "measured") resolveMeasured(state);
    };
    host.socket.on("party:diagnostics-state", onDiagnostics);
    viewer.socket.on("party:diagnostics-state", onDiagnostics);
    const sample = (clientId, positionSeconds, clock) => ({
      type: "player-sample",
      clientId,
      videoId: "M7lc1UVf-VE",
      capturedAtClientMs: Date.now(),
      positionSeconds,
      playerState: 1,
      isPlaying: true,
      playbackRate: 1,
      visible: true,
      status: "ready",
      observedTimingJitterMs: 20,
      serverClockOffsetMs: clock.offsetMs,
      clockUncertaintyMs: clock.uncertaintyMs,
    });
    await emitAck(host.socket, "party:diagnostics", sample("diag-host", 40, hostClock));
    await emitAck(viewer.socket, "party:diagnostics", sample("diag-viewer", 40.2, viewerClock));
    let timeoutId;
    const state = await Promise.race([
      measured,
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("Room diagnostic pair did not become measurable.")), 5000); }),
    ]).finally(() => {
      clearTimeout(timeoutId);
      host.socket.off("party:diagnostics-state", onDiagnostics);
      viewer.socket.off("party:diagnostics-state", onDiagnostics);
    });
    assert.equal(state.pairwise.status, "measured");
    assert.equal(state.pairwise.readySampleCount, 2);
    assert.equal(state.pairwise.maxPair.clientIds.length, 2);
    assert.ok(state.pairwise.maxPair.driftSeconds > 0);
    assert.ok(state.pairwise.maxPair.driftSeconds < 0.5);
    context.diagnostic(`diagnostics ingestion contract: ready clients=${state.pairwise.readySampleCount}, measured pairwise drift=${state.pairwise.maxPair.driftSeconds.toFixed(3)}s; test payloads are synthetic and do not measure YouTube playback`);
  } finally {
    host?.socket.disconnect();
    viewer?.socket.disconnect();
    await callApi(`/api/parties/${partyCode}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({ action: "end" }),
    }).catch(() => {});
  }
});
