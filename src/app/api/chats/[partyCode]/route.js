import { NextResponse } from "next/server";
import connectDb from "@/app/lib/db";
import Party from "@/app/models/party/Party";
import Chat from "@/app/models/chat/Chat";
import { isActivePartyParticipant, readParticipantSession } from "@/app/lib/participant-session";

async function validatePartyCode(partyCode) {
  if (!/^\d{6}$/.test(partyCode)) {
    return { response: NextResponse.json({ error: "Party code must contain exactly six digits." }, { status: 400 }) };
  }
  await connectDb();
  const party = await Party.findOne({ party_code: Number(partyCode) }).lean();
  if (!party) {
    return { response: NextResponse.json({ error: "Party not found." }, { status: 404 }) };
  }
  return { numericCode: Number(partyCode), party };
}

export async function GET(request, { params }) {
  const { partyCode } = await params;
  try {
    const participant = readParticipantSession(request, partyCode);
    if (!participant) return NextResponse.json({ error: "A valid party session is required." }, { status: 401 });
    const validation = await validatePartyCode(partyCode);
    if (validation.response) return validation.response;
    if (!isActivePartyParticipant(validation.party, participant)) return NextResponse.json({ error: "This participant session is no longer active." }, { status: 401 });
    const chat = await Chat.findOne({ party_code: validation.numericCode }).lean();
    return NextResponse.json({ partyCode: validation.numericCode, messages: chat?.messages ?? [] });
  } catch (error) {
    console.error("Chat history lookup failed:", error.message);
    return NextResponse.json({ error: "Chat history is unavailable. Please try again." }, { status: 503 });
  }
}

export async function POST(request, { params }) {
  const { partyCode } = await params;
  const participant = readParticipantSession(request, partyCode);
  if (!participant) return NextResponse.json({ error: "A valid party session is required." }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const name = participant.name;
  const msg = typeof body.msg === "string" ? body.msg.trim() : "";
  if (!msg || msg.length > 1000) {
    return NextResponse.json({ error: "Message is required and must be 1000 characters or fewer." }, { status: 400 });
  }

  try {
    const validation = await validatePartyCode(partyCode);
    if (validation.response) return validation.response;
    if (!isActivePartyParticipant(validation.party, participant)) return NextResponse.json({ error: "This participant session is no longer active." }, { status: 401 });
    const message = { name, msg, timestamp: new Date() };
    const chat = await Chat.findOneAndUpdate(
      { party_code: validation.numericCode },
      {
        $setOnInsert: { party_code: validation.numericCode },
        $push: { messages: message },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    return NextResponse.json({ message: chat.messages.at(-1) }, { status: 201 });
  } catch (error) {
    console.error("Chat message persistence failed:", error.message);
    return NextResponse.json({ error: "Could not save the chat message. Please try again." }, { status: 503 });
  }
}
