const MAX_LOCAL_DIAGNOSTIC_EVENTS = 1000;
const LOCAL_DIAGNOSTICS_KEY = "__watchitPlaybackDiagnostics";
const LOCAL_DIAGNOSTIC_CLIENT_ID_KEY = "__watchitPlaybackDiagnosticClientId";
const DIAGNOSTIC_EVENT_NAME = "watchit:playback-diagnostic";

export function estimateServerClockOffset(samples) {
  const valid = (samples ?? [])
    .filter((sample) => Number.isFinite(sample?.sentAt) && Number.isFinite(sample?.receivedAt) && Number.isFinite(sample?.serverTime) && sample.receivedAt >= sample.sentAt)
    .map((sample) => ({ ...sample, roundTripMs: sample.receivedAt - sample.sentAt }))
    .sort((left, right) => left.roundTripMs - right.roundTripMs);
  const best = valid[0];
  if (!best) return null;
  return {
    offsetMs: best.serverTime - ((best.sentAt + best.receivedAt) / 2),
    uncertaintyMs: best.roundTripMs / 2,
    roundTripMs: best.roundTripMs,
    sampleCount: valid.length,
  };
}

export function summarizeLatencies(values) {
  const sorted = (values ?? []).filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  if (!sorted.length) return { sampleCount: 0, p50Ms: null, p95Ms: null, maxMs: null };
  const percentile = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    sampleCount: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

export function normalizeActualPlayerSample(sample, serverReceivedAt) {
  if (
    !sample ||
    typeof sample.clientId !== "string" ||
    typeof sample.videoId !== "string" ||
    !Number.isFinite(sample.positionSeconds) || sample.positionSeconds < 0 ||
    !Number.isFinite(sample.capturedAtClientMs) ||
    !Number.isFinite(sample.serverClockOffsetMs) ||
    !Number.isFinite(serverReceivedAt)
  ) return null;

  const rate = Number.isFinite(sample.playbackRate) && sample.playbackRate > 0 ? sample.playbackRate : 1;
  const capturedAtServerMs = sample.capturedAtClientMs + sample.serverClockOffsetMs;
  const ageAtReceiptMs = serverReceivedAt - capturedAtServerMs;
  if (ageAtReceiptMs < -1000 || ageAtReceiptMs > 10_000) return null;
  const positionAtReceipt = sample.positionSeconds + (sample.isPlaying ? Math.max(0, ageAtReceiptMs) / 1000 * rate : 0);

  return {
    clientId: sample.clientId,
    participantId: sample.participantId,
    videoId: sample.videoId,
    positionSeconds: positionAtReceipt,
    isPlaying: Boolean(sample.isPlaying),
    playbackRate: rate,
    playerState: sample.playerState,
    status: sample.status,
    // Visibility is part of the measurement contract. Missing visibility
    // metadata must not silently turn an incomplete sample into valid data.
    visible: sample.visible === true,
    capturedAtServerMs,
    serverReceivedAt,
    ageAtReceiptMs,
    clockUncertaintyMs: Number.isFinite(sample.clockUncertaintyMs) ? Math.max(0, sample.clockUncertaintyMs) : Infinity,
    observedTimingJitterMs: sample.isPlaying
      ? Number.isFinite(sample.observedTimingJitterMs) ? Math.max(0, sample.observedTimingJitterMs) : Infinity
      : 0,
    driftSeconds: Number.isFinite(sample.driftSeconds) ? sample.driftSeconds : null,
    authoritativeCommandId: typeof sample.authoritativeCommandId === "string" ? sample.authoritativeCommandId : null,
  };
}

export function calculateMaximumPairwiseDrift(samples, serverNowMs, {
  staleAfterMs = 2500,
  maxClockUncertaintyMs = 250,
} = {}) {
  const candidates = (samples ?? []).filter((sample) => {
    const supportedState = [1, 2].includes(sample.playerState);
    return sample.visible && supportedState && sample.status === "ready" &&
      Number.isFinite(sample.serverReceivedAt) && serverNowMs - sample.serverReceivedAt <= staleAfterMs;
  });
  const ready = candidates.filter((sample) =>
    sample.clockUncertaintyMs + sample.observedTimingJitterMs <= maxClockUncertaintyMs,
  );

  let maxPair = null;
  let matchingPairCount = 0;
  for (let leftIndex = 0; leftIndex < ready.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ready.length; rightIndex += 1) {
      const left = ready[leftIndex];
      const right = ready[rightIndex];
      if (left.clientId === right.clientId || left.videoId !== right.videoId) continue;
      matchingPairCount += 1;
      const timingUncertaintyMs = Math.max(
        left.clockUncertaintyMs + left.observedTimingJitterMs,
        right.clockUncertaintyMs + right.observedTimingJitterMs,
      );
      if (timingUncertaintyMs > maxClockUncertaintyMs) continue;
      const leftPosition = left.positionSeconds + (left.isPlaying ? Math.max(0, serverNowMs - left.serverReceivedAt) / 1000 * left.playbackRate : 0);
      const rightPosition = right.positionSeconds + (right.isPlaying ? Math.max(0, serverNowMs - right.serverReceivedAt) / 1000 * right.playbackRate : 0);
      const driftSeconds = Math.abs(leftPosition - rightPosition);
      if (!maxPair || driftSeconds > maxPair.driftSeconds) {
        maxPair = {
          clientIds: [left.clientId, right.clientId],
          participantIds: [left.participantId ?? null, right.participantId ?? null],
          positionsAtServerTime: [leftPosition, rightPosition],
          driftSeconds,
          timingUncertaintyMs,
        };
      }
    }
  }

  return {
    status: maxPair
      ? "measured"
      : candidates.length < 2
        ? "insufficient-ready-clients"
        : ready.length < 2
          ? "insufficient-timing-precision"
          : matchingPairCount ? "insufficient-timing-precision" : "insufficient-matching-video-samples",
    readySampleCount: ready.length,
    candidateSampleCount: candidates.length,
    timingPrecisionRejectedCount: candidates.length - ready.length,
    maxPair,
  };
}

export function recordPlaybackDiagnostic(event) {
  if (typeof window === "undefined" || !event || process.env.NODE_ENV !== "development") return;
  const store = window[LOCAL_DIAGNOSTICS_KEY] ?? (window[LOCAL_DIAGNOSTICS_KEY] = []);
  store.push({ ...event, recordedAtClientMs: Date.now() });
  if (store.length > MAX_LOCAL_DIAGNOSTIC_EVENTS) store.splice(0, store.length - MAX_LOCAL_DIAGNOSTIC_EVENTS);
  window.dispatchEvent(new CustomEvent(DIAGNOSTIC_EVENT_NAME, { detail: store[store.length - 1] }));
}

export function getPlaybackDiagnostics() {
  if (typeof window === "undefined") return [];
  return [...(window[LOCAL_DIAGNOSTICS_KEY] ?? [])];
}

export function getPlaybackDiagnosticClientId() {
  if (typeof window === "undefined") return null;
  window[LOCAL_DIAGNOSTIC_CLIENT_ID_KEY] ??= window.crypto.randomUUID();
  return window[LOCAL_DIAGNOSTIC_CLIENT_ID_KEY];
}

export const PLAYBACK_DIAGNOSTIC_EVENT_NAME = DIAGNOSTIC_EVENT_NAME;
