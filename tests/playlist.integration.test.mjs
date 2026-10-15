import test from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";

const baseUrl = process.env.WATCHIT_TEST_BASE_URL || "http://localhost:3001";
const firstVideo = "https://www.youtube.com/watch?v=M7lc1UVf-VE";
const secondVideo = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";

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
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error("Socket join timed out."));
    }, 10000);
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(error);
    });
    socket.once("connect", async () => {
      try {
        const result = await emitAck(socket, "party:join", { partyCode });
        assert.equal(result.ok, true, result.error);
        clearTimeout(timeout);
        resolve({ socket, result });
      } catch (error) {
        clearTimeout(timeout);
        socket.disconnect();
        reject(error);
      }
    });
  });
}

test("host playlist CRUD/reorder is persistent, versioned, and room-synchronized", { timeout: 90000 }, async () => {
  const create = await callApi("/api/parties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostName: "Playlist Test Host", videoUrl: firstVideo }),
  });
  assert.equal(create.response.status, 201, JSON.stringify(create.body));

  const { partyCode, sessionToken: hostToken } = create.body;
  const join = await callApi("/api/parties/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Playlist Test Viewer", partyCode }),
  });
  assert.equal(join.response.status, 200, JSON.stringify(join.body));

  let hostSocket;
  let viewerSocket;
  try {
    ({ socket: hostSocket } = await connectAndJoin(partyCode, hostToken));
    ({ socket: viewerSocket } = await connectAndJoin(partyCode, join.body.sessionToken));
    const apiPath = `/api/parties/${partyCode}`;
    const patch = (body, token = hostToken) => callApi(apiPath, {
      token,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const syncFromHost = async () => {
      const event = waitFor(viewerSocket, "party:playlist");
      const result = await emitAck(hostSocket, "party:playlist-sync", {});
      assert.equal(result.ok, true, result.error);
      return event;
    };

    const add = await patch({ action: "add", videoUrl: secondVideo, expectedVersion: 0 });
    assert.equal(add.response.status, 200, JSON.stringify(add.body));
    assert.deepEqual(add.body.party.videoUrls, [firstVideo, secondVideo]);
    assert.equal(add.body.party.playlistVersion, 1);
    const addedEvent = syncFromHost();
    const added = await addedEvent;
    assert.deepEqual(added.videoUrls, add.body.party.videoUrls);
    assert.equal(added.playlistVersion, 1);

    const stale = await patch({ action: "add", videoUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0", expectedVersion: 0 });
    assert.equal(stale.response.status, 409);

    const forbidden = await patch({ action: "remove", videoUrl: secondVideo, expectedVersion: 1 }, join.body.sessionToken);
    assert.equal(forbidden.response.status, 403);

    const reorder = await patch({ action: "reorder", videoUrls: [secondVideo, firstVideo], expectedVersion: 1 });
    assert.equal(reorder.response.status, 200, JSON.stringify(reorder.body));
    assert.deepEqual(reorder.body.party.videoUrls, [secondVideo, firstVideo]);
    const reorderedEvent = syncFromHost();
    assert.deepEqual((await reorderedEvent).videoUrls, [secondVideo, firstVideo]);

    const selected = waitFor(viewerSocket, "party:state", (state) => state.videoUrl === secondVideo);
    const selectionAck = await emitAck(hostSocket, "party:video-select", { videoUrl: secondVideo });
    assert.equal(selectionAck.ok, true, selectionAck.error);
    await selected;

    const remove = await patch({ action: "remove", videoUrl: secondVideo, expectedVersion: 2 });
    assert.equal(remove.response.status, 200, JSON.stringify(remove.body));
    const fallbackPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Active-video removal did not broadcast a fallback state.")), 8000);
      const listener = (state) => {
        if (state.videoUrl !== firstVideo || state.isPlaying) return;
        clearTimeout(timeout);
        viewerSocket.off("party:state", listener);
        resolve(state);
      };
      viewerSocket.on("party:state", listener);
    });
    const playlistAndFallback = syncFromHost();
    const update = await playlistAndFallback;
    assert.deepEqual(update.videoUrls, [firstVideo]);
    const fallback = await fallbackPromise;
    assert.equal(fallback.positionSeconds, 0);

    const persisted = await callApi(apiPath, { token: hostToken });
    assert.deepEqual(persisted.body.party.videoUrls, [firstVideo]);
    assert.equal(persisted.body.party.playlistVersion, 3);
  } finally {
    hostSocket?.disconnect();
    viewerSocket?.disconnect();
    await callApi(`/api/parties/${partyCode}`, {
      token: hostToken,
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    }).catch(() => {});
  }
});
