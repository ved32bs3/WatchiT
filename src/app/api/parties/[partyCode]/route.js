import { NextResponse } from "next/server";
import connectDb from "@/app/lib/db";
import Party from "@/app/models/party/Party";
import Chat from "@/app/models/chat/Chat";
import { toPublicParty } from "@/app/lib/party-utils";
import { isActivePartyParticipant, readParticipantSession } from "@/app/lib/participant-session";
import { isExactPlaylistPermutation, MAX_PLAYLIST_ITEMS } from "@/app/lib/playlist-utils.mjs";

function getYouTubeId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pieces = url.pathname.split("/").filter(Boolean);
    const id = host === "youtu.be"
      ? pieces[0]
      : ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)
        ? url.searchParams.get("v") || (["embed", "shorts", "live"].includes(pieces[0]) ? pieces[1] : "")
        : "";
    return /^[A-Za-z0-9_-]{11}$/.test(id ?? "") ? id : "";
  } catch {
    return "";
  }
}

function serviceError(error) {
  console.error("Party state request failed:", error.message);
  return NextResponse.json({ error: "The party service is unavailable. Please try again." }, { status: 503 });
}

export async function GET(request, { params }) {
  const { partyCode } = await params;
  if (!/^\d{6}$/.test(partyCode)) {
    return NextResponse.json({ error: "Party code must contain exactly six digits." }, { status: 400 });
  }

  try {
    await connectDb();
    const party = await Party.findOne({ party_code: Number(partyCode) }).lean();
    if (!party) return NextResponse.json({ error: "Party not found." }, { status: 404 });
    const participant = readParticipantSession(request, partyCode);
    return NextResponse.json({
      party: toPublicParty(party),
      participant: isActivePartyParticipant(party, participant) ? participant : null,
      serverTime: Date.now(),
    });
  } catch (error) {
    console.error("Party lookup failed:", error.message);
    return NextResponse.json({ error: "The party service is unavailable. Please try again." }, { status: 503 });
  }
}

export async function PATCH(request, { params }) {
  const { partyCode } = await params;
  if (!/^\d{6}$/.test(partyCode)) {
    return NextResponse.json({ error: "Party code must contain exactly six digits." }, { status: 400 });
  }
  const participant = readParticipantSession(request, partyCode);
  if (participant?.role !== "host") {
    return NextResponse.json({ error: "Only this party's host can change the video or playback." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  if (body.expectedVersion !== undefined && (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 0)) {
    return NextResponse.json({ error: "Playlist version must be a non-negative integer." }, { status: 400 });
  }

  try {
    await connectDb();
    const current = await Party.findOne({ party_code: Number(partyCode) }).lean();
    if (!current) return NextResponse.json({ error: "Party not found." }, { status: 404 });
    if (!isActivePartyParticipant(current, participant)) {
      return NextResponse.json({ error: "This host session is no longer active." }, { status: 403 });
    }

    const action = body.action || (body.videoUrlToAdd ? "add" : "");
    const videoUrls = [...current.video_urls];
    const version = current.playlist_version ?? 0;
    let nextUrls;

    if (body.expectedVersion !== undefined && body.expectedVersion !== version) {
      return NextResponse.json({ error: "The playlist changed in another session. Refresh and try again." }, { status: 409 });
    }

    if (action === "add") {
      const videoUrl = typeof (body.videoUrl ?? body.videoUrlToAdd) === "string"
        ? (body.videoUrl ?? body.videoUrlToAdd).trim()
        : "";
      if (!videoUrl || videoUrl.length > 2048 || !getYouTubeId(videoUrl)) {
        return NextResponse.json({ error: "Provide a valid YouTube video URL to add to the playlist." }, { status: 400 });
      }
      if (videoUrls.includes(videoUrl)) return NextResponse.json({ party: toPublicParty(current) });
      if (videoUrls.length >= MAX_PLAYLIST_ITEMS) {
        return NextResponse.json({ error: `A playlist can contain at most ${MAX_PLAYLIST_ITEMS} videos.` }, { status: 409 });
      }
      nextUrls = [...videoUrls, videoUrl];
    } else if (action === "remove") {
      const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
      if (!videoUrls.includes(videoUrl)) return NextResponse.json({ error: "That video is not in the playlist." }, { status: 404 });
      if (videoUrls.length <= 1) return NextResponse.json({ error: "A party playlist must keep at least one video." }, { status: 409 });
      nextUrls = videoUrls.filter((item) => item !== videoUrl);
    } else if (action === "reorder") {
      if (!isExactPlaylistPermutation(videoUrls, body.videoUrls)) {
        return NextResponse.json({ error: "Reorder must contain every current playlist video exactly once." }, { status: 400 });
      }
      nextUrls = body.videoUrls;
      if (nextUrls.every((url, index) => url === videoUrls[index])) {
        return NextResponse.json({ party: toPublicParty(current) });
      }
    } else {
      return NextResponse.json({ error: "Choose a valid playlist action." }, { status: 400 });
    }

    const updated = await Party.findOneAndUpdate(
      {
        party_code: Number(partyCode),
        $or: [{ playlist_version: version }, { playlist_version: { $exists: false } }],
      },
      { $set: { video_urls: nextUrls }, $inc: { playlist_version: 1 } },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) return NextResponse.json({ error: "The playlist changed in another session. Refresh and try again." }, { status: 409 });
    return NextResponse.json({ party: toPublicParty(updated) });
  } catch (error) {
    return serviceError(error);
  }
}

export async function DELETE(request, { params }) {
  const { partyCode } = await params;
  if (!/^\d{6}$/.test(partyCode)) {
    return NextResponse.json({ error: "Party code must contain exactly six digits." }, { status: 400 });
  }

  const participant = readParticipantSession(request, partyCode);
  if (!participant) {
    return NextResponse.json({ error: "A valid party session is required." }, { status: 401 });
  }

  let body = {};
  try {
    const parsedBody = await request.json();
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    body = parsedBody;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
  }
  const action = body.action ?? "leave";
  if (!(["leave", "end"].includes(action))) {
    return NextResponse.json({ error: "Choose either leave or end for this party action." }, { status: 400 });
  }
  if (action === "end" && participant.role !== "host") {
    return NextResponse.json({ error: "Only the host can end this party." }, { status: 403 });
  }
  if (action === "leave" && participant.role === "host") {
    return NextResponse.json({ error: "The host cannot leave. End the party to close it for everyone." }, { status: 403 });
  }

  try {
    await connectDb();
    const current = await Party.findOne({ party_code: Number(partyCode) }).lean();
    if (!current) return NextResponse.json({ error: "Party not found." }, { status: 404 });
    if (!isActivePartyParticipant(current, participant)) {
      return NextResponse.json({ error: "This participant session is no longer active." }, { status: 403 });
    }

    if (action === "leave") {
      const sessions = current.viewer_sessions ?? [];
      const remainingSessions = participant.participantId
        ? sessions.filter((session) => session.participant_id !== participant.participantId)
        : sessions;
      const remainingNames = participant.participantId
        ? [...new Set([
          ...remainingSessions.map((session) => session.name),
          ...(current.viewers ?? []).filter((name) => !sessions.some((session) => session.name === name) && name !== participant.name),
        ])]
        : (current.viewers ?? []).filter((name) => name !== participant.name);
      await Party.updateOne(
        { party_code: Number(partyCode) },
        { $set: { viewer_sessions: remainingSessions, viewers: remainingNames } },
      );
      return NextResponse.json({ partyCode: Number(partyCode), left: true });
    }

    const party = await Party.findOne({ party_code: Number(partyCode) }).select({ _id: 1 }).lean();
    if (!party) return NextResponse.json({ error: "Party not found." }, { status: 404 });

    await Promise.all([
      Party.deleteOne({ party_code: Number(partyCode) }),
      Chat.deleteOne({ party_code: Number(partyCode) }),
    ]);
    return NextResponse.json({ partyCode: Number(partyCode), ended: true });
  } catch (error) {
    console.error("Party exit failed:", error.message);
    return NextResponse.json({ error: "Could not leave or end this party. Please try again." }, { status: 503 });
  }
}
