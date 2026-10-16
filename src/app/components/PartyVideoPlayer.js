"use client";

import { useEffect, useRef, useState } from "react";
import {
  PLAYBACK_SYNC_INTERVAL_MS,
  PlaybackDriftPolicy,
  applyPlaybackCorrection,
  measurePlaybackDrift,
  nearestSupportedPlaybackRate,
} from "@/app/lib/playback-sync.mjs";
import { classifyVideoUrl } from "@/app/lib/video-providers.mjs";
import { createPlayerAdapter } from "@/app/lib/player-adapter.mjs";

let youtubeApiPromise;

function percentileNearestRank(values, fraction = 0.95) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeApiPromise) {
    const pending = new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => reject(new Error("YouTube player API timed out.")), 15_000);
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        window.clearTimeout(timeoutId);
        try {
          previousReady?.();
        } finally {
          resolve(window.YT);
        }
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error("Could not download the YouTube player API."));
        };
        document.head.appendChild(script);
      }
    });
    youtubeApiPromise = pending.catch((error) => {
      youtubeApiPromise = null;
      throw error;
    });
  }
  return youtubeApiPromise;
}

function YouTubePartyVideoPlayer({ videoId, diagnosticVideoId = videoId, videoUrl, isHost, playback, serverClockOffsetMs = 0, serverClockUncertaintyMs = 0, roomId, participantId, onDiagnostic, autoplayOnSelection = false, onHostPlaybackChange }) {
  const mountRef = useRef(null);
  const metricsRef = useRef(null);
  const playerRef = useRef(null);
  const callbackRef = useRef(onHostPlaybackChange);
  const diagnosticCallbackRef = useRef(onDiagnostic);
  const playbackRef = useRef(playback);
  const clockOffsetRef = useRef(0);
  const playerStateRef = useRef(-1);
  const policyRef = useRef(new PlaybackDriftPolicy());
  const lastTransportCommandRef = useRef({ action: "", at: 0, revision: -1 });
  const lastRateCommandRef = useRef(0);
  const correctionCountRef = useRef(0);
  const activeCorrectionIdRef = useRef(null);
  const lastDiagnosticSampleAtRef = useRef(0);
  const previousPlayerSampleRef = useRef(null);
  const playerTimingJitterSamplesRef = useRef([]);
  const [isReady, setIsReady] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);

  useEffect(() => { callbackRef.current = onHostPlaybackChange; }, [onHostPlaybackChange]);
  useEffect(() => { diagnosticCallbackRef.current = onDiagnostic; }, [onDiagnostic]);
  useEffect(() => {
    playbackRef.current = playback;
    clockOffsetRef.current = serverClockOffsetMs;
  }, [playback, serverClockOffsetMs]);

  useEffect(() => {
    let cancelled = false;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !mountRef.current) return;
      playerRef.current = new YT.Player(mountRef.current, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: {
          enablejsapi: 1,
          origin: window.location.origin,
          controls: isHost ? 1 : 0,
          disablekb: isHost ? 0 : 1,
          fs: isHost ? 1 : 0,
          autoplay: isHost ? Number(autoplayOnSelection) : 1,
          mute: isHost ? 0 : 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            if (cancelled) return;
            const iframe = event.target.getIframe();
            iframe.setAttribute("tabindex", isHost ? "0" : "-1");
            iframe.setAttribute("title", isHost ? "Host video player" : "Party video, controls disabled for viewers");
            if (!isHost) event.target.mute();
            if (isHost && autoplayOnSelection) event.target.playVideo();
            playerStateRef.current = event.target.getPlayerState();
            setIsReady(true);
          },
          onStateChange: (event) => {
            if (cancelled) return;
            playerStateRef.current = event.data;
            if (!isHost || ![0, 1, 2].includes(event.data)) return;
            callbackRef.current?.({
              videoUrl,
              isPlaying: event.data === 1,
              positionSeconds: event.target.getCurrentTime(),
              playbackRate: event.target.getPlaybackRate(),
              commandSource: "player-control",
            });
          },
          onPlaybackRateChange: (event) => {
            if (cancelled) return;
            if (!isHost) return;
            callbackRef.current?.({
              videoUrl,
              isPlaying: event.target.getPlayerState() === 1,
              positionSeconds: event.target.getCurrentTime(),
              playbackRate: event.data,
              commandSource: "rate-change",
            });
          },
          onError: (event) => {
            if (cancelled) return;
            setPlayerError(`YouTube could not play this video (player error ${event.data}).`);
            diagnosticCallbackRef.current?.({
              type: "measurement-failure",
              roomId,
              participantId,
              videoId: diagnosticVideoId,
              reason: `youtube-player-error-${event.data}`,
              playerState: playerStateRef.current,
            });
          },
        },
      });
    }).catch((loadError) => {
      if (cancelled) return;
      setPlayerError("Could not load the YouTube player. Check your connection and try again.");
      diagnosticCallbackRef.current?.({
        type: "measurement-failure",
        roomId,
        participantId,
        videoId: diagnosticVideoId,
        reason: loadError?.message || "youtube-api-load-failed",
      });
    });

    return () => {
      cancelled = true;
      const player = playerRef.current;
      playerRef.current = null;
      player?.destroy();
    };
  }, [videoId, diagnosticVideoId, videoUrl, isHost, autoplayOnSelection, participantId, roomId]);

  useEffect(() => {
    if (!isHost || !isReady) return undefined;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      const adapter = createPlayerAdapter(player, "youtube");
      if (adapter?.getNativePlaybackState() === 1) {
        callbackRef.current?.({
          videoUrl,
          isPlaying: true,
          positionSeconds: adapter.getCurrentTime(),
          playbackRate: adapter.getPlaybackRate(),
          commandSource: "heartbeat",
        });
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [isHost, isReady, videoUrl]);

  useEffect(() => {
    if (!isReady) return undefined;

    const timer = window.setInterval(() => {
      const player = playerRef.current;
      const metrics = metricsRef.current;
      const currentPlayback = playbackRef.current;
      const now = Date.now();
      if (!metrics || !currentPlayback) return;
      if (!player) {
        metrics.dataset.syncStatus = "player-unavailable";
        if (process.env.NODE_ENV === "development" && now - lastDiagnosticSampleAtRef.current >= 1000) {
          lastDiagnosticSampleAtRef.current = now;
          diagnosticCallbackRef.current?.({ type: "measurement-failure", roomId, participantId, videoId: diagnosticVideoId, reason: "player-reference-unavailable" });
        }
        return;
      }
      const adapter = createPlayerAdapter(player, "youtube");
      if (!adapter) return;
      let playerState;
      let currentPosition;
      let currentRate;
      try {
        playerState = adapter.getNativePlaybackState();
        currentPosition = adapter.getCurrentTime();
        currentRate = adapter.getPlaybackRate();
      } catch {
        metrics.dataset.syncStatus = "player-unavailable";
        if (process.env.NODE_ENV === "development" && now - lastDiagnosticSampleAtRef.current >= 1000) {
          lastDiagnosticSampleAtRef.current = now;
          diagnosticCallbackRef.current?.({ type: "measurement-failure", roomId, participantId, videoId: diagnosticVideoId, reason: "iframe-player-read-failed" });
        }
        return;
      }
      playerStateRef.current = playerState;
      const measured = measurePlaybackDrift(currentPlayback, currentPosition, now, clockOffsetRef.current);
      if (!measured) return;

      let observedTimingJitterMs = currentPlayback.isPlaying ? null : 0;
      const previousPlayerSample = previousPlayerSampleRef.current;
      if (
        playerState === 1 && previousPlayerSample?.playerState === 1 &&
        Math.abs(currentRate - previousPlayerSample.playbackRate) < 0.01 &&
        previousPlayerSample.correctionCount === correctionCountRef.current &&
        now > previousPlayerSample.at && now - previousPlayerSample.at <= 1000 &&
        !policyRef.current.pendingSeek
      ) {
        const expectedStep = (now - previousPlayerSample.at) / 1000 * previousPlayerSample.playbackRate;
        playerTimingJitterSamplesRef.current.push(Math.abs((currentPosition - previousPlayerSample.position) - expectedStep) * 1000);
        if (playerTimingJitterSamplesRef.current.length > 20) playerTimingJitterSamplesRef.current.shift();
        observedTimingJitterMs = percentileNearestRank(playerTimingJitterSamplesRef.current);
      } else if (playerState !== 1 || (previousPlayerSample && Math.abs(currentRate - previousPlayerSample.playbackRate) >= 0.01)) {
        playerTimingJitterSamplesRef.current = [];
        if (playerState !== 1) observedTimingJitterMs = 0;
      }
      previousPlayerSampleRef.current = {
        at: now,
        position: currentPosition,
        playerState,
        playbackRate: currentRate,
        correctionCount: correctionCountRef.current,
      };

      metrics.dataset.syncCurrent = currentPosition.toFixed(3);
      metrics.dataset.syncExpected = measured.expectedPosition.toFixed(3);
      metrics.dataset.syncDrift = measured.driftSeconds.toFixed(3);
      metrics.dataset.syncPlayerState = String(playerState);
      metrics.dataset.syncObservedJitterMs = Number.isFinite(observedTimingJitterMs) ? observedTimingJitterMs.toFixed(2) : "";
      metrics.dataset.syncPropagationLatencyMs = Number.isFinite(currentPlayback.clientReceivedAt)
        ? String(Math.round(currentPlayback.clientReceivedAt + clockOffsetRef.current - new Date(currentPlayback.updatedAt).getTime()))
        : "";

      if (process.env.NODE_ENV === "development" && now - lastDiagnosticSampleAtRef.current >= 1000) {
        lastDiagnosticSampleAtRef.current = now;
        diagnosticCallbackRef.current?.({
          type: "player-sample",
          roomId,
          participantId,
          videoId: diagnosticVideoId,
          capturedAtClientMs: now,
          positionSeconds: currentPosition,
          playerState,
          isPlaying: playerState === 1,
          playbackRate: currentRate,
          visible: document.visibilityState === "visible",
          status: document.visibilityState !== "visible"
            ? "backgrounded"
            : playerState === 3
              ? "buffering"
              : [1, 2].includes(playerState)
                ? "ready"
                : playerState === 5 ? "cued" : "unavailable",
          driftSeconds: measured.driftSeconds,
          expectedPosition: measured.expectedPosition,
          observedTimingJitterMs,
          serverClockOffsetMs: clockOffsetRef.current,
          clockUncertaintyMs: serverClockUncertaintyMs,
          authoritativeCommandId: currentPlayback.commandId ?? null,
        });
      }

      if (isHost) {
        metrics.dataset.syncStatus = "host-authoritative";
        return;
      }

      const isBuffering = playerState === 3;
      if (isBuffering) {
        metrics.dataset.syncStatus = "buffering";
        policyRef.current.evaluate({
          ...measured,
          nowMs: now,
          isReady,
          isHost,
          isBuffering: true,
          transportAligned: false,
        });
        return;
      }

      const targetRate = Number.isFinite(currentPlayback.playbackRate) ? currentPlayback.playbackRate : 1;
      const availableRates = player.getAvailablePlaybackRates?.() ?? [];
      const effectiveRate = nearestSupportedPlaybackRate(targetRate, availableRates);
      const rateMismatch = Math.abs(effectiveRate - targetRate) > 0.01;
      if (Math.abs(currentRate - effectiveRate) > 0.01) {
        if (now - lastRateCommandRef.current >= 1000) {
          adapter.setPlaybackRate(effectiveRate);
          lastRateCommandRef.current = now;
        }
        metrics.dataset.syncStatus = rateMismatch ? "setting-nearest-playback-rate" : "setting-playback-rate";
        return;
      }

      const pausedStates = [0, 2, 5];
      const transportAligned = currentPlayback.isPlaying
        ? playerState === 1
        : pausedStates.includes(playerState);
      const requestedAction = currentPlayback.isPlaying ? "play" : "pause";
      if (!transportAligned) {
        const lastCommand = lastTransportCommandRef.current;
        if (lastCommand.action !== requestedAction || lastCommand.revision !== currentPlayback.revision || now - lastCommand.at >= 1500) {
          if (currentPlayback.isPlaying) adapter.play();
          else adapter.pause();
          lastTransportCommandRef.current = { action: requestedAction, at: now, revision: currentPlayback.revision };
        }
        metrics.dataset.syncStatus = `setting-${requestedAction}`;
        return;
      }

      const result = policyRef.current.evaluate({
        ...measured,
        nowMs: now,
        isReady,
        isHost,
        isBuffering: false,
        transportAligned,
        measurementUncertaintySeconds: Number.isFinite(observedTimingJitterMs) && Number.isFinite(serverClockUncertaintyMs)
          ? (observedTimingJitterMs + serverClockUncertaintyMs) / 1000
          : Number.POSITIVE_INFINITY,
      });
      metrics.dataset.syncStatus = result.action === "seek"
        ? "correcting"
        : result.action === "settled" || result.action === "aligned"
          ? rateMismatch ? "playback-rate-limited" : "aligned"
          : result.reason || result.action;

      if (result.action === "seek") {
        playerTimingJitterSamplesRef.current = [];
        previousPlayerSampleRef.current = null;
        const correctionId = window.crypto.randomUUID();
        activeCorrectionIdRef.current = correctionId;
        diagnosticCallbackRef.current?.({
          type: "correction-attempt",
          roomId,
          participantId,
          videoId: diagnosticVideoId,
          correctionId,
          commandId: currentPlayback.commandId ?? null,
          attemptedAtClientMs: now,
          driftSeconds: result.driftSeconds,
          expectedPosition: measured.expectedPosition,
          actualPosition: currentPosition,
          targetPosition: result.target,
          attempt: result.attempt,
          playerState,
        });
        try {
          if (applyPlaybackCorrection(adapter, result)) {
            if (!currentPlayback.isPlaying) adapter.pause();
            correctionCountRef.current += 1;
            metrics.dataset.syncCorrectionCount = String(correctionCountRef.current);
            metrics.dataset.syncLastCorrectionDrift = result.driftSeconds.toFixed(3);
          }
        } catch {
          metrics.dataset.syncStatus = "seek-request-failed";
        }
      } else if (result.action === "settled") {
        metrics.dataset.syncLastPostCorrectionDrift = result.driftSeconds.toFixed(3);
        diagnosticCallbackRef.current?.({
          type: "correction-settled",
          roomId,
          participantId,
          videoId: diagnosticVideoId,
          commandId: currentPlayback.commandId ?? null,
          correctionId: activeCorrectionIdRef.current,
          driftSeconds: result.driftSeconds,
          correctionDurationMs: result.correctionDurationMs,
          attempts: result.attempts,
          playerState,
        });
        activeCorrectionIdRef.current = null;
      } else if (result.action === "failed") {
        metrics.dataset.syncLastPostCorrectionDrift = result.driftSeconds.toFixed(3);
        diagnosticCallbackRef.current?.({
          type: "correction-failed",
          roomId,
          participantId,
          videoId: diagnosticVideoId,
          commandId: currentPlayback.commandId ?? null,
          correctionId: activeCorrectionIdRef.current,
          driftSeconds: result.driftSeconds,
          correctionDurationMs: result.correctionDurationMs,
          attempts: result.attempts,
          playerState,
        });
        activeCorrectionIdRef.current = null;
      }
    }, PLAYBACK_SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isHost, isReady, videoId, diagnosticVideoId, participantId, roomId, serverClockUncertaintyMs]);

  return (
    <section aria-label="Party video player">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/40">
        <div
          ref={metricsRef}
          data-sync-role={isHost ? "host" : "viewer"}
          data-sync-status="initializing"
          data-sync-correction-count="0"
          className="absolute inset-0"
          aria-live="off"
        >
          <div ref={mountRef} className="absolute inset-0 h-full w-full" />
        </div>
        {!isHost && <div aria-hidden="true" className="absolute inset-0 z-10 cursor-default" onContextMenu={(event) => event.preventDefault()} />}
        {playerError && <div role="alert" className="absolute inset-x-4 bottom-4 z-20 rounded-xl bg-zinc-950/90 px-4 py-3 text-sm text-rose-200">{playerError}</div>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-xs text-zinc-500">{isHost ? "Host controls playback for everyone." : "Viewer controls are disabled. Playback follows the host."}</p>
        {!isHost && (
          <button
            type="button"
            onClick={() => {
              if (soundEnabled) playerRef.current?.mute();
              else playerRef.current?.unMute();
              setSoundEnabled((enabled) => !enabled);
            }}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            {soundEnabled ? "Mute audio" : "Enable audio"}
          </button>
        )}
      </div>
    </section>
  );
}

function ArchiveEmbedPlayer({ videoSource }) {
  const separator = videoSource.playbackUrl.includes("?") ? "&" : "?";
  return (
    <section aria-label="Party video player">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/40">
        <iframe title="Internet Archive movie player" src={`${videoSource.playbackUrl}${separator}autoplay=1`} className="h-full w-full" allow="autoplay; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
      <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-xs leading-5 text-amber-100/80">The Internet Archive embed does not expose a supported playback clock here. Playback, seek and pause may differ between party members.</p>
    </section>
  );
}

function Html5PartyPlayer({ videoId, videoUrl, isHost, playback, autoplayOnSelection, serverClockOffsetMs, serverClockUncertaintyMs, roomId, participantId, onDiagnostic, onHostPlaybackChange }) {
  const videoRef = useRef(null);
  const metricsRef = useRef(null);
  const playbackRef = useRef(playback);
  const callbackRef = useRef(onHostPlaybackChange);
  const diagnosticRef = useRef(onDiagnostic);
  const policyRef = useRef(new PlaybackDriftPolicy());
  const previousSampleRef = useRef(null);
  const jitterSamplesRef = useRef([]);
  const lastDiagnosticAtRef = useRef(0);
  const correctionCountRef = useRef(0);
  const lastTransportRef = useRef({ action: "", at: 0, revision: -1 });
  const isProgrammaticRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);

  useEffect(() => { playbackRef.current = playback; }, [playback]);
  useEffect(() => { callbackRef.current = onHostPlaybackChange; }, [onHostPlaybackChange]);
  useEffect(() => { diagnosticRef.current = onDiagnostic; }, [onDiagnostic]);
  useEffect(() => () => {
    const player = videoRef.current;
    if (!player) return;
    player.pause();
    player.removeAttribute("src");
    player.load();
  }, []);

  useEffect(() => {
    if (!isHost || !ready) return undefined;
    const timer = window.setInterval(() => {
      const adapter = createPlayerAdapter(videoRef.current, "html5");
      if (!adapter || adapter.getPlaybackState() !== "playing") return;
      callbackRef.current?.({
        videoUrl,
        isPlaying: true,
        positionSeconds: adapter.getCurrentTime(),
        playbackRate: adapter.getPlaybackRate(),
        commandSource: "heartbeat",
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [isHost, ready, videoUrl]);

  function sendHostState(commandSource = "player-control") {
    const player = videoRef.current;
    if (!isHost || !player || isProgrammaticRef.current) return;
    callbackRef.current?.({
      videoUrl,
      isPlaying: !player.paused && !player.ended,
      positionSeconds: Number.isFinite(player.currentTime) ? player.currentTime : 0,
      playbackRate: Number.isFinite(player.playbackRate) ? player.playbackRate : 1,
      commandSource,
    });
  }

  useEffect(() => {
    const player = videoRef.current;
    if (!player || !ready || isHost) return;
    const currentPlayback = playbackRef.current;
    const adapter = createPlayerAdapter(player, "html5");
    if (!adapter) return;
    const measured = measurePlaybackDrift(currentPlayback, adapter.getCurrentTime(), Date.now(), serverClockOffsetMs);
    if (!measured) return;
    isProgrammaticRef.current = true;
    if (Math.abs(adapter.getCurrentTime() - measured.expectedPosition) > 0.8) adapter.seek(measured.expectedPosition);
    if (currentPlayback.isPlaying) {
      adapter.play().catch(() => setError("The browser blocked autoplay. Press play in this viewer to resume synchronized playback."));
    } else {
      adapter.pause();
    }
    const timer = window.setTimeout(() => { isProgrammaticRef.current = false; }, 400);
    return () => window.clearTimeout(timer);
  }, [playback?.revision, ready, isHost, serverClockOffsetMs]);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = window.setInterval(() => {
      const player = videoRef.current;
      const metrics = metricsRef.current;
      const currentPlayback = playbackRef.current;
      if (!player || !metrics || !currentPlayback || !Number.isFinite(player.currentTime)) return;
      const adapter = createPlayerAdapter(player, "html5");
      if (!adapter) return;
      const now = Date.now();
      const position = adapter.getCurrentTime();
      const playerState = adapter.getNativePlaybackState();
      const measured = measurePlaybackDrift(currentPlayback, position, now, serverClockOffsetMs);
      if (!measured) return;
      let observedTimingJitterMs = currentPlayback.isPlaying ? null : 0;
      const previous = previousSampleRef.current;
      if (playerState === 1 && previous?.playerState === 1 && now > previous.at && now - previous.at <= 1000 && !policyRef.current.pendingSeek) {
        const expectedStep = (now - previous.at) / 1000 * previous.playbackRate;
        jitterSamplesRef.current.push(Math.abs((position - previous.position) - expectedStep) * 1000);
        if (jitterSamplesRef.current.length > 20) jitterSamplesRef.current.shift();
        observedTimingJitterMs = percentileNearestRank(jitterSamplesRef.current);
      } else if (playerState !== 1 || (previous && Math.abs(player.playbackRate - previous.playbackRate) >= 0.01)) {
        jitterSamplesRef.current = [];
        if (playerState !== 1) observedTimingJitterMs = 0;
      }
      previousSampleRef.current = { at: now, position, playerState, playbackRate: adapter.getPlaybackRate() };
      metrics.dataset.syncCurrent = position.toFixed(3);
      metrics.dataset.syncExpected = measured.expectedPosition.toFixed(3);
      metrics.dataset.syncDrift = measured.driftSeconds.toFixed(3);
      metrics.dataset.syncPlayerState = String(playerState);

      if (process.env.NODE_ENV === "development" && now - lastDiagnosticAtRef.current >= 1000) {
        lastDiagnosticAtRef.current = now;
        diagnosticRef.current?.({
          type: "player-sample", roomId, participantId, videoId, capturedAtClientMs: now,
          positionSeconds: position, playerState, isPlaying: playerState === 1,
          playbackRate: adapter.getPlaybackRate(), visible: document.visibilityState === "visible",
          status: document.visibilityState !== "visible" ? "backgrounded" : playerState === 3 ? "buffering" : [1, 2].includes(playerState) ? "ready" : "unavailable",
          driftSeconds: measured.driftSeconds, expectedPosition: measured.expectedPosition,
          observedTimingJitterMs, serverClockOffsetMs, clockUncertaintyMs: serverClockUncertaintyMs,
          actualDurationSeconds: Number.isFinite(player.duration) ? player.duration : null,
        });
      }

      if (isHost) { metrics.dataset.syncStatus = "host-authoritative"; return; }
      if (playerState === 3) {
        metrics.dataset.syncStatus = "buffering";
        policyRef.current.evaluate({ ...measured, nowMs: now, isReady: ready, isHost, isBuffering: true, transportAligned: false });
        return;
      }

      const targetRate = Number.isFinite(currentPlayback.playbackRate) ? currentPlayback.playbackRate : 1;
      if (Math.abs(adapter.getPlaybackRate() - targetRate) > 0.01) {
        isProgrammaticRef.current = true;
        adapter.setPlaybackRate(targetRate);
        window.setTimeout(() => { isProgrammaticRef.current = false; }, 100);
        metrics.dataset.syncStatus = "setting-playback-rate";
        return;
      }

      const transportAligned = currentPlayback.isPlaying ? playerState === 1 : playerState === 2;
      if (!transportAligned) {
        const action = currentPlayback.isPlaying ? "play" : "pause";
        const last = lastTransportRef.current;
        if (last.action !== action || last.revision !== currentPlayback.revision || now - last.at >= 1500) {
          isProgrammaticRef.current = true;
          if (action === "play") adapter.play().catch(() => setError("Autoplay was blocked. Enable playback in this viewer to continue."));
          else adapter.pause();
          lastTransportRef.current = { action, at: now, revision: currentPlayback.revision };
          window.setTimeout(() => { isProgrammaticRef.current = false; }, 400);
        }
        metrics.dataset.syncStatus = `setting-${action}`;
        return;
      }

      const result = policyRef.current.evaluate({
        ...measured, nowMs: now, isReady: ready, isHost, isBuffering: false, transportAligned,
        measurementUncertaintySeconds: Number.isFinite(observedTimingJitterMs) && Number.isFinite(serverClockUncertaintyMs)
          ? (observedTimingJitterMs + serverClockUncertaintyMs) / 1000 : Number.POSITIVE_INFINITY,
      });
      metrics.dataset.syncStatus = result.action === "seek" ? "correcting" : result.action === "settled" || result.action === "aligned" ? "aligned" : result.reason || result.action;
      if (result.action === "seek") {
        const correctionId = window.crypto.randomUUID();
        diagnosticRef.current?.({ type: "correction-attempt", roomId, participantId, videoId, correctionId, commandId: currentPlayback.commandId ?? null, attemptedAtClientMs: now, driftSeconds: result.driftSeconds, expectedPosition: measured.expectedPosition, actualPosition: position, targetPosition: result.target, attempt: result.attempt, playerState });
        try {
          applyPlaybackCorrection(adapter, result);
          if (!currentPlayback.isPlaying) adapter.pause();
          correctionCountRef.current += 1;
          metrics.dataset.syncCorrectionCount = String(correctionCountRef.current);
          jitterSamplesRef.current = [];
          previousSampleRef.current = null;
        } catch {
          metrics.dataset.syncStatus = "seek-request-failed";
          diagnosticRef.current?.({ type: "measurement-failure", roomId, participantId, videoId, reason: "html5-seek-failed", correctionId });
        }
      } else if (result.action === "settled" || result.action === "failed") {
        diagnosticRef.current?.({
          type: result.action === "settled" ? "correction-settled" : "correction-failed",
          roomId, participantId, videoId, commandId: currentPlayback.commandId ?? null,
          correctionId: null, driftSeconds: result.driftSeconds, correctionDurationMs: result.correctionDurationMs,
          attempts: result.attempts, playerState,
        });
      }
    }, PLAYBACK_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isHost, ready, videoId, videoUrl, participantId, roomId, serverClockOffsetMs, serverClockUncertaintyMs]);

  const startProgrammaticPlay = (player) => {
    isProgrammaticRef.current = true;
    createPlayerAdapter(player, "html5")?.play().catch(() => setError("Autoplay was blocked. Press play to start this video."));
    window.setTimeout(() => { isProgrammaticRef.current = false; }, 400);
  };

  return (
    <section aria-label="Party video player">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/40">
        <div ref={metricsRef} data-sync-role={isHost ? "host" : "viewer"} data-sync-status="initializing" data-sync-correction-count="0" className="absolute inset-0">
          <video
            key={videoId}
            ref={videoRef}
            src={videoUrl}
            controls={isHost}
            playsInline
            preload="metadata"
            muted={!isHost && !soundEnabled}
            className="h-full w-full bg-black object-contain"
            onLoadedMetadata={(event) => { setReady(true); const current = playbackRef.current; if (current?.isPlaying || autoplayOnSelection) startProgrammaticPlay(event.currentTarget); }}
            onCanPlay={() => setReady(true)}
            onError={() => { setError("This direct video file could not be played by the browser. Try another file or use the source page."); setReady(false); diagnosticRef.current?.({ type: "measurement-failure", roomId, participantId, videoId, reason: "html5-media-error" }); }}
            onPlay={() => sendHostState("player-control")}
            onPause={() => sendHostState("player-control")}
            onSeeked={() => sendHostState("player-control")}
            onRateChange={() => sendHostState("rate-change")}
            onWaiting={(event) => { event.currentTarget.dataset.syncStatus = "buffering"; }}
          />
          {error && <div role="alert" className="absolute inset-x-4 bottom-4 rounded-xl bg-zinc-950/90 px-4 py-3 text-sm text-rose-200">{error}</div>}
        </div>
        {!isHost && <div aria-hidden="true" className="absolute inset-0 z-10 cursor-default" onContextMenu={(event) => event.preventDefault()} />}
      </div>
      <div className="mt-3 flex items-center justify-between gap-4"><p className="text-xs text-zinc-500">{isHost ? "Host controls playback for everyone." : "Viewer controls are disabled. Playback follows the host."}</p>{!isHost && <button type="button" onClick={() => setSoundEnabled((value) => !value)} className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-zinc-200">{soundEnabled ? "Mute audio" : "Enable audio"}</button>}</div>
    </section>
  );
}

export default function PartyVideoPlayer(props) {
  const videoSource = classifyVideoUrl(props.videoUrl);
  if (videoSource.error) {
    return <section aria-label="Party video player" className="grid aspect-video place-items-center rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-rose-200">{videoSource.error}</section>;
  }
  if (videoSource.playerType === "youtube-iframe") {
    return <YouTubePartyVideoPlayer {...props} videoId={videoSource.providerVideoId} diagnosticVideoId={videoSource.id} />;
  }
  if (videoSource.playerType === "internet-archive-embed") return <ArchiveEmbedPlayer videoSource={videoSource} />;
  if (videoSource.playerType === "html5-video") {
    return <Html5PartyPlayer key={videoSource.id} {...props} videoId={videoSource.id} videoUrl={videoSource.playbackUrl} />;
  }
  return <section aria-label="Party video player" role="alert" className="grid aspect-video place-items-center rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-rose-200">This video provider has no supported player.</section>;
}

if (typeof window !== "undefined") {
  window.onYouTubeIframeAPIReady ??= () => {};
}
