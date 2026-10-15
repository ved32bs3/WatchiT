import { randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import connectDb from "@/app/lib/db";
import Party from "@/app/models/party/Party";
import Chat from "@/app/models/chat/Chat";
import { toPublicParty } from "@/app/lib/party-utils";
import { createParticipantSession } from "@/app/lib/participant-session";

function errorResponse(error) {
  console.error("Party API error:", error.message);
  if (error.name === "ValidationError" || error.name === "CastError") {
    return NextResponse.json({ error: "Invalid party data." }, { status: 400 });
  }
  return NextResponse.json(
    { error: "The party service is unavailable. Please try again." },
    { status: 503 }
  );
}

function getYouTubeId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pieces = url.pathname.split("/").filter(Boolean);
    let id = "";
    if (host === "youtu.be") id = pieces[0] ?? "";
    else if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      id = url.searchParams.get("v") || (["embed", "shorts", "live"].includes(pieces[0]) ? pieces[1] : "");
    } else return "";
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const hostName = typeof body.hostName === "string" ? body.hostName.trim() : "";
  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
  if (!hostName || hostName.length > 40) {
    return NextResponse.json({ error: "Host name is required and must be 40 characters or fewer." }, { status: 400 });
  }
  if (!videoUrl || !getYouTubeId(videoUrl)) {
    return NextResponse.json({ error: "Provide a valid YouTube video URL." }, { status: 400 });
  }

  try {
    await connectDb();
    await Promise.all([Party.init(), Chat.init()]);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const partyCode = randomInt(100000, 1000000);
      try {
        const hostSessionId = randomUUID();
        const hostSession = createParticipantSession({ partyCode, name: hostName, role: "host", participantId: hostSessionId });
        const party = await Party.create({
          host_name: hostName,
          host_session_id: hostSessionId,
          viewer_sessions: [],
          viewers: [],
          party_code: partyCode,
          video_urls: [videoUrl],
          playlist_version: 0,
        });
        try {
          await Chat.create({ party_code: partyCode, messages: [] });
        } catch (chatError) {
          await Party.deleteOne({ _id: party._id });
          throw chatError;
        }
        return NextResponse.json({ partyCode, sessionToken: hostSession }, { status: 201 });
      } catch (error) {
        if (error.code === 11000 && attempt < 4) continue;
        throw error;
      }
    }
    return NextResponse.json({ error: "Could not allocate a party code. Please try again." }, { status: 503 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Provide a six-digit party code in the code query parameter." }, { status: 400 });
  }

  try {
    await connectDb();
    const party = await Party.findOne({ party_code: Number(code) }).lean();
    if (!party) return NextResponse.json({ error: "Party not found." }, { status: 404 });
    return NextResponse.json({ party: toPublicParty(party) });
  } catch (error) {
    return errorResponse(error);
  }
}
