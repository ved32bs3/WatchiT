import test from "node:test";
import assert from "node:assert/strict";
import { isActivePartyParticipant } from "../src/app/lib/participant-session.js";

test("party participant identity follows the stored host and viewer sessions", () => {
  const party = {
    host_session_id: "host-1",
    viewer_sessions: [{ participant_id: "viewer-1", name: "Alex" }],
    viewers: ["Alex"],
  };
  assert.equal(isActivePartyParticipant(party, { role: "host", participantId: "host-1", name: "Host" }), true);
  assert.equal(isActivePartyParticipant(party, { role: "host", participantId: "former-host", name: "Host" }), false);
  assert.equal(isActivePartyParticipant(party, { role: "viewer", participantId: "viewer-1", name: "Alex" }), true);
  assert.equal(isActivePartyParticipant(party, { role: "viewer", participantId: "removed-viewer", name: "Alex" }), false);
});

test("legacy rooms accept legacy sessions without permitting an id-bearing stale host", () => {
  const legacyParty = { host_name: "Host", viewers: ["Guest"] };
  assert.equal(isActivePartyParticipant(legacyParty, { role: "host", participantId: null, name: "Host" }), true);
  assert.equal(isActivePartyParticipant(legacyParty, { role: "host", participantId: "unrecognized", name: "Host" }), false);
  assert.equal(isActivePartyParticipant(legacyParty, { role: "viewer", participantId: null, name: "Guest" }), true);
});
