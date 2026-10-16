import test from "node:test";
import assert from "node:assert/strict";
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

    for (let index = 0; index < 100; index += 1) {
      const expectedPosition = 30 + index / 10;
      const received = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          viewer.socket.off("party:state", listener);
          reject(new Error(`Timed out waiting for playback sample ${index}.`));
        }, 5000);
        const listener = (snapshot) => {
          if (snapshot.positionSeconds !== expectedPosition) return;
          clearTimeout(timeout);
          viewer.socket.off("party:state", listener);
          resolve({ snapshot, receivedAt: Date.now() });
        };
        viewer.socket.on("party:state", listener);
      });
      const ack = await emitAck(host.socket, "party:playback", {
        videoUrl,
        isPlaying: index % 2 === 0,
        positionSeconds: expectedPosition,
        playbackRate: [0.75, 1, 1.25, 1.5][index % 4],
      });
      assert.equal(ack.ok, true, ack.error);
      const { snapshot, receivedAt } = await received;
      samples.push(receivedAt - new Date(snapshot.updatedAt).getTime());
    }

    const p95 = percentile(samples, 0.95);
    const median = percentile(samples, 0.5);
    context.diagnostic(`local snapshot propagation: n=${samples.length}, median=${median}ms, p95=${p95}ms, max=${Math.max(...samples)}ms`);
    assert.ok(p95 <= 250, `Expected p95 propagation <=250ms, observed ${p95}ms.`);
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
