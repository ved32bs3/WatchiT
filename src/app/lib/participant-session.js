import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function sign(encodedPayload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createParticipantSession({ partyCode, name, role, participantId }) {
  const payload = Buffer.from(JSON.stringify({ partyCode, name, role, participantId, exp: Date.now() + SESSION_MAX_AGE * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyParticipantToken(token, partyCode) {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  try {
    const expectedSignature = sign(payload);
    const expected = Buffer.from(expectedSignature);
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.partyCode !== Number(partyCode) || !["host", "viewer"].includes(session.role)) return null;
    if (typeof session.name !== "string" || !session.name || session.exp <= Date.now()) return null;
    if (session.participantId !== undefined && (typeof session.participantId !== "string" || !session.participantId)) return null;
    return { name: session.name, role: session.role, participantId: session.participantId ?? null };
  } catch {
    return null;
  }
}

export function readParticipantSession(request, partyCode) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  return verifyParticipantToken(authorization.slice("Bearer ".length).trim(), partyCode);
}

export function isActivePartyParticipant(party, participant) {
  if (!party || !participant) return false;
  if (participant.role === "host") {
    return party.host_session_id
      ? participant.participantId === party.host_session_id
      : participant.participantId === null;
  }
  if (participant.role !== "viewer") return false;
  if (participant.participantId) {
    return (party.viewer_sessions ?? []).some((session) => session.participant_id === participant.participantId);
  }
  return (party.viewers ?? []).includes(participant.name);
}
