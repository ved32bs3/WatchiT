export const PLAYBACK_SYNC_INTERVAL_MS = 250;
export const DRIFT_SEEK_THRESHOLD_SECONDS = 0.8;
export const POST_SEEK_TOLERANCE_SECONDS = 0.5;
export const SEEK_SETTLE_DELAY_MS = 1000;
export const SEEK_RETRY_COOLDOWN_MS = 1800;
export const MAX_SEEK_ATTEMPTS = 3;
export const FAILED_CORRECTION_COOLDOWN_MS = 10_000;

export function expectedPlaybackPosition(snapshot, nowMs, serverClockOffsetMs = 0) {
  if (!snapshot || !Number.isFinite(snapshot.positionSeconds)) return null;
  if (!snapshot.isPlaying) return snapshot.positionSeconds;
  const updatedAt = new Date(snapshot.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return null;
  const elapsedSeconds = Math.max(0, (nowMs + serverClockOffsetMs - updatedAt) / 1000);
  const rate = Number.isFinite(snapshot.playbackRate) && snapshot.playbackRate > 0 ? snapshot.playbackRate : 1;
  return snapshot.positionSeconds + elapsedSeconds * rate;
}

export function measurePlaybackDrift(snapshot, currentPosition, nowMs, serverClockOffsetMs = 0) {
  if (!Number.isFinite(currentPosition)) return null;
  const expectedPosition = expectedPlaybackPosition(snapshot, nowMs, serverClockOffsetMs);
  if (expectedPosition === null) return null;
  return { expectedPosition, currentPosition, driftSeconds: currentPosition - expectedPosition };
}

export function nearestSupportedPlaybackRate(requestedRate, availableRates) {
  const rates = Array.isArray(availableRates)
    ? availableRates.filter((rate) => Number.isFinite(rate) && rate > 0)
    : [];
  if (!rates.length || rates.includes(requestedRate)) return requestedRate;
  if (requestedRate < 1) {
    return rates.filter((rate) => rate >= requestedRate).sort((left, right) => left - right)[0] ?? Math.max(...rates);
  }
  if (requestedRate > 1) {
    return rates.filter((rate) => rate <= requestedRate).sort((left, right) => right - left)[0] ?? Math.min(...rates);
  }
  return rates.includes(1) ? 1 : rates.reduce((best, rate) => Math.abs(rate - 1) < Math.abs(best - 1) ? rate : best, rates[0]);
}

export function applyPlaybackCorrection(player, decision) {
  if (decision?.action !== "seek" || !Number.isFinite(decision.target)) return false;
  player.seekTo(decision.target, true);
  return true;
}

export class PlaybackDriftPolicy {
  constructor() {
    this.pendingSeek = null;
    this.lastSeekAt = Number.NEGATIVE_INFINITY;
    this.failedUntil = 0;
    this.attempts = 0;
  }

  reset() {
    this.pendingSeek = null;
    this.lastSeekAt = Number.NEGATIVE_INFINITY;
    this.failedUntil = 0;
    this.attempts = 0;
  }

  evaluate({ driftSeconds, expectedPosition, nowMs, isReady, isHost, isBuffering, transportAligned }) {
    if (!isReady) return { action: "wait", reason: "not-ready" };
    if (isHost) return { action: "wait", reason: "host-is-authoritative" };
    if (isBuffering) return { action: "wait", reason: "buffering" };
    if (!transportAligned || !Number.isFinite(driftSeconds) || !Number.isFinite(expectedPosition)) {
      return { action: "wait", reason: "transport-not-settled" };
    }

    const absoluteDrift = Math.abs(driftSeconds);
    if (this.pendingSeek) {
      if (nowMs - this.pendingSeek.startedAt < SEEK_SETTLE_DELAY_MS) {
        return { action: "wait", reason: "seek-settling" };
      }
      if (absoluteDrift <= POST_SEEK_TOLERANCE_SECONDS) {
        this.pendingSeek = null;
        this.attempts = 0;
        return { action: "settled", driftSeconds };
      }
      if (nowMs - this.lastSeekAt < SEEK_RETRY_COOLDOWN_MS) {
        return { action: "wait", reason: "correction-cooldown" };
      }
      if (this.attempts >= MAX_SEEK_ATTEMPTS) {
        this.pendingSeek = null;
        this.attempts = 0;
        this.failedUntil = nowMs + FAILED_CORRECTION_COOLDOWN_MS;
        return { action: "failed", driftSeconds };
      }
      return this.startSeek(expectedPosition, driftSeconds, nowMs);
    }

    if (nowMs < this.failedUntil) return { action: "wait", reason: "failed-correction-cooldown" };
    if (absoluteDrift < DRIFT_SEEK_THRESHOLD_SECONDS) return { action: "aligned", driftSeconds };
    if (nowMs - this.lastSeekAt < SEEK_RETRY_COOLDOWN_MS) {
      return { action: "wait", reason: "correction-cooldown" };
    }
    return this.startSeek(expectedPosition, driftSeconds, nowMs);
  }

  startSeek(expectedPosition, driftSeconds, nowMs) {
    this.attempts += 1;
    this.lastSeekAt = nowMs;
    this.pendingSeek = { startedAt: nowMs, target: expectedPosition };
    return { action: "seek", target: expectedPosition, driftSeconds, attempt: this.attempts };
  }
}
