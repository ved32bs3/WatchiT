import { randomUUID } from "node:crypto";
import connectDb from "../app/lib/db.js";
import Party from "../app/models/party/Party.js";
import Chat from "../app/models/chat/Chat.js";
import { createParticipantSession, isActivePartyParticipant, verifyParticipantToken } from "../app/lib/participant-session.js";
import { normalizePollInput } from "../app/lib/poll-utils.mjs";

const REACTIONS = new Set(["❤️", "😂", "😮", "👏", "🔥"]);
const PLAYBACK_RATES = new Set([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
const snapshots = new Map();
const cleanupTimers = new Map();
const activeHostIds = new Map();
const hostTransfersInProgress = new Set();
const activePolls = new Map();

function roomName(partyCode) {
  return `watch-party:${partyCode}`;
}

function hostIdentity(participant, code) {
  return participant.participantId ?? `legacy-host:${code}`;
}

function isCurrentHost(socket, code) {
  return socket.data.participant.role === "host" &&
    !hostTransfersInProgress.has(code) &&
    activeHostIds.get(code) === hostIdentity(socket.data.participant, code);
}

function publicPoll(poll, myVote = null) {
  if (!poll) return null;
  return {
    id: poll.id,
    title: poll.title,
    options: poll.options.map(({ id, text, votes }) => ({ id, text, votes })),
    voteCount: poll.votes.size,
    isOpen: poll.isOpen,
    createdAt: poll.createdAt,
    closedAt: poll.closedAt,
    revision: poll.revision,
    myVote,
  };
}

function isValidYouTubeUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    const videoId = host === "youtu.be"
      ? parts[0]
      : ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)
        ? url.searchParams.get("v") || (["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : "")
        : "";
    return /^[A-Za-z0-9_-]{11}$/.test(videoId ?? "");
  } catch {
    return false;
  }
}

function reject(socket, acknowledge, message) {
  const response = { ok: false, error: message };
  if (typeof acknowledge === "function") acknowledge(response);
  socket.emit("party:error", response);
}

function makePresence(participants) {
  const unique = new Map();
  for (const participant of participants) {
    const key = participant.participantId || `${participant.role}:${participant.name}`;
    unique.set(key, participant);
  }
  return [...unique.values()];
}

async function broadcastPresence(io, code) {
  const room = roomName(code);
  const roomSockets = await io.in(room).fetchSockets();
  const participants = makePresence(
    roomSockets
      .filter((client) => client.data.joinedRoom === room)
      .map((client) => client.data.participant),
  );
  io.to(room).emit("party:presence", {
    participants,
    viewerCount: participants.filter((participant) => participant.role === "viewer").length,
  });
}

async function getOrCreateSnapshot(code) {
  await connectDb();
  const party = await Party.findOne({ party_code: Number(code) }).select({ video_urls: 1, playlist_version: 1 }).lean();
  if (!party) return null;

  let snapshot = snapshots.get(code);
  if (!snapshot) {
    snapshot = {
      videoUrl: party.video_urls?.[0] ?? "",
      isPlaying: false,
      positionSeconds: 0,
      playbackRate: 1,
      updatedAt: Date.now(),
      revision: 0,
    };
    snapshots.set(code, snapshot);
  }
  return {
    snapshot,
    playlist: { videoUrls: party.video_urls ?? [], playlistVersion: party.playlist_version ?? 0 },
  };
}

function cancelRoomCleanup(code) {
  const timer = cleanupTimers.get(code);
  if (timer) clearTimeout(timer);
  cleanupTimers.delete(code);
}

function scheduleRoomCleanup(io, code) {
  cancelRoomCleanup(code);
  const timer = setTimeout(() => {
    if ((io.sockets.adapter.rooms.get(roomName(code))?.size ?? 0) === 0) {
      snapshots.delete(code);
      activePolls.delete(code);
    }
    cleanupTimers.delete(code);
  }, EMPTY_ROOM_TTL_MS);
  timer.unref?.();
  cleanupTimers.set(code, timer);
}

function endWatchPartyRoom(io, partyCode) {
  const code = String(partyCode);
  if (!/^\d{6}$/.test(code)) return;
  const room = roomName(code);
  cancelRoomCleanup(code);
  snapshots.delete(code);
  activePolls.delete(code);
  io.to(room).emit("party:ended", { partyCode: Number(code) });
}

export function attachWatchPartySockets(io) {
  io.use(async (socket, next) => {
    const partyCode = String(socket.handshake.auth?.partyCode ?? "");
    const participant = verifyParticipantToken(socket.handshake.auth?.token, partyCode);
    if (!/^\d{6}$/.test(partyCode) || !participant) {
      next(new Error("A valid party session is required."));
      return;
    }
    try {
      await connectDb();
      const party = await Party.findOne({ party_code: Number(partyCode) })
        .select({ host_name: 1, host_session_id: 1, viewers: 1, viewer_sessions: 1 }).lean();
      if (!isActivePartyParticipant(party, participant)) {
        next(new Error("This participant session is no longer active."));
        return;
      }
      const ownerId = party.host_session_id ?? `legacy-host:${partyCode}`;
      activeHostIds.set(partyCode, ownerId);
      socket.data.partyCode = partyCode;
      socket.data.participant = participant;
      socket.data.activeHostId = ownerId;
      next();
    } catch (error) {
      console.error("Socket participant verification failed:", error.message);
      next(new Error("Could not verify this party session."));
    }
  });

  io.on("connection", (socket) => {
    const code = socket.data.partyCode;
    const room = roomName(code);

    socket.on("party:join", async (payload, acknowledge) => {
      if (String(payload?.partyCode ?? "") !== code) {
        reject(socket, acknowledge, "You can only join the room in your signed party session.");
        return;
      }
      try {
        if (!activeHostIds.has(code)) activeHostIds.set(code, socket.data.activeHostId);
        const roomState = await getOrCreateSnapshot(code);
        if (!roomState) {
          reject(socket, acknowledge, "Party not found.");
          return;
        }
        cancelRoomCleanup(code);
        await socket.join(room);
        socket.data.joinedRoom = room;
        socket.emit("party:state", roomState.snapshot);
        socket.emit("party:playlist", roomState.playlist);
        const poll = activePolls.get(code);
        if (poll) {
          const participantId = socket.data.participant.participantId ?? `${socket.data.participant.role}:${socket.data.participant.name}`;
          socket.emit("party:poll-state", publicPoll(poll, poll.votes.get(participantId) ?? null));
        }
        await broadcastPresence(io, code);
        if (typeof acknowledge === "function") acknowledge({ ok: true, state: roomState.snapshot, playlist: roomState.playlist });
      } catch (error) {
        console.error("Socket party join failed:", error.message);
        reject(socket, acknowledge, "Could not load this party's live state.");
      }
    });

    socket.on("party:leave", async (payload, acknowledge) => {
      if (String(payload?.partyCode ?? "") !== code || socket.data.joinedRoom !== room) return;
      await socket.leave(room);
      socket.data.joinedRoom = null;
      await broadcastPresence(io, code);
      scheduleRoomCleanup(io, code);
      if (typeof acknowledge === "function") acknowledge({ ok: true });
    });

    socket.on("party:video-select", async (payload, acknowledge) => {
      if (!isCurrentHost(socket, code) || socket.data.joinedRoom !== room) {
        reject(socket, acknowledge, "Only the host in this party can change the video.");
        return;
      }
      if (!isValidYouTubeUrl(payload?.videoUrl)) {
        reject(socket, acknowledge, "Choose a valid YouTube video URL.");
        return;
      }
      try {
        await connectDb();
        const isInPartyLibrary = await Party.exists({
          party_code: Number(code),
          video_urls: payload.videoUrl,
        });
        if (!isInPartyLibrary) {
          reject(socket, acknowledge, "Add this video to the party library before selecting it.");
          return;
        }
      } catch (error) {
        console.error("Socket video selection validation failed:", error.message);
        reject(socket, acknowledge, "Could not validate this video against the party library.");
        return;
      }
      const previous = snapshots.get(code);
      if (!previous) {
        reject(socket, acknowledge, "The party live state is not ready yet.");
        return;
      }
      const snapshot = {
        videoUrl: payload.videoUrl,
        isPlaying: true,
        positionSeconds: 0,
        playbackRate: 1,
        updatedAt: Date.now(),
        revision: previous.revision + 1,
      };
      snapshots.set(code, snapshot);
      io.to(room).emit("party:state", snapshot);
      if (typeof acknowledge === "function") acknowledge({ ok: true, state: snapshot });
    });

    socket.on("party:playlist-sync", async (payload, acknowledge) => {
      if (!isCurrentHost(socket, code) || socket.data.joinedRoom !== room) {
        reject(socket, acknowledge, "Only the host in this party can update the shared playlist.");
        return;
      }
      try {
        await connectDb();
        const party = await Party.findOne({ party_code: Number(code) })
          .select({ video_urls: 1, playlist_version: 1 }).lean();
        if (!party) {
          reject(socket, acknowledge, "Party not found.");
          return;
        }
        const playlist = { videoUrls: party.video_urls ?? [], playlistVersion: party.playlist_version ?? 0 };
        io.to(room).emit("party:playlist", playlist);

        const current = snapshots.get(code);
        let state = current;
        if (current && !playlist.videoUrls.includes(current.videoUrl)) {
          state = {
            ...current,
            videoUrl: playlist.videoUrls[0] ?? "",
            isPlaying: false,
            positionSeconds: 0,
            playbackRate: 1,
            updatedAt: Date.now(),
            revision: current.revision + 1,
          };
          snapshots.set(code, state);
          io.to(room).emit("party:state", state);
        }
        if (typeof acknowledge === "function") acknowledge({ ok: true, playlist, state });
      } catch (error) {
        console.error("Party playlist sync failed:", error.message);
        reject(socket, acknowledge, "Could not sync the shared playlist.");
      }
    });

    socket.on("party:playback", (payload, acknowledge) => {
      if (!isCurrentHost(socket, code) || socket.data.joinedRoom !== room) {
        reject(socket, acknowledge, "Only the host in this party can control playback.");
        return;
      }
      const previous = snapshots.get(code);
      if (
        !previous ||
        payload?.videoUrl !== previous.videoUrl ||
        typeof payload.isPlaying !== "boolean" ||
        typeof payload.positionSeconds !== "number" ||
        !Number.isFinite(payload.positionSeconds) ||
        payload.positionSeconds < 0 || payload.positionSeconds > 86_400 ||
        !PLAYBACK_RATES.has(payload.playbackRate)
      ) {
        reject(socket, acknowledge, "Playback update is invalid or belongs to an older video.");
        return;
      }
      const snapshot = {
        videoUrl: previous.videoUrl,
        isPlaying: payload.isPlaying,
        positionSeconds: payload.positionSeconds,
        playbackRate: payload.playbackRate,
        updatedAt: Date.now(),
        revision: previous.revision + 1,
      };
      snapshots.set(code, snapshot);
      io.to(room).emit("party:state", snapshot);
      if (typeof acknowledge === "function") acknowledge({ ok: true, state: snapshot });
    });

    socket.on("party:reaction", (payload, acknowledge) => {
      if (socket.data.joinedRoom !== room || !REACTIONS.has(payload?.emoji)) {
        reject(socket, acknowledge, "That reaction is not available in this party.");
        return;
      }
      const reaction = {
        id: randomUUID(),
        emoji: payload.emoji,
        name: socket.data.participant.name,
        createdAt: Date.now(),
      };
      io.to(room).emit("party:reaction", reaction);
      if (typeof acknowledge === "function") acknowledge({ ok: true });
    });

    socket.on("party:end-confirm", (payload, acknowledge) => {
      if (!isCurrentHost(socket, code) || socket.data.joinedRoom !== room) {
        reject(socket, acknowledge, "Only the host in this party can end it.");
        return;
      }
      if (String(payload?.partyCode ?? "") !== code) {
        reject(socket, acknowledge, "The party code does not match this host session.");
        return;
      }

      const participantCount = io.sockets.adapter.rooms.get(room)?.size ?? 0;
      endWatchPartyRoom(io, code);
      if (typeof acknowledge === "function") acknowledge({ ok: true, participantCount });
    });

    socket.on("party:host-transfer", async (payload, acknowledge) => {
      if (!isCurrentHost(socket, code) || socket.data.joinedRoom !== room) {
        reject(socket, acknowledge, "Only the active host in this party can transfer host access.");
        return;
      }
      const targetId = typeof payload?.participantId === "string" ? payload.participantId : "";
      if (!targetId || targetId === socket.data.participant.participantId) {
        reject(socket, acknowledge, "Choose a different connected viewer to become host.");
        return;
      }
      if (hostTransfersInProgress.has(code)) {
        reject(socket, acknowledge, "A host transfer is already in progress.");
        return;
      }
      hostTransfersInProgress.add(code);
      try {
        await connectDb();
        const party = await Party.findOne({ party_code: Number(code) })
          .select({ host_name: 1, host_session_id: 1, viewers: 1, viewer_sessions: 1 }).lean();
        if (!party || !isActivePartyParticipant(party, socket.data.participant)) {
          reject(socket, acknowledge, "This host session is no longer active.");
          return;
        }
        const target = (party.viewer_sessions ?? []).find((viewer) => viewer.participant_id === targetId);
        if (!target) {
          reject(socket, acknowledge, "That viewer is no longer in the party.");
          return;
        }

        const roomSocketIds = io.sockets.adapter.rooms.get(room) ?? new Set();
        const localSockets = [...roomSocketIds]
          .map((id) => io.sockets.sockets.get(id))
          .filter(Boolean);
        const targetSockets = localSockets.filter((client) => client.data.participant.participantId === targetId);
        if (!targetSockets.length) {
          reject(socket, acknowledge, "The selected viewer is not connected right now.");
          return;
        }

        const previousHost = socket.data.participant;
        const previousHostId = previousHost.participantId ?? randomUUID();
        const nextViewerSessions = (party.viewer_sessions ?? [])
          .filter((viewer) => viewer.participant_id !== targetId)
          .filter((viewer) => viewer.participant_id !== previousHostId)
          .map((viewer) => ({ participant_id: viewer.participant_id, name: viewer.name }));
        nextViewerSessions.push({ participant_id: previousHostId, name: previousHost.name });
        const sessionNames = new Set((party.viewer_sessions ?? []).map((viewer) => viewer.name));
        const legacyViewerNames = (party.viewers ?? []).filter((name) => !sessionNames.has(name) && name !== target.name);
        const nextViewerNames = [...new Set([...nextViewerSessions.map((viewer) => viewer.name), ...legacyViewerNames])];
        const ownerFilter = party.host_session_id
          ? { host_session_id: party.host_session_id }
          : { host_session_id: { $exists: false } };
        const updated = await Party.findOneAndUpdate(
          { party_code: Number(code), ...ownerFilter },
          {
            $set: {
              host_name: target.name,
              host_session_id: targetId,
              viewer_sessions: nextViewerSessions,
              viewers: nextViewerNames,
            },
          },
          { new: true },
        ).lean();
        if (!updated) {
          reject(socket, acknowledge, "Another host action changed this party. Refresh and try again.");
          return;
        }

        const targetToken = createParticipantSession({
          partyCode: Number(code), name: target.name, role: "host", participantId: targetId,
        });
        const previousHostToken = createParticipantSession({
          partyCode: Number(code), name: previousHost.name, role: "viewer", participantId: previousHostId,
        });

        activeHostIds.set(code, targetId);
        socket.data.participant = { ...previousHost, role: "viewer", participantId: previousHostId };
        socket.emit("party:session-updated", { sessionToken: previousHostToken, role: "viewer" });
        for (const targetSocket of targetSockets) {
          targetSocket.data.participant = { ...targetSocket.data.participant, role: "host" };
          targetSocket.emit("party:session-updated", { sessionToken: targetToken, role: "host" });
        }
        for (const client of localSockets) {
          if (client.id === socket.id || targetSockets.includes(client)) continue;
          if (client.data.participant.role === "host" && client.data.participant.participantId === previousHost.participantId) {
            client.data.participant = { ...client.data.participant, role: "viewer", participantId: previousHostId };
            client.emit("party:session-updated", { sessionToken: previousHostToken, role: "viewer" });
          }
        }
        io.to(room).emit("party:host-changed", { hostName: target.name, participantId: targetId });
        await broadcastPresence(io, code);
        if (typeof acknowledge === "function") acknowledge({ ok: true, hostName: target.name });
      } catch (error) {
        console.error("Host transfer failed:", error.message);
        reject(socket, acknowledge, "Could not transfer host access. Please try again.");
      } finally {
        hostTransfersInProgress.delete(code);
      }
    });

    socket.on("party:poll-create", (payload, acknowledge) => {
      if (!isCurrentHost(socket, code) || socket.data.joinedRoom !== room) {
        reject(socket, acknowledge, "Only the active host can create a room poll.");
        return;
      }
      const input = normalizePollInput(payload?.title, payload?.options);
      if (!input) {
        reject(socket, acknowledge, "A poll needs a title and two to six unique options.");
        return;
      }
      const existing = activePolls.get(code);
      if (existing?.isOpen) {
        reject(socket, acknowledge, "Close the current poll before creating another.");
        return;
      }
      const poll = {
        id: randomUUID(),
        title: input.title,
        options: input.options.map((text) => ({ id: randomUUID(), text, votes: 0 })),
        votes: new Map(),
        isOpen: true,
        createdAt: Date.now(),
        closedAt: null,
        revision: 0,
      };
      activePolls.set(code, poll);
      const state = publicPoll(poll);
      io.to(room).emit("party:poll-state", state);
      if (typeof acknowledge === "function") acknowledge({ ok: true, poll: { ...state, myVote: null } });
    });

    socket.on("party:poll-vote", (payload, acknowledge) => {
      if (socket.data.joinedRoom !== room) {
        reject(socket, acknowledge, "Join the party before voting.");
        return;
      }
      const poll = activePolls.get(code);
      const option = poll?.options.find((entry) => entry.id === payload?.optionId);
      const pollId = typeof payload?.pollId === "string" ? payload.pollId : "";
      const participantId = socket.data.participant.participantId ?? `${socket.data.participant.role}:${socket.data.participant.name}`;
      if (!poll || poll.id !== pollId || !poll.isOpen || !option) {
        reject(socket, acknowledge, "This poll is closed or the selected option is invalid.");
        return;
      }
      if (poll.votes.has(participantId)) {
        reject(socket, acknowledge, "You have already voted in this poll.");
        return;
      }
      poll.votes.set(participantId, option.id);
      option.votes += 1;
      poll.revision += 1;
      const state = publicPoll(poll);
      io.to(room).emit("party:poll-state", state);
      if (typeof acknowledge === "function") acknowledge({ ok: true, poll: { ...state, myVote: option.id } });
    });

    socket.on("party:poll-close", (payload, acknowledge) => {
      if (!isCurrentHost(socket, code) || socket.data.joinedRoom !== room) {
        reject(socket, acknowledge, "Only the active host can close this poll.");
        return;
      }
      const poll = activePolls.get(code);
      if (!poll || poll.id !== payload?.pollId || !poll.isOpen) {
        reject(socket, acknowledge, "This poll is already closed or no longer active.");
        return;
      }
      poll.isOpen = false;
      poll.closedAt = Date.now();
      poll.revision += 1;
      const state = publicPoll(poll);
      io.to(room).emit("party:poll-state", state);
      if (typeof acknowledge === "function") acknowledge({ ok: true, poll: state });
    });

    socket.on("party:chat-message", async (payload, acknowledge) => {
      const messageId = typeof payload?.id === "string" ? payload.id : "";
      const msg = typeof payload?.msg === "string" ? payload.msg.trim() : "";
      const timestamp = typeof payload?.timestamp === "string" ? payload.timestamp : "";
      if (
        socket.data.joinedRoom !== room ||
        !/^[a-f\d]{24}$/i.test(messageId) ||
        payload?.name !== socket.data.participant.name ||
        !msg || msg.length > 1000 ||
        !Number.isFinite(Date.parse(timestamp))
      ) {
        reject(socket, acknowledge, "That chat message is invalid.");
        return;
      }

      try {
        await connectDb();
        const isPersisted = await Chat.exists({
          party_code: Number(code),
          messages: {
            $elemMatch: {
              _id: messageId,
              name: socket.data.participant.name,
              msg,
              timestamp: new Date(timestamp),
            },
          },
        });
        if (!isPersisted) {
          reject(socket, acknowledge, "Save the message before broadcasting it.");
          return;
        }

        const acceptedMessage = {
          id: messageId,
          name: socket.data.participant.name,
          msg,
          timestamp,
        };
        io.to(room).emit("party:chat-message", acceptedMessage);
        if (typeof acknowledge === "function") acknowledge({ ok: true, message: acceptedMessage });
      } catch (error) {
        console.error("Socket chat verification failed:", error.message);
        reject(socket, acknowledge, "Could not verify the saved chat message.");
      }
    });

    socket.on("disconnect", async () => {
      if (socket.data.joinedRoom === room) {
        await broadcastPresence(io, code);
        if ((io.sockets.adapter.rooms.get(room)?.size ?? 0) === 0) scheduleRoomCleanup(io, code);
      }
    });
  });

  return io;
}
