"use client";

import { useEffect, useRef, useState } from "react";

let youtubeApiPromise;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        resolve(window.YT);
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }
  return youtubeApiPromise;
}

export default function PartyVideoPlayer({ videoId, videoUrl, isHost, playback, autoplayOnSelection = false, onHostPlaybackChange }) {
  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const callbackRef = useRef(onHostPlaybackChange);
  const [isReady, setIsReady] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);

  useEffect(() => { callbackRef.current = onHostPlaybackChange; }, [onHostPlaybackChange]);

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
            console.log("[WatchiT player]", {
              isHost,
              controls: isHost ? 1 : 0,
              videoId,
            });
            if (cancelled) return;
            const iframe = event.target.getIframe();
            iframe.setAttribute("tabindex", isHost ? "0" : "-1");
            iframe.setAttribute("title", isHost ? "Host video player" : "Party video, controls disabled for viewers");
            if (!isHost) event.target.mute();
            if (isHost && autoplayOnSelection) event.target.playVideo();
            setIsReady(true);
          },
          onStateChange: (event) => {
            if (!isHost || ![0, 1, 2].includes(event.data)) return;
            callbackRef.current?.({
              videoUrl,
              isPlaying: event.data === 1,
              positionSeconds: event.target.getCurrentTime(),
              playbackRate: event.target.getPlaybackRate(),
            });
          },
          onPlaybackRateChange: (event) => {
            if (!isHost) return;
            callbackRef.current?.({
              videoUrl,
              isPlaying: event.target.getPlayerState() === 1,
              positionSeconds: event.target.getCurrentTime(),
              playbackRate: event.data,
            });
          },
          onError: (event) => setPlayerError(`YouTube could not play this video (player error ${event.data}).`),
        },
      });
    }).catch(() => setPlayerError("Could not load the YouTube player. Check your connection and try again."));

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId, videoUrl, isHost, autoplayOnSelection]);

  useEffect(() => {
    if (!isHost || !isReady) return undefined;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (player?.getPlayerState() === 1) {
        callbackRef.current?.({
          videoUrl,
          isPlaying: true,
          positionSeconds: player.getCurrentTime(),
          playbackRate: player.getPlaybackRate(),
        });
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [isHost, isReady, videoUrl]);

  useEffect(() => {
    const player = playerRef.current;
    if (!isReady || !player || !playback) return;

    const elapsed = playback.isPlaying
      ? Math.max(0, (Date.now() - new Date(playback.updatedAt).getTime()) / 1000) * playback.playbackRate
      : 0;
    const expectedPosition = playback.positionSeconds + elapsed;
    const currentPosition = player.getCurrentTime();
    if (Number.isFinite(currentPosition) && Math.abs(currentPosition - expectedPosition) > 1.5) {
      player.seekTo(expectedPosition, true);
    }
    if (player.getPlaybackRate() !== playback.playbackRate) player.setPlaybackRate(playback.playbackRate);
    if (playback.isPlaying && player.getPlayerState() !== 1) player.playVideo();
    if (!playback.isPlaying && player.getPlayerState() !== 2 && player.getPlayerState() !== 5) player.pauseVideo();
  }, [isHost, isReady, videoId, playback]);

  return (
    <section aria-label="Party video player">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/40">
        <div ref={mountRef} className="absolute inset-0 h-full w-full" />
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

if (typeof window !== "undefined") {
  window.onYouTubeIframeAPIReady ??= () => {};
}
