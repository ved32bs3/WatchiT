"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { io } from "socket.io-client";
import { movePlaylistItem } from "@/app/lib/playlist-utils.mjs";
import PartyVideoPlayer from "@/app/components/PartyVideoPlayer";
import PartyChatPanel from "@/app/components/PartyChatPanel";
import PartyPollPanel from "@/app/components/PartyPollPanel";
import PlaybackDiagnosticsPanel from "@/app/components/PlaybackDiagnosticsPanel";
import MovieRecommendations from "@/app/components/MovieRecommendations";
import VideoSearch from "@/app/components/VideoSearch";
import { clearPartySession, partyRequest } from "@/app/lib/partyApi";
import { classifyVideoUrl } from "@/app/lib/video-providers.mjs";
import {
  estimateServerClockOffset,
  getPlaybackDiagnosticClientId,
  recordPlaybackDiagnostic,
} from "@/app/lib/playback-diagnostics.mjs";

const QUICK_REACTIONS = [
  { emoji: "❤️", label: "Love it" },
  { emoji: "😂", label: "Laugh" },
  { emoji: "😮", label: "Surprised" },
  { emoji: "👏", label: "Clap" },
  { emoji: "🔥", label: "Fire" },
];

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The party service is unavailable.");
  return data;
}

function emitAcknowledged(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, payload, (timeoutError, result) => {
      if (timeoutError) reject(new Error("The realtime server did not confirm the playlist update."));
      else if (!result?.ok) reject(new Error(result?.error || "The realtime update failed."));
      else resolve(result);
    });
  });
}

export default function PartyRoom() {
  const { partyCode } = useParams();
  const router = useRouter();
  const code = String(partyCode ?? "");
  const [room, setRoom] = useState(null);
  const [socketPlayback, setSocketPlayback] = useState(null);
  const [roomSocket, setRoomSocket] = useState(null);
  const [liveParticipants, setLiveParticipants] = useState(null);
  const [reactions, setReactions] = useState([]);
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [serverClockUncertaintyMs, setServerClockUncertaintyMs] = useState(Number.POSITIVE_INFINITY);
  const [error, setError] = useState("");
  const [videoError, setVideoError] = useState("");
  const [isChangingVideo, setIsChangingVideo] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);
  const [roomActionError, setRoomActionError] = useState("");
  const [partyEnded, setPartyEnded] = useState(false);
  const [autoplayVideoId, setAutoplayVideoId] = useState("");
  const socketRef = useRef(null);
  const clockSyncRef = useRef({ offsetMs: 0, uncertaintyMs: Number.POSITIVE_INFINITY });
  const reactionTimers = useRef(new Map());
  const lastSocketVideoUrl = useRef("");

  const reportPlaybackDiagnostic = useCallback((event) => {
    if (process.env.NODE_ENV !== "development") return;
    const clientId = getPlaybackDiagnosticClientId();
    const diagnostic = {
      ...event,
      roomId: code,
      eventAtClientMs: Number.isFinite(event.eventAtClientMs) ? event.eventAtClientMs : Date.now(),
      clientId,
      participantId: room?.participant?.participantId ?? null,
      serverClockOffsetMs: Number.isFinite(event.serverClockOffsetMs) ? event.serverClockOffsetMs : clockSyncRef.current.offsetMs,
      clockUncertaintyMs: Number.isFinite(event.clockUncertaintyMs) ? event.clockUncertaintyMs : clockSyncRef.current.uncertaintyMs,
    };
    recordPlaybackDiagnostic(diagnostic);
    if (socketRef.current?.connected) socketRef.current.emit("party:diagnostics", diagnostic);
  }, [code, room?.participant?.participantId]);

  useEffect(() => {
    if (!/^\d{6}$/.test(code)) return undefined;

    const controller = new AbortController();
    async function loadParty() {
      try {
        const response = await partyRequest(code, { cache: "no-store", signal: controller.signal });
        const data = await readJson(response);
        if (controller.signal.aborted) return;
        setRoom(data);
        setError(data.participant ? "" : "This tab has no party session. Return home and create or join this party again.");
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError.message || "Could not load the party.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    loadParty();
    return () => controller.abort();
  }, [code]);

  const participantName = room?.participant?.name;
  const participantRole = room?.participant?.role;

  useEffect(() => {
    if (!participantName || !participantRole) return undefined;

    let cancelled = false;
    let clockSyncTimer = null;
    let clockSyncInFlight = false;

    let token;
    try {
      token = window.sessionStorage.getItem(`watchit:party:${code}`);
    } catch {
      console.warn("This tab cannot access its party session storage.");
      return undefined;
    }
    if (!token) {
      return undefined;
    }

    const socket = io({
      path: "/socket.io",
      auth: { partyCode: code, token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10_000,
    });
    socketRef.current = socket;

    const synchronizeClock = async () => {
      if (clockSyncInFlight || cancelled) return;
      clockSyncInFlight = true;
      const observations = [];
      try {
        for (let index = 0; index < 5; index += 1) {
          if (!socket.connected || cancelled) break;
          const sentAt = Date.now();
          const response = await new Promise((resolve) => {
            socket.timeout(3000).emit("party:clock-sync", {}, (timeoutError, result) => {
              resolve(timeoutError || !Number.isFinite(result?.serverTime) ? null : result);
            });
          });
          const receivedAt = Date.now();
          if (response) observations.push({ sentAt, receivedAt, serverTime: response.serverTime });
        }
        if (cancelled) return;
        const estimate = estimateServerClockOffset(observations);
        if (!estimate) {
          reportPlaybackDiagnostic({ type: "measurement-failure", reason: "server-clock-sync-failed", sampleCount: observations.length });
          return;
        }
        clockSyncRef.current = { offsetMs: estimate.offsetMs, uncertaintyMs: estimate.uncertaintyMs };
        setServerClockOffsetMs(estimate.offsetMs);
        setServerClockUncertaintyMs(estimate.uncertaintyMs);
        reportPlaybackDiagnostic({
          type: "clock-sync",
          offsetMs: estimate.offsetMs,
          uncertaintyMs: estimate.uncertaintyMs,
          roundTripMs: estimate.roundTripMs,
          sampleCount: estimate.sampleCount,
        });
      } finally {
        clockSyncInFlight = false;
      }
    };

    let hasReceivedRoomSnapshot = false;
    const setLiveState = (snapshot) => {
      const videoSource = classifyVideoUrl(snapshot?.videoUrl);
      if (!snapshot || videoSource.error) return;
      const clientReceivedAt = Date.now();
      if (hasReceivedRoomSnapshot && snapshot.commandId && Number.isFinite(snapshot.acceptedAt)) {
        const processingServerTime = clientReceivedAt + clockSyncRef.current.offsetMs;
        reportPlaybackDiagnostic({
          type: "command-processed",
          commandId: snapshot.commandId,
          commandSource: snapshot.commandSource || "unknown",
          acceptedAt: snapshot.acceptedAt,
          processedAtClientMs: clientReceivedAt,
          processedAtServerEstimate: processingServerTime,
          serverToClientMs: processingServerTime - snapshot.acceptedAt,
          endToEndMs: snapshot.commandOriginMeasured && Number.isFinite(snapshot.commandOriginServerTime)
            ? processingServerTime - snapshot.commandOriginServerTime
            : null,
          clockUncertaintyMs: clockSyncRef.current.uncertaintyMs,
          videoId: videoSource.id,
          positionSeconds: snapshot.positionSeconds,
          playerState: null,
        });
      }
      hasReceivedRoomSnapshot = true;
      if (snapshot.videoUrl !== lastSocketVideoUrl.current) {
        lastSocketVideoUrl.current = snapshot.videoUrl;
        setAutoplayVideoId(participantRole === "host" && snapshot.isPlaying ? videoSource.id : "");
      }
      setSocketPlayback({ ...snapshot, clientReceivedAt });
    };

    socket.on("connect", () => {
      hasReceivedRoomSnapshot = false;
      setSocketStatus("connecting");
      setRoomSocket(socket);
      setError("");
      socket.emit("party:join", { partyCode: code }, (result) => {
        if (result?.ok) {
          if (!hasReceivedRoomSnapshot) setLiveState(result.state);
          synchronizeClock();
          if (!clockSyncTimer) clockSyncTimer = window.setInterval(synchronizeClock, 60_000);
          if (result.playlist) {
            setRoom((current) => current ? {
              ...current,
              party: {
                ...current.party,
                videoUrls: result.playlist.videoUrls,
                videoDetails: result.playlist.videoDetails ?? current.party.videoDetails ?? [],
                playlistVersion: result.playlist.playlistVersion,
              },
            } : current);
          }
          setSocketStatus("connected");
        } else {
          setSocketStatus("disconnected");
          if (result?.error) setError(result.error);
        }
      });
    });
    socket.on("disconnect", () => {
      setSocketStatus("disconnected");
      setRoomSocket(null);
    });
    socket.on("connect_error", (connectError) => {
      setSocketStatus("disconnected");
      setError(connectError.message || "Realtime connection failed. Reconnecting...");
    });
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") synchronizeClock();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    socket.on("party:state", setLiveState);
    socket.on("party:playlist", (playlist) => {
      setRoom((current) => current ? {
        ...current,
        party: {
          ...current.party,
          videoUrls: playlist.videoUrls,
          videoDetails: playlist.videoDetails ?? current.party.videoDetails ?? [],
          playlistVersion: playlist.playlistVersion,
        },
      } : current);
    });
    socket.on("party:presence", (presence) => setLiveParticipants(presence.participants ?? []));
    socket.on("party:host-changed", ({ hostName }) => {
      setRoom((current) => current ? {
        ...current,
        party: { ...current.party, hostName },
      } : current);
    });
    socket.on("party:session-updated", ({ sessionToken }) => {
      if (!sessionToken) return;
      try {
        window.sessionStorage.setItem(`watchit:party:${code}`, sessionToken);
        window.location.reload();
      } catch {
        setError("Your role changed, but this tab could not save its updated session. Return home and rejoin.");
      }
    });
    socket.on("party:error", (socketError) => setVideoError(socketError.error || socketError.message || "The realtime request failed."));
    socket.on("party:reaction", (reaction) => {
      const floatingReaction = {
        ...reaction,
        left: `${20 + Math.random() * 60}%`,
        drift: `${Math.round((Math.random() - 0.5) * 100)}px`,
      };
      setReactions((current) => [...current.slice(-7), floatingReaction]);
      const timer = window.setTimeout(() => {
        setReactions((current) => current.filter((item) => item.id !== reaction.id));
        reactionTimers.current.delete(reaction.id);
      }, 2000);
      reactionTimers.current.set(reaction.id, timer);
    });
    socket.on("party:ended", () => {
      setPartyEnded(true);
      clearPartySession(code);
      socket.disconnect();
    });

    const activeReactionTimers = reactionTimers.current;
    return () => {
      cancelled = true;
      if (clockSyncTimer) window.clearInterval(clockSyncTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (socket.connected) socket.emit("party:leave", { partyCode: code });
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      for (const timer of activeReactionTimers.values()) window.clearTimeout(timer);
      activeReactionTimers.clear();
    };
  }, [code, participantName, participantRole, reportPlaybackDiagnostic]);

  const initialVideoUrl = room?.party?.videoUrls?.[0] ?? "";
  const initialPlayback = useMemo(() => ({
    videoUrl: initialVideoUrl,
    isPlaying: false,
    positionSeconds: 0,
    playbackRate: 1,
    updatedAt: 0,
    revision: 0,
  }), [initialVideoUrl]);

  const emitHostPlayback = useCallback((playback) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setVideoError("Realtime connection is offline. Playback will sync after reconnecting.");
      return;
    }
    const command = {
      ...playback,
      commandId: window.crypto.randomUUID(),
      clientSentAt: Date.now(),
      clientClockOffsetMs: clockSyncRef.current.offsetMs,
      commandSource: playback.commandSource || "player-control",
    };
    socket.emit("party:playback", command, (result) => {
      if (!result?.ok) setVideoError(result?.error || "Could not sync host playback.");
    });
  }, []);

  const commitPlaylistChange = useCallback(async (action, fields) => {
    const socket = socketRef.current;
    if (!socket?.connected || socketStatus !== "connected") {
      throw new Error("Wait for the realtime connection before changing the playlist.");
    }
    const response = await partyRequest(code, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        ...fields,
        expectedVersion: room?.party?.playlistVersion ?? 0,
      }),
    });
    const data = await readJson(response);
    setRoom((current) => current ? { ...current, party: data.party } : current);
    const synchronized = await emitAcknowledged(socket, "party:playlist-sync", {
      expectedVersion: data.party.playlistVersion,
    });
    if (synchronized.state) setSocketPlayback(synchronized.state);
    return data.party;
  }, [code, room?.party?.playlistVersion, socketStatus]);

  const chooseActiveVideo = useCallback(async (url, videoDetails) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setVideoError("Wait for the realtime connection before changing the video.");
      return;
    }

    const videoSource = classifyVideoUrl(url);
    if (videoSource.error) {
      setVideoError(videoSource.error);
      return;
    }
    const playableUrl = videoSource.provider === "youtube" ? url.trim() : videoSource.playbackUrl;

    setIsChangingVideo(true);
    setVideoError("");
    try {
      if (!room?.party?.videoUrls?.includes(playableUrl)) {
        await commitPlaylistChange("add", { videoUrl: playableUrl, videoDetails });
      }

      if (!socket.connected) throw new Error("Realtime connection dropped. The video was added to the party list; select it again when reconnected.");
      socket.emit("party:video-select", {
        videoUrl: playableUrl,
        commandId: window.crypto.randomUUID(),
        clientSentAt: Date.now(),
        clientClockOffsetMs: clockSyncRef.current.offsetMs,
        commandSource: "video-select",
      }, (result) => {
        if (!result?.ok) setVideoError(result?.error || "Could not switch the active video.");
        else {
          setSocketPlayback(result.state);
          setAutoplayVideoId(videoSource.id);
        }
      });
    } catch (changeError) {
      setVideoError(changeError.message || "Could not change the active video.");
    } finally {
      setIsChangingVideo(false);
    }
  }, [commitPlaylistChange, room]);

  const addVideoToPlaylist = useCallback(async (url, videoDetails) => {
    if (room?.party?.videoUrls?.includes(url)) {
      setVideoError("That video is already in the playlist.");
      return;
    }
    setIsChangingVideo(true);
    setVideoError("");
    try {
      await commitPlaylistChange("add", { videoUrl: url, videoDetails });
    } catch (changeError) {
      setVideoError(changeError.message || "Could not add the video to the playlist.");
    } finally {
      setIsChangingVideo(false);
    }
  }, [commitPlaylistChange, room?.party?.videoUrls]);

  async function removePlaylistVideo(url) {
    setIsChangingVideo(true);
    setVideoError("");
    try {
      await commitPlaylistChange("remove", { videoUrl: url });
    } catch (changeError) {
      setVideoError(changeError.message || "Could not remove the video.");
    } finally {
      setIsChangingVideo(false);
    }
  }

  async function reorderPlaylist(fromIndex, toIndex) {
    const nextUrls = movePlaylistItem(room?.party?.videoUrls ?? [], fromIndex, toIndex);
    if (!nextUrls) return;
    setIsChangingVideo(true);
    setVideoError("");
    try {
      await commitPlaylistChange("reorder", { videoUrls: nextUrls });
    } catch (changeError) {
      setVideoError(changeError.message || "Could not reorder the playlist.");
    } finally {
      setIsChangingVideo(false);
    }
  }

  function transferHost(participantId, participantDisplayName) {
    if (!window.confirm(`Make ${participantDisplayName} the new host? You will become a viewer.`)) return;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setRoomActionError("Reconnect before transferring host access.");
      return;
    }
    setRoomActionError("");
    socket.emit("party:host-transfer", { participantId }, (result) => {
      if (!result?.ok) setRoomActionError(result?.error || "Could not transfer host access.");
    });
  }

  const sendReaction = useCallback((emoji) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setVideoError("Reconnect to the party before sending a reaction.");
      return;
    }
    socket.emit("party:reaction", { emoji }, (result) => {
      if (!result?.ok) setVideoError(result?.error || "Could not send that reaction.");
    });
  }, []);

  async function exitParty(action) {
    const isEnding = action === "end";
    if (isEnding && !socketRef.current?.connected) {
      setRoomActionError("Reconnect to the party before ending it so everyone can be notified.");
      return;
    }
    const prompt = isEnding
      ? "End this party for everyone? The saved party and chat history will be deleted."
      : "Leave this watch party?";
    if (!window.confirm(prompt)) return;

    setIsLeaving(true);
    setRoomActionError("");
    try {
      const response = await partyRequest(code, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await readJson(response);
      if (isEnding) {
        const notification = await new Promise((resolve, reject) => {
          socketRef.current.timeout(8000).emit("party:end-confirm", { partyCode: code }, (timeoutError, result) => {
            if (timeoutError) reject(new Error("The party ended, but participants could not be notified. Refresh the room to confirm its status."));
            else if (!result?.ok) reject(new Error(result?.error || "Could not notify participants that the party ended."));
            else resolve(result);
          });
        });
        if (!notification.ok) throw new Error("Could not confirm the party end.");
      }
      if (participantRole !== "host" || action === "end") clearPartySession(code);
      router.replace("/");
    } catch (actionError) {
      setRoomActionError(actionError.message || "Could not leave the party.");
      setIsLeaving(false);
    }
  }

  if (!/^\d{6}$/.test(code)) {
    return <RoomMessage title="Invalid party code" message="Party codes must contain six digits." />;
  }
  if (isLoading) return <RoomMessage title="Opening party..." message="Connecting to the party room." />;
  if (partyEnded) return <RoomMessage title="Party ended" message="The host ended this watch party." />;
  if (!room) return <RoomMessage title="Party room unavailable" message={error || "The party could not be loaded."} />;
  if (!room.participant) return <RoomMessage title="Party session not found" message={error || "Return to the home page and join this room with its party code."} />;

  const { party, participant } = room;
  const isHost = participant.role === "host";
  const playback = socketPlayback ?? initialPlayback;
  const videoUrl = playback.videoUrl || party.videoUrls[0] || "";
  const videoSource = classifyVideoUrl(videoUrl);
  const videoId = videoSource.error ? "" : videoSource.id;
  const participants = liveParticipants ?? [
    { name: party.hostName, role: "host" },
    ...party.viewers.map((name) => ({ name, role: "viewer" })),
  ];
  const viewerCount = participants.filter((person) => person.role === "viewer").length;

  return (
    <main className="min-h-screen bg-[#09090b] px-4 py-6 text-white sm:px-7 sm:py-9">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold tracking-tight text-white">
              <Image src="/logo.png" alt="" width={40} height={40} className="size-10 object-contain" />
              <span>Watch<span className="text-rose-400">iT</span></span>
            </Link>
            <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs capitalize text-zinc-400">{isHost ? "Host" : "Viewer"}</span>
          </div>
          <nav aria-label="Party menu" className="flex flex-wrap items-center gap-2 text-sm">
            <Link href="/" className="rounded-lg px-3 py-2 text-zinc-300 hover:bg-white/[0.06]">Home</Link>
            <a href="#watch" className="rounded-lg px-3 py-2 text-zinc-300 hover:bg-white/[0.06]">Watch</a>
            <a href="#participants" className="rounded-lg px-3 py-2 text-zinc-300 hover:bg-white/[0.06]">Viewers <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-xs">{viewerCount}</span></a>
            <a href="#playlist" className="rounded-lg px-3 py-2 text-zinc-300 hover:bg-white/[0.06]">Playlist</a>
            {isHost && <a href="#recommendations" className="rounded-lg px-3 py-2 text-zinc-300 hover:bg-white/[0.06]">Find videos</a>}
            <span className="ml-auto rounded-lg border border-white/10 px-3 py-2 font-mono text-sm tracking-[0.15em] text-white sm:ml-2">{party.partyCode}</span>
            {isHost ? (
              <button type="button" onClick={() => exitParty("end")} disabled={isLeaving} className="rounded-lg border border-rose-400/30 px-3 py-2 text-rose-200 transition hover:bg-rose-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-wait disabled:opacity-50">
                {isLeaving ? "Ending…" : "End party"}
              </button>
            ) : (
              <button type="button" onClick={() => exitParty("leave")} disabled={isLeaving} className="rounded-lg border border-white/10 px-3 py-2 text-zinc-200 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-wait disabled:opacity-50">
                {isLeaving ? "Leaving…" : "Leave party"}
              </button>
            )}
          </nav>
        </header>

        <section className="mb-6 mt-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Hosted by {party.hostName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome, {participant.name}</h1>
          </div>
          <p className="text-sm text-zinc-400">
            {socketStatus !== "connected" ? "Reconnecting..." : !participants.some((person) => person.role === "host")
              ? "Host is disconnected. Playback continues; controls are unavailable until the host reconnects."
              : "Realtime connected"}
          </p>
        </section>
        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</p>}
        {roomActionError && <p role="alert" className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{roomActionError}</p>}

        <section id="watch" className="grid scroll-mt-6 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
          {videoId ? (
            <PartyVideoPlayer
              key={videoId}
              videoId={videoId}
              videoUrl={videoUrl}
              isHost={isHost}
              playback={playback}
              serverClockOffsetMs={serverClockOffsetMs}
              serverClockUncertaintyMs={serverClockUncertaintyMs}
              roomId={code}
              participantId={participant.participantId}
              onDiagnostic={reportPlaybackDiagnostic}
              autoplayOnSelection={autoplayVideoId === videoId}
              onHostPlaybackChange={isHost ? emitHostPlayback : undefined}
            />
          ) : (
            <div className="grid aspect-video place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-zinc-400">No playable video is selected.</div>
          )}
          {videoError && <p role="alert" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{videoError}</p>}
          {isChangingVideo && <p role="status" className="mt-3 text-sm text-zinc-400">Adding and switching video...</p>}
          <div aria-live="polite" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
              {reactions.map((reaction) => (
                <span
                  key={reaction.id}
                  role="img"
                  aria-label={`${reaction.name} reacted ${reaction.emoji}`}
                  className="party-reaction-float absolute bottom-0 select-none text-6xl drop-shadow-[0_4px_14px_rgba(0,0,0,0.65)]"
                  style={{ left: reaction.left, "--reaction-drift": reaction.drift }}
                >
                  {reaction.emoji}
                </span>
            ))}
          </div>
        <section aria-label="Live reactions" className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Send a reaction</h2>
              <p className="mt-1 text-xs text-zinc-500">Reactions appear briefly and are not saved.</p>
            </div>
            <div className="flex gap-2">
              {QUICK_REACTIONS.map(({ emoji, label }) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={label}
                  title={label}
                  disabled={socketStatus !== "connected"}
                  onClick={() => sendReaction(emoji)}
                  className="grid size-11 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-xl transition hover:border-rose-400/40 hover:bg-rose-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </section>
        <PartyPollPanel isHost={isHost} socket={roomSocket} socketStatus={socketStatus} />
          </div>
          <PartyChatPanel
            partyCode={code}
            participantName={participant.name}
            socket={roomSocket}
            socketStatus={socketStatus}
          />
        </section>

        <section id="playlist" className="mt-8 scroll-mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5" aria-labelledby="playlist-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Shared with the room</p>
              <h2 id="playlist-title" className="mt-2 text-xl font-semibold">Party playlist</h2>
              <p className="mt-1 text-sm text-zinc-400">{isHost ? "Add videos from recommendations, then select or reorder them here." : "The host manages the playlist and selects what plays."}</p>
            </div>
            <span className="text-xs text-zinc-500">{party.videoUrls.length} / 50 videos</span>
          </div>
          <ol className="mt-4 space-y-2">
            {party.videoUrls.map((url, index) => {
              const selected = url === videoUrl;
              const itemSource = classifyVideoUrl(url);
              const videoIdForItem = itemSource.provider === "youtube" ? itemSource.providerVideoId : "";
              const details = party.videoDetails?.find((item) => item.url === url);
              const thumbnail = details?.thumbnail || (videoIdForItem ? `https://i.ytimg.com/vi/${videoIdForItem}/hqdefault.jpg` : "");
              return (
                <li key={url} className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3 ${selected ? "border-rose-400/30 bg-rose-400/[0.08]" : "border-white/10 bg-black/10"}`}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] font-mono text-xs text-zinc-400">{index + 1}</span>
                  {thumbnail && <Image src={thumbnail} alt="" width={160} height={90} unoptimized className="aspect-video w-28 rounded-lg object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-white">{details?.title || `YouTube video ${videoIdForItem || ""}`}</p>
                    {details?.channelName && <p className="mt-0.5 truncate text-xs text-zinc-400">{details.channelName}</p>}
                    <p className="mt-0.5 text-xs text-zinc-500">{selected ? "Now playing" : "In playlist"}</p>
                  </div>
                  {isHost && (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => chooseActiveVideo(url)} disabled={isChangingVideo || selected || socketStatus !== "connected"} className="min-h-9 rounded-lg bg-rose-500/15 px-3 text-xs font-medium text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40">Play</button>
                      <button type="button" aria-label={`Move video ${index + 1} up`} onClick={() => reorderPlaylist(index, index - 1)} disabled={index === 0 || isChangingVideo} className="grid size-9 place-items-center rounded-lg border border-white/10 text-white hover:bg-white/[0.06] disabled:opacity-30">↑</button>
                      <button type="button" aria-label={`Move video ${index + 1} down`} onClick={() => reorderPlaylist(index, index + 1)} disabled={index === party.videoUrls.length - 1 || isChangingVideo} className="grid size-9 place-items-center rounded-lg border border-white/10 text-white hover:bg-white/[0.06] disabled:opacity-30">↓</button>
                      <button type="button" aria-label={`Remove video ${index + 1}`} onClick={() => removePlaylistVideo(url)} disabled={party.videoUrls.length <= 1 || isChangingVideo} className="min-h-9 rounded-lg border border-rose-400/20 px-3 text-xs text-rose-200 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-40">Remove</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <section id="participants" className="mt-8 scroll-mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">People watching</h2>
              <p className="mt-1 text-sm text-zinc-400">Updates as participants join or leave.</p>
            </div>
            <span className="rounded-full bg-rose-400/10 px-3 py-1.5 text-sm text-rose-200">{viewerCount} viewers online</span>
          </div>
          <ul className="mt-4 flex flex-wrap gap-2">
            {participants.map((person, index) => (
              <li key={`${person.role}-${person.name}-${index}`} className={`rounded-full border px-3 py-1.5 text-sm ${person.role === "host" ? "border-rose-400/20 bg-rose-400/[0.08] text-rose-100" : "border-white/10 text-zinc-300"}`}>
                {person.name} {person.role === "host" ? <span className="text-xs text-rose-300">Host</span> : isHost && person.participantId && (
                  <button type="button" onClick={() => transferHost(person.participantId, person.name)} className="ml-2 text-xs font-medium text-rose-300 underline underline-offset-2 hover:text-rose-200">Make host</button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {isHost && (
          <section id="recommendations" className="mt-12 scroll-mt-6 border-t border-white/10 pt-9" aria-labelledby="room-recommendations-title">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Host picks</p>
            <h2 id="room-recommendations-title" className="mt-2 text-2xl font-semibold tracking-tight">Browse movie recommendations</h2>
            <p className="mt-2 text-sm text-zinc-400">Pick a video to add it to the party library and switch playback for everyone.</p>
            <div className="mt-6">
              <VideoSearch
                isHost
                onSelectVideo={(url, details) => chooseActiveVideo(url, details)}
                onAddToPlaylist={addVideoToPlaylist}
              />
              <div className="mt-12 border-t border-white/10 pt-9">
                <MovieRecommendations
                  onSelectMovie={(url, details) => chooseActiveVideo(url, details)}
                  onAddToPlaylist={addVideoToPlaylist}
                />
              </div>
            </div>
          </section>
        )}
      </div>
      <PlaybackDiagnosticsPanel roomId={code} participantId={participant.participantId} socket={roomSocket} />
    </main>
  );
}

function RoomMessage({ title, message }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#09090b] px-5 text-white">
      <section className="max-w-lg rounded-2xl border border-white/10 bg-white/[0.035] p-7 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">{message}</p>
        <Link href="/" className="mt-5 inline-block text-sm font-medium text-rose-300 underline underline-offset-4">Back to WatchiT</Link>
      </section>
    </main>
  );
}
