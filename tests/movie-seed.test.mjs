import test from "node:test";
import assert from "node:assert/strict";
import { CURATED_ARCHIVE_MOVIE_IDS, parseArchiveSearchResults, seedMovies } from "../src/app/lib/movie-seed.mjs";

function makeSearchResults(identifiers = CURATED_ARCHIVE_MOVIE_IDS) {
  return {
    response: {
      docs: identifiers.map((identifier, index) => ({
        identifier,
        title: `Film ${index} (2008)`,
        year: 2008,
        licenseurl: "https://creativecommons.org/licenses/by/4.0/",
      })),
    },
  };
}

function makeFetch(searchPayload = makeSearchResults()) {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, method: options.method ?? "GET" });
    if (url.startsWith("https://archive.org/advancedsearch.php?")) {
      const parsed = new URL(url);
      assert.match(parsed.searchParams.get("q"), /collection:feature_films/);
      assert.match(parsed.searchParams.get("q"), /year:\[1970 TO 2019\]/);
      assert.match(parsed.searchParams.get("q"), /licenseurl:\*/);
      assert.equal(parsed.searchParams.get("rows"), "500");
      return new Response(JSON.stringify(searchPayload), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://archive.org/metadata/")) {
      const identifier = decodeURIComponent(url.split("/").at(-1));
      return new Response(JSON.stringify({
        metadata: {
          mediatype: "movies",
          title: `Source title ${identifier}`,
          creator: "Source creator",
          date: "2008",
          description: "Catalog supplied description",
          subject: ["Drama"],
          licenseurl: "https://creativecommons.org/licenses/by/4.0/",
        },
        files: [
          { name: "preview.mp4", source: "derivative", format: "MPEG4", length: "87.82" },
          { name: `${identifier}.ia.mp4`, source: "derivative", format: "MPEG4", length: "2700" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(options.method, "HEAD");
    return new Response(null, { status: 200, headers: { "content-type": "video/mp4" } });
  };
  return { fetchImpl, calls };
}

test("Internet Archive search results are restricted to curated, dated rights-tagged films", () => {
  const results = makeSearchResults(CURATED_ARCHIVE_MOVIE_IDS.slice(0, 1));
  results.response.docs.push(
    results.response.docs[0],
    { identifier: "no-rights", title: "No rights metadata", year: 1925 },
    { identifier: "new-film", title: "New film", year: 2008, licenseurl: "https://creativecommons.org/licenses/by/4.0/" },
    { identifier: "../invalid", title: "Invalid identifier", year: 2008, licenseurl: "https://creativecommons.org/licenses/by/4.0/" },
    { identifier: CURATED_ARCHIVE_MOVIE_IDS[1], title: "Too old", year: 1969, licenseurl: "https://creativecommons.org/licenses/by/4.0/" },
    { identifier: CURATED_ARCHIVE_MOVIE_IDS[2], title: "Too new", year: 2020, licenseurl: "https://creativecommons.org/licenses/by/4.0/" },
  );
  assert.deepEqual(parseArchiveSearchResults(results).map(({ identifier }) => identifier), [CURATED_ARCHIVE_MOVIE_IDS[0]]);
});

test("seed verifies curated Internet Archive records, replaces stale movies, and is idempotent", async () => {
  const { fetchImpl, calls } = makeFetch();
  const writes = [];
  const cleanups = [];
  const Movie = {
    async updateOne(filter, update, options) {
      writes.push({ filter, update, options });
      return { upsertedCount: writes.length <= CURATED_ARCHIVE_MOVIE_IDS.length ? 1 : 0, modifiedCount: writes.length > CURATED_ARCHIVE_MOVIE_IDS.length ? 1 : 0 };
    },
    async deleteMany(filter) {
      cleanups.push(filter);
      return { deletedCount: cleanups.length === 1 ? 50 : 0 };
    },
  };
  const first = await seedMovies(Movie, { fetchImpl, now: new Date("2026-10-17T00:00:00Z") });
  const second = await seedMovies(Movie, { fetchImpl, now: new Date("2026-10-17T00:00:00Z") });
  assert.equal(first.fetched, CURATED_ARCHIVE_MOVIE_IDS.length);
  assert.equal(first.created, CURATED_ARCHIVE_MOVIE_IDS.length);
  assert.equal(first.removed, 50);
  assert.equal(first.reachable, CURATED_ARCHIVE_MOVIE_IDS.length);
  assert.equal(first.rightsByArchiveMetadata, CURATED_ARCHIVE_MOVIE_IDS.length);
  assert.equal(second.created, 0);
  assert.equal(second.updated, CURATED_ARCHIVE_MOVIE_IDS.length);
  assert.equal(writes.length, CURATED_ARCHIVE_MOVIE_IDS.length * 2);
  assert.equal(cleanups.length, 2);
  assert.deepEqual(cleanups[0].sourceIdentifier.$nin, CURATED_ARCHIVE_MOVIE_IDS);
  assert.ok(writes.every((write) => write.options.upsert && write.filter.sourceIdentifier));
  assert.ok(writes.every((write) => write.update.$set.playbackUrl.startsWith("https://archive.org/download/")));
  assert.ok(writes.every((write) => write.update.$set.playbackUrl.endsWith(".ia.mp4")));
  assert.ok(writes.every((write) => write.update.$set.licenseUrl.startsWith("https://creativecommons.org/")));
  assert.ok(writes.every((write) => write.update.$set.availabilityStatus === "reachable"));
  assert.ok(writes.every((write) => write.update.$set.runtimeSeconds === 2700));
  assert.ok(writes.every((write) => write.update.$set.releaseYear === 2008));
  assert.ok(writes.every((write) => write.update.$set.creator === "Source creator"));
  assert.ok(writes.every((write) => write.update.$set.categories.includes("Drama")));
  assert.ok(writes.every((write) => !write.update.$set.categories.includes("Feature Films")));
  assert.equal(calls.filter((call) => call.method === "HEAD").length, CURATED_ARCHIVE_MOVIE_IDS.length * 2);
});

test("seed refuses fewer than 20 curated candidates without changing the database", async () => {
  const { fetchImpl } = makeFetch(makeSearchResults(CURATED_ARCHIVE_MOVIE_IDS.slice(0, 19)));
  let writes = 0;
  let deletes = 0;
  await assert.rejects(seedMovies({
    updateOne: async () => { writes += 1; },
    deleteMany: async () => { deletes += 1; },
  }, { fetchImpl }), /at least 20/);
  assert.equal(writes, 0);
  assert.equal(deletes, 0);
});

test("seed does not accept records without an explicit Creative Commons license and creator", async () => {
  const { fetchImpl: baseFetch } = makeFetch();
  const fetchImpl = async (input, options) => {
    const url = String(input);
    if (!url.startsWith("https://archive.org/metadata/")) return baseFetch(input, options);
    const identifier = decodeURIComponent(url.split("/").at(-1));
    return new Response(JSON.stringify({
      metadata: { mediatype: "movies", title: identifier, date: "2008", creator: "Uploader", rights: "Public domain" },
      files: [{ name: `${identifier}.mp4`, source: "original", length: "2700" }],
    }), { status: 200 });
  };
  let writes = 0;
  let deletes = 0;
  await assert.rejects(seedMovies({
    updateOne: async () => { writes += 1; },
    deleteMany: async () => { deletes += 1; },
  }, { fetchImpl }), /20.*valid movie records/);
  assert.equal(writes, 0);
  assert.equal(deletes, 0);
});

test("seed rejects generic placeholder creators even when an item claims a Creative Commons license", async () => {
  const { fetchImpl: baseFetch } = makeFetch();
  const fetchImpl = async (input, options) => {
    const url = String(input);
    if (!url.startsWith("https://archive.org/metadata/")) return baseFetch(input, options);
    const identifier = decodeURIComponent(url.split("/").at(-1));
    return new Response(JSON.stringify({
      metadata: {
        mediatype: "movies",
        title: identifier,
        date: "2008",
        creator: "John Doe",
        licenseurl: "https://creativecommons.org/licenses/by/4.0/",
      },
      files: [{ name: `${identifier}.mp4`, source: "original", length: "2700" }],
    }), { status: 200 });
  };
  let writes = 0;
  await assert.rejects(seedMovies({
    updateOne: async () => { writes += 1; },
    deleteMany: async () => {},
  }, { fetchImpl }), /20.*valid movie records/);
  assert.equal(writes, 0);
});

test("seed rejects media whose availability cannot be verified", async () => {
  const { fetchImpl: baseFetch } = makeFetch();
  const fetchImpl = async (input, options) => {
    if (options.method === "HEAD") return new Response(null, { status: 404 });
    return baseFetch(input, options);
  };
  let writes = 0;
  let deletes = 0;
  await assert.rejects(seedMovies({
    updateOne: async () => { writes += 1; },
    deleteMany: async () => { deletes += 1; },
  }, { fetchImpl }), /20.*valid movie records/);
  assert.equal(writes, 0);
  assert.equal(deletes, 0);
});
