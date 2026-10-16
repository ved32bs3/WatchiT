import { normalizeMovieGenres } from "./movie-genres.mjs";

const IA_SEARCH_URL = "https://archive.org/advancedsearch.php";
const IA_METADATA_BASE = "https://archive.org/metadata/";
const MAX_SEED_MOVIES = 50;
const MAX_SEARCH_CANDIDATES = 500;
const MIN_SEED_MOVIES = 20;
const MIN_FEATURE_LENGTH_SECONDS = 40 * 60;
export const CURATED_ARCHIVE_MOVIE_IDS = Object.freeze([
  "7Fires4UKitchiManitou",
  "RandallPullenTheDaysofLimbo",
  "Route66",
  "panorama_ephemera2004",
  "BetwHurr",
  "Star_Wreck_In_the_Pirkinning_VOScastellano",
  "ArenHaunLostintheWash",
  "Reign_of_the_Fallen",
  "Cafune",
  "WholesaleSoulsInc",
  "RobertSpindlerRichardSchwarzAlbertFrischMarkusPiffImWestennurBohnen_0",
  "insecurity",
  "BloodSpell_PAL_DVD",
  "Sobaka",
  "King_Lear",
  "Sita_Sings_the_Blues",
  "DeadManDrinking",
  "ChiaroscuroBaby",
  "Barcelona5000MinDvVideo2009",
  "MuzikaSaJasibare",
  "Decay2012-TheLhcZombieFilmfullFilm",
  "2013MommartzVonAndreasKopnick",
  "Ondas_Yaiza_videoteca",
  "2013MafiaXuFilmakademieBeijing16.10.201312620Master",
  "2015Uberfordert1964741.12H.26414.02.152",
  "2018LaBelleHistoireDamour",
  "Tango_Short_Version",
  "JederMenschIsteinTisch",
  "Jeder_Mensch_Nachtrag",
]);
const CURATED_ARCHIVE_MOVIE_ID_SET = new Set(CURATED_ARCHIVE_MOVIE_IDS);
const SEARCH_QUERY = `identifier:(${CURATED_ARCHIVE_MOVIE_IDS.join(" OR ")}) AND collection:feature_films AND mediatype:movies AND year:[1970 TO 2019] AND licenseurl:*`;

export function parseArchiveSearchResults(payload, limit = MAX_SEARCH_CANDIDATES) {
  const docs = payload?.response?.docs;
  if (!Array.isArray(docs)) return [];
  const movies = [];
  const seen = new Set();
  for (const doc of docs) {
    const identifier = typeof doc?.identifier === "string" ? doc.identifier : "";
    const title = asText(doc?.title);
    const year = releaseYear(doc?.year);
    if (
      !/^[A-Za-z0-9._-]{1,120}$/.test(identifier) ||
      !CURATED_ARCHIVE_MOVIE_ID_SET.has(identifier) ||
      !title ||
      !Number.isInteger(year) ||
      year < 1970 ||
      year > 2019 ||
      typeof doc?.licenseurl !== "string" ||
      !doc.licenseurl.trim() ||
      seen.has(identifier)
    ) continue;
    seen.add(identifier);
    movies.push({ identifier, title, year });
    if (movies.length >= Math.min(MAX_SEARCH_CANDIDATES, limit)) break;
  }
  return movies;
}

function asText(value) {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(" ");
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function releaseYear(value) {
  const match = String(value ?? "").match(/(?:18|19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function safeHttpImage(value, identifier) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && (url.hostname === "archive.org" || url.hostname.endsWith(".archive.org"))) return url.href;
  } catch {}
  return `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
}

function chooseMp4(files) {
  const candidates = (Array.isArray(files) ? files : [])
    .filter((file) =>
      typeof file?.name === "string" &&
      /\.mp4$/i.test(file.name) &&
      file.source !== "metadata" &&
      Number.isFinite(Number(file.length)) &&
      Number(file.length) >= MIN_FEATURE_LENGTH_SECONDS
    )
    .sort((left, right) => Number(/\.ia\.mp4$/i.test(right.name)) - Number(/\.ia\.mp4$/i.test(left.name)));
  return candidates[0] ?? null;
}

function verifiedShareBasis(metadata) {
  const rawLicense = typeof metadata.licenseurl === "string" ? metadata.licenseurl : "";
  let licenseUrl = "";
  try {
    const parsed = new URL(rawLicense.replace(/^http:/, "https:"));
    const creativeCommons = parsed.hostname === "creativecommons.org" && /^\/licenses\/(by|by-sa|by-nc|by-nc-sa|by-nd|by-nc-nd)\//i.test(parsed.pathname);
    if (parsed.protocol === "https:" && creativeCommons) licenseUrl = parsed.href;
  } catch {}
  if (licenseUrl) return {
    basis: "internet-archive-license",
    description: `Internet Archive item metadata lists this uploader-supplied Creative Commons license; review its terms and territory at ${licenseUrl}.`,
    licenseUrl,
  };

  return null;
}

async function boundedMap(items, concurrency, action) {
  const output = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      output[index] = await action(items[index]);
    }
  }));
  return output;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
  return response.json();
}

async function checkPlayback(fetchImpl, url) {
  try {
    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
      const response = await fetchImpl(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirectCount === 4) return "metadata-listed";
        const next = new URL(location, currentUrl);
        if (next.protocol !== "https:" || !(next.hostname === "archive.org" || next.hostname.endsWith(".archive.org"))) return "unavailable";
        currentUrl = next.href;
        continue;
      }
      if ([404, 410].includes(response.status)) return "unavailable";
      const type = response.headers.get("content-type")?.toLowerCase() ?? "";
      return response.ok && (type.startsWith("video/") || type === "application/octet-stream") ? "reachable" : "metadata-listed";
    }
    return "metadata-listed";
  } catch {
    return "metadata-listed";
  }
}

export async function fetchMovieSeedRecords({ fetchImpl = fetch, now = new Date() } = {}) {
  const searchParams = new URLSearchParams({
    q: SEARCH_QUERY,
    rows: String(MAX_SEARCH_CANDIDATES),
    page: "1",
    output: "json",
  });
  for (const field of ["identifier", "title", "year", "licenseurl"]) searchParams.append("fl[]", field);
  const searchPayload = await fetchJson(fetchImpl, `${IA_SEARCH_URL}?${searchParams}`);
  const candidates = parseArchiveSearchResults(searchPayload);
  if (candidates.length < MIN_SEED_MOVIES) {
    throw new Error(`Internet Archive returned ${candidates.length} curated rights-tagged feature films; at least ${MIN_SEED_MOVIES} are required to seed.`);
  }
  const accepted = [];
  for (let offset = 0; offset < candidates.length && accepted.length < MAX_SEED_MOVIES; offset += 50) {
    const batch = candidates.slice(offset, offset + 50);
    const records = await boundedMap(batch, 6, async (candidate) => {
      try {
        const item = await fetchJson(fetchImpl, `${IA_METADATA_BASE}${encodeURIComponent(candidate.identifier)}`);
        const metadata = item?.metadata;
        const file = chooseMp4(item?.files);
        if (!metadata || metadata.mediatype !== "movies" || !file) return null;
        const creator = asText(metadata.creator);
        const release = releaseYear(metadata.year) ?? releaseYear(metadata.date);
        if (!creator || /^(?:unknown|anonymous|n\/?a|none|john doe)$/i.test(creator) ||
          !Number.isInteger(release) || release < 1970 || release > 2019 || release !== candidate.year) return null;
        const rights = verifiedShareBasis(metadata);
        if (!rights) return null;
        const playbackUrl = `https://archive.org/download/${encodeURIComponent(candidate.identifier)}/${file.name.split("/").map(encodeURIComponent).join("/")}`;
        const availabilityStatus = await checkPlayback(fetchImpl, playbackUrl);
        if (availabilityStatus !== "reachable") return null;
        const subjects = Array.isArray(metadata.subject)
          ? metadata.subject.map(asText).filter(Boolean)
          : asText(metadata.subject).split(/[;,]/).map((part) => part.trim()).filter(Boolean);
        const genres = subjects.slice(0, 12);
        const categories = normalizeMovieGenres(subjects);
        const description = asText(metadata.description);
        return {
          sourceIdentifier: candidate.identifier,
          title: asText(metadata.title) || candidate.title,
          description: description.slice(0, 4000),
          creator: creator.slice(0, 300),
          releaseYear: release,
          runtimeSeconds: Number(file.length),
          categories,
          genres,
          thumbnail: safeHttpImage(candidate.thumbnail || metadata.image, candidate.identifier),
          sourceProvider: "Internet Archive",
          sourcePageUrl: `https://archive.org/details/${encodeURIComponent(candidate.identifier)}`,
          playbackUrl,
          playerType: "html5-video",
          licenseInfo: rights.description.slice(0, 1000),
          licenseUrl: rights.licenseUrl,
          rightsBasis: rights.basis,
          availabilityStatus,
          availabilityCheckedAt: now,
          lastSeededAt: now,
        };
      } catch {
        return null;
      }
    });
    accepted.push(...records.filter(Boolean));
  }
  return accepted.slice(0, MAX_SEED_MOVIES);
}

export async function seedMovies(Movie, { fetchImpl = fetch, now = new Date() } = {}) {
  const records = await fetchMovieSeedRecords({ fetchImpl, now });
  if (records.length < MIN_SEED_MOVIES || records.length > MAX_SEED_MOVIES) {
    throw new Error(`Expected ${MIN_SEED_MOVIES}–${MAX_SEED_MOVIES} valid movie records; found ${records.length}. Nothing was written.`);
  }
  let created = 0;
  let updated = 0;
  for (const record of records) {
    const result = await Movie.updateOne(
      { sourceIdentifier: record.sourceIdentifier },
      { $set: record },
      { upsert: true, runValidators: true },
    );
    if (result.upsertedCount) created += 1;
    else if (result.modifiedCount) updated += 1;
  }
  const retainedIdentifiers = records.map(({ sourceIdentifier }) => sourceIdentifier);
  const cleanup = await Movie.deleteMany({
    sourceProvider: "Internet Archive",
    sourceIdentifier: { $nin: retainedIdentifiers },
  });
  return {
    fetched: records.length,
    created,
    updated,
    unchanged: records.length - created - updated,
    removed: cleanup.deletedCount ?? 0,
    reachable: records.filter((movie) => movie.availabilityStatus === "reachable").length,
    rightsByArchiveMetadata: records.filter((movie) => movie.rightsBasis === "internet-archive-license").length,
  };
}
