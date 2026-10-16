import test from "node:test";
import assert from "node:assert/strict";
import { buildMovieSearchFilter } from "../src/app/lib/movie-query.mjs";

test("movie search and category filters are literal, bounded, and composable", () => {
  const filter = buildMovieSearchFilter("  Night.*  ");
  assert.equal(filter.$or.length, 4);
  assert.equal(filter.$or[0].title.test("Night.* of the Living Dead"), true);
  assert.equal(filter.$or[0].title.test("Night of the Living Dead"), false);
  assert.equal(filter.sourceProvider, "Internet Archive");
  assert.equal(filter.rightsBasis, "internet-archive-license");
  assert.equal(filter.availabilityStatus, "reachable");
  assert.equal(filter.runtimeSeconds.$gte, 2400);
  assert.equal("categories" in filter, false);
  assert.deepEqual(buildMovieSearchFilter(""), {
    sourceProvider: "Internet Archive",
    rightsBasis: "internet-archive-license",
    availabilityStatus: "reachable",
    runtimeSeconds: { $gte: 2400 },
  });
  assert.equal(buildMovieSearchFilter(` ${"a".repeat(120)} `, "").$or[0].title.source.length <= 100, true);
});
