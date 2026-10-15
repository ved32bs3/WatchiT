import test from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";

const baseUrl = process.env.WATCHIT_TEST_BASE_URL || "http://localhost:3001";
const videoUrl = "https://www.youtube.com/watch?v=M7lc1UVf-VE";

function waitFor(socket, event, predicate = () => true, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const listener = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      resolve(value);
    };
    socket.on(event, listener);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, payload, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function callApi(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  return { response, body: await response.json().catch(() => ({})) };
}

function connectAndJoin(partyCode, token) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { auth: { partyCode: String(partyCode), token }, reconnection: false, timeout: 8000 });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error("Socket join timed out."));
    }, 10000);
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(error);
    });
    socket.once("connect", async () => {
      try {
        const result = await emitAck(socket, "party:join", { partyCode });
        assert.equal(result.ok, true, result.error);
        clearTimeout(timer);
        resolve({ socket, result });
      } catch (error) {
        clearTimeout(timer);
        socket.disconnect();
        reject(error);
      }
    });
  });
}

async function joinViewer(partyCode, name) {
  const join = await callApi("/api/parties/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, partyCode }),
  });
  assert.equal(join.response.status, 200, JSON.stringify(join.body));
  return join.body;
}

test("host transfer changes persisted ownership, session roles, and reconnect fallback", { timeout: 90000 }, async () => {
  const create = await callApi("/api/parties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostName: "Transfer Host", videoUrl }),
  });
  assert.equal(create.response.status, 201, JSON.stringify(create.body));
  const { partyCode, sessionToken: originalHostToken } = create.body;
  let cleanupHostToken = originalHostToken;
  const viewer = await joinViewer(partyCode, "New Host");
  const host = await connectAndJoin(partyCode, originalHostToken);
  const viewerRoom = await connectAndJoin(partyCode, viewer.sessionToken);
  const sockets = [host.socket, viewerRoom.socket];
  let fallbackViewer;
  let reconnectedHost;

  try {
    const oldSessionPromise = waitFor(host.socket, "party:session-updated", (value) => value.role === "viewer");
    const newSessionPromise = waitFor(viewerRoom.socket, "party:session-updated", (value) => value.role === "host");
    const hostChanged = waitFor(host.socket, "party:host-changed");
    const transferred = await emitAck(host.socket, "party:host-transfer", { participantId: viewer.participantId });
    assert.equal(transferred.ok, true, transferred.error);
    assert.equal(transferred.hostName, "New Host");
    const oldSession = await oldSessionPromise;
    const newSession = await newSessionPromise;
    cleanupHostToken = newSession.sessionToken;
    assert.ok(oldSession.sessionToken);
    assert.ok(newSession.sessionToken);
    assert.equal((await hostChanged).hostName, "New Host");

    const oldHostState = await callApi(`/api/parties/${partyCode}`, { token: originalHostToken });
    assert.equal(oldHostState.body.participant, null);
    const promotedState = await callApi(`/api/parties/${partyCode}`, { token: newSession.sessionToken });
    assert.equal(promotedState.body.participant.role, "host");
    const formerState = await callApi(`/api/parties/${partyCode}`, { token: oldSession.sessionToken });
    assert.equal(formerState.body.participant.role, "viewer");
    const deniedPatch = await callApi(`/api/parties/${partyCode}`, {
      token: originalHostToken,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", videoUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", expectedVersion: 0 }),
    });
    assert.equal(deniedPatch.response.status, 403);

    const deniedTransfer = await emitAck(host.socket, "party:host-transfer", { participantId: viewer.participantId });
    assert.equal(deniedTransfer.ok, false);
    const hostOnlyPlayback = await emitAck(viewerRoom.socket, "party:playback", {
      videoUrl, isPlaying: true, positionSeconds: 8, playbackRate: 1,
    });
    assert.equal(hostOnlyPlayback.ok, true, hostOnlyPlayback.error);

    viewerRoom.socket.disconnect();
    const late = await joinViewer(partyCode, "Late Guest");
    const lateRoom = await connectAndJoin(partyCode, late.sessionToken);
    fallbackViewer = lateRoom.socket;
    assert.equal(lateRoom.result.state.positionSeconds, 8);
    assert.equal(lateRoom.result.state.isPlaying, true);

    const promotedSocket = viewerRoom.socket;
    const reconnectionToken = newSession.sessionToken;
    // The promoted viewer socket has disconnected; reconnect with its new signed host token.
    reconnectedHost = (await connectAndJoin(partyCode, reconnectionToken)).socket;
    sockets.push(reconnectedHost);
    const resumeEvent = waitFor(fallbackViewer, "party:state", (state) => state.positionSeconds === 10);
    const resume = await emitAck(reconnectedHost, "party:playback", {
      videoUrl, isPlaying: true, positionSeconds: 10, playbackRate: 1,
    });
    assert.equal(resume.ok, true, resume.error);
    await resumeEvent;
    assert.ok(promotedSocket.disconnected);
  } finally {
    for (const socket of [...sockets, fallbackViewer].filter(Boolean)) socket.disconnect();
    await callApi(`/api/parties/${partyCode}`, {
      token: cleanupHostToken,
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    }).catch(() => {});
  }
});
