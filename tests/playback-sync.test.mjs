import test from "node:test";
import assert from "node:assert/strict";
import {
  DRIFT_SEEK_THRESHOLD_SECONDS,
  MAX_SEEK_ATTEMPTS,
  PlaybackDriftPolicy,
  applyPlaybackCorrection,
  expectedPlaybackPosition,
  measurePlaybackDrift,
  nearestSupportedPlaybackRate,
} from "../src/app/lib/playback-sync.mjs";

test("expected position advances by authoritative playback speed and server clock offset", () => {
  const snapshot = { positionSeconds: 20, isPlaying: true, playbackRate: 1.5, updatedAt: 10_000 };
  assert.equal(expectedPlaybackPosition(snapshot, 12_000), 23);
  assert.equal(expectedPlaybackPosition(snapshot, 11_500, 500), 23);
  assert.equal(expectedPlaybackPosition({ ...snapshot, isPlaying: false }, 12_000), 20);
  assert.equal(expectedPlaybackPosition(snapshot, 9_000), 20);
});

test("drift measurement retains sign for early and late clients", () => {
  const snapshot = { positionSeconds: 10, isPlaying: false, playbackRate: 1, updatedAt: 1000 };
  assert.deepEqual(measurePlaybackDrift(snapshot, 9.2, 1000), {
    expectedPosition: 10,
    currentPosition: 9.2,
    driftSeconds: -0.8000000000000007,
  });
  assert.equal(measurePlaybackDrift(snapshot, Number.NaN, 1000), null);
});

test("rate selection uses the closest supported rate toward normal speed", () => {
  assert.equal(nearestSupportedPlaybackRate(0.75, [0.5, 1]), 1);
  assert.equal(nearestSupportedPlaybackRate(0.25, [0.5, 1]), 0.5);
  assert.equal(nearestSupportedPlaybackRate(1.75, [1, 1.5, 2]), 1.5);
  assert.equal(nearestSupportedPlaybackRate(1.25, [1, 1.25, 1.5]), 1.25);
});

test("policy waits for readiness, authoritative host, buffering, and aligned transport", () => {
  const policy = new PlaybackDriftPolicy();
  const common = { driftSeconds: 2, expectedPosition: 20, nowMs: 1000, isReady: true, isHost: false, isBuffering: false, transportAligned: true };
  assert.equal(policy.evaluate({ ...common, isReady: false }).reason, "not-ready");
  assert.equal(policy.evaluate({ ...common, isHost: true }).reason, "host-is-authoritative");
  assert.equal(policy.evaluate({ ...common, isBuffering: true }).reason, "buffering");
  assert.equal(policy.evaluate({ ...common, transportAligned: false }).reason, "transport-not-settled");
  assert.equal(policy.evaluate(common).action, "seek");
});

test("drift below the measured trigger does not seek; meaningful drift does", () => {
  const policy = new PlaybackDriftPolicy();
  const ready = { expectedPosition: 30, nowMs: 5000, isReady: true, isHost: false, isBuffering: false, transportAligned: true };
  assert.equal(policy.evaluate({ ...ready, driftSeconds: DRIFT_SEEK_THRESHOLD_SECONDS - 0.01 }).action, "aligned");
  assert.equal(policy.evaluate({ ...ready, driftSeconds: DRIFT_SEEK_THRESHOLD_SECONDS }).action, "seek");
});

test("seeks have a settle window and cooldown, then retry only when residual drift exceeds tolerance", () => {
  const policy = new PlaybackDriftPolicy();
  const evaluate = (nowMs, driftSeconds) => policy.evaluate({
    driftSeconds,
    expectedPosition: 42,
    nowMs,
    isReady: true,
    isHost: false,
    isBuffering: false,
    transportAligned: true,
  });
  assert.equal(evaluate(1000, 2).action, "seek");
  assert.equal(evaluate(1500, 2).reason, "seek-settling");
  assert.equal(evaluate(2050, 0.4).action, "settled");
  assert.equal(evaluate(2500, 0.79).action, "aligned");
  assert.equal(evaluate(3000, 0.9).action, "seek");
});

test("persistent residual drift is retried a bounded number of times, then backed off", () => {
  const policy = new PlaybackDriftPolicy();
  const evaluate = (nowMs, driftSeconds = 2) => policy.evaluate({
    driftSeconds,
    expectedPosition: 80,
    nowMs,
    isReady: true,
    isHost: false,
    isBuffering: false,
    transportAligned: true,
  });
  assert.equal(evaluate(1000).attempt, 1);
  let time = 1000;
  for (let attempt = 2; attempt <= MAX_SEEK_ATTEMPTS; attempt += 1) {
    time += 1800;
    assert.equal(evaluate(time).attempt, attempt);
  }
  assert.equal(evaluate(time + 1800).action, "failed");
  assert.equal(evaluate(time + 5000).reason, "failed-correction-cooldown");
});

test("YouTube seek API is called once for a correction and settles inside the acceptance tolerance", () => {
  const player = {
    currentTime: 12,
    seekCalls: [],
    seekTo(target, allowSeekAhead) {
      this.seekCalls.push({ target, allowSeekAhead });
      // Fake the iframe player settling 200 ms away from the requested time.
      this.currentTime = target + 0.2;
    },
  };
  const policy = new PlaybackDriftPolicy();
  const common = { expectedPosition: 20, nowMs: 1000, isReady: true, isHost: false, isBuffering: false, transportAligned: true };
  const first = policy.evaluate({ ...common, driftSeconds: -8 });
  assert.equal(applyPlaybackCorrection(player, first), true);
  assert.deepEqual(player.seekCalls, [{ target: 20, allowSeekAhead: true }]);

  const settled = policy.evaluate({ ...common, nowMs: 2100, driftSeconds: 0.2 });
  assert.equal(settled.action, "settled");
  assert.ok(Math.abs(settled.driftSeconds) <= 0.5);
  assert.equal(applyPlaybackCorrection(player, settled), false);
  assert.equal(player.seekCalls.length, 1);
});
