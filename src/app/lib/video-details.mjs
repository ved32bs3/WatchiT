import { classifyVideoUrl } from "./video-providers.mjs";

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, maxLength) : "";
}

function safeThumbnail(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = ["i.ytimg.com", "yt3.ggpht.com", "archive.org", "archivewatch.org", "ia800000.us.archive.org"];
    return url.protocol === "https:" && (allowed.includes(host) || host.endsWith(".archive.org")) ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeVideoDetails(videoUrl, details = null) {
  const source = classifyVideoUrl(videoUrl);
  if (source.error) return null;
  const matches = details && (
    details.url === videoUrl || details.id === source.id || details.id === source.providerVideoId
  );
  const selected = matches ? details : null;
  return {
    url: videoUrl,
    video_id: source.id,
    title: cleanText(selected?.title, 200) || (source.provider === "youtube" ? `YouTube video ${source.providerVideoId}` : "Shared movie"),
    thumbnail: safeThumbnail(selected?.thumbnail),
    channel_name: cleanText(selected?.channelName, 120),
    provider: source.provider,
    player_type: source.playerType,
    release_year: Number.isInteger(selected?.releaseYear) && selected.releaseYear >= 1880 && selected.releaseYear <= 2100 ? selected.releaseYear : null,
    categories: Array.isArray(selected?.categories) ? [...new Set(selected.categories.map((value) => cleanText(value, 80)).filter(Boolean))].slice(0, 12) : [],
    source_page_url: /^https:\/\/(archive\.org|archivewatch\.org)\//.test(selected?.sourcePageUrl ?? "") ? selected.sourcePageUrl : "",
    license_info: cleanText(selected?.licenseInfo, 1000),
    availability_status: cleanText(selected?.availabilityStatus, 40) || "unknown",
  };
}
