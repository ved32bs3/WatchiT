import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import connectDb from "@/app/lib/db";
import Party from "@/app/models/party/Party";
import { createParticipantSession } from "@/app/lib/participant-session";

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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const partyCode = String(body.partyCode ?? "");
  if (!name || name.length > 40) {
    return NextResponse.json({ error: "Name is required and must be 40 characters or fewer." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(partyCode)) {
    return NextResponse.json({ error: "Party code must contain exactly six digits." }, { status: 400 });
  }

  const viewerSessionId = randomUUID();
  let viewerSession;
  try {
    viewerSession = createParticipantSession({ partyCode: Number(partyCode), name, role: "viewer", participantId: viewerSessionId });
  } catch (error) {
    console.error("Viewer session creation failed:", error.message);
    return NextResponse.json({ error: "Party sessions are not configured on the server." }, { status: 503 });
  }

  try {
    await connectDb();
    const party = await Party.findOneAndUpdate(
      { party_code: Number(partyCode) },
      {
        $addToSet: { viewers: name },
        $push: { viewer_sessions: { participant_id: viewerSessionId, name } },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!party) return NextResponse.json({ error: "Party not found. Check the code and try again." }, { status: 404 });
    return NextResponse.json({ partyCode: party.party_code, hostName: party.host_name, participantId: viewerSessionId, sessionToken: viewerSession }, { status: 200 });
  } catch (error) {
    console.error("Party join failed:", error.message);
    return NextResponse.json({ error: "The party service is unavailable. Please try again." }, { status: 503 });
  }
}
