import test from "node:test";
import assert from "node:assert/strict";
import { isExactPlaylistPermutation, movePlaylistItem, MAX_PLAYLIST_ITEMS } from "../src/app/lib/playlist-utils.mjs";

const a = "https://www.youtube.com/watch?v=AAAAAAAAAAA";
const b = "https://www.youtube.com/watch?v=BBBBBBBBBBB";
const c = "https://www.youtube.com/watch?v=CCCCCCCCCCC";

test("playlist reordering only accepts exact permutations", () => {
  assert.equal(isExactPlaylistPermutation([a, b, c], [c, a, b]), true);
  assert.equal(isExactPlaylistPermutation([a, b], [a, a]), false);
  assert.equal(isExactPlaylistPermutation([a, b], [a]), false);
  assert.equal(isExactPlaylistPermutation([a, b], [a, "outside"]), false);
  assert.equal(isExactPlaylistPermutation([], []), false);
});

test("movePlaylistItem reorders without adding or dropping entries", () => {
  assert.deepEqual(movePlaylistItem([a, b, c], 0, 2), [b, c, a]);
  assert.deepEqual(movePlaylistItem([a, b, c], 2, 0), [c, a, b]);
  assert.deepEqual(movePlaylistItem([a, b], 1, 1), [a, b]);
  assert.equal(movePlaylistItem([a], 0, 0), null);
  assert.equal(movePlaylistItem([a, b], 0, 2), null);
});

test("playlist capacity is bounded", () => {
  assert.equal(MAX_PLAYLIST_ITEMS, 50);
});
