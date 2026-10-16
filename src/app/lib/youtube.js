export const YOUTUBE_CATEGORIES_URL = "https://www.googleapis.com/youtube/v3/videoCategories";
const MOVIE_CATEGORY_PATTERN = /film|movie/i;

export async function getMovieCategories(apiKey, regionCode) {
  const params = new URLSearchParams({ part: "snippet", regionCode, key: apiKey });
  const response = await fetch(`${YOUTUBE_CATEGORIES_URL}?${params}`, {
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const reason = payload?.error?.errors?.[0]?.reason;
    const error = new Error("YouTube categories are unavailable.");
    error.status = ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(reason) ? 503 : 502;
    throw error;
  }

  return (payload?.items ?? [])
    .filter((category) => category.snippet?.assignable && MOVIE_CATEGORY_PATTERN.test(category.snippet.title))
    .map((category) => ({ id: category.id, title: category.snippet.title }));
}

export function getYouTubeConfig() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const regionCode = (process.env.YOUTUBE_REGION_CODE || "US").toUpperCase();
  if (!apiKey) return { error: "Video search is not configured. Set YOUTUBE_API_KEY on the server." };
  if (!/^[A-Z]{2}$/.test(regionCode)) return { error: "YOUTUBE_REGION_CODE must be a two-letter country code." };
  return { apiKey, regionCode };
}

export async function getYouTubeVideoDetails(videoUrl, videoId) {
  const params = new URLSearchParams({ url: videoUrl, format: "json" });
  try {
    const response = await fetch(`https://www.youtube.com/oembed?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (typeof payload.title !== "string" || !payload.title.trim()) return null;

    let thumbnail = "";
    try {
      const image = new URL(payload.thumbnail_url);
      if (image.protocol === "https:" && ["i.ytimg.com", "yt3.ggpht.com"].includes(image.hostname)) thumbnail = image.href;
    } catch {}

    return {
      url: videoUrl,
      video_id: videoId,
      title: payload.title.trim().slice(0, 200),
      thumbnail,
      channel_name: typeof payload.author_name === "string" ? payload.author_name.trim().slice(0, 120) : "",
    };
  } catch {
    return null;
  }
}
