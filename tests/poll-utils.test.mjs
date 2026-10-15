import test from "node:test";
import assert from "node:assert/strict";
import { normalizePollInput } from "../src/app/lib/poll-utils.mjs";

test("poll input trims title and options", () => {
  assert.deepEqual(normalizePollInput("  Which movie? ", [" Arrival ", " Dune "]), {
    title: "Which movie?",
    options: ["Arrival", "Dune"],
  });
});

test("poll input rejects missing, oversized, duplicate and malformed options", () => {
  assert.equal(normalizePollInput("", ["A", "B"]), null);
  assert.equal(normalizePollInput("Q", ["A"]), null);
  assert.equal(normalizePollInput("Q", ["A", "a"]), null);
  assert.equal(normalizePollInput("Q", ["A", "B", "C", "D", "E", "F", "G"]), null);
  assert.equal(normalizePollInput("Q", ["A", " "]), null);
  assert.equal(normalizePollInput("Q", ["A", "B".repeat(81)]), null);
});
