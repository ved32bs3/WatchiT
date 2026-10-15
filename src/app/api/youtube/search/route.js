import { NextResponse } from "next/server";
import { getMovieCategories, getYouTubeConfig } from "@/app/lib/youtube";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const MAX_RESULTS = 12;

export async function GET(request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  const searchParams = new URL(request.url).searchParams;
  const categoryId = searchParams.get("categoryId");
  const duration = searchParams.get("duration") || "any";
  const order = searchParams.get("order") || "relevance";

  if (!query || query.length < 2 || query.length > 100) {
    return NextResponse.json(
      { error: "Search must be between 2 and 100 characters." },
      { status: 400 },
    );
  }

  const config = getYouTubeConfig();
  if (config.error) {
    return NextResponse.json(
      { error: config.error },
      { status: 503 },
    );
  }

  if (!["any", "short", "medium", "long"].includes(duration)) {
    return NextResponse.json({ error: "Invalid duration filter." }, { status: 400 });
  }
  if (!["relevance", "date", "rating", "viewCount"].includes(order)) {
    return NextResponse.json({ error: "Invalid sort order." }, { status: 400 });
  }

  let categories;
  try {
    categories = await getMovieCategories(config.apiKey, config.regionCode);
  } catch (error) {
    console.error("YouTube category lookup failed", { message: error.message });
    return NextResponse.json(
      { error: "Could not verify movie categories. Please try again." },
      { status: error.status || 502 },
    );
  }

  if (!categories.length) {
    return NextResponse.json({ error: "YouTube has no movie-related video categories for this region." }, { status: 503 });
  }
  if (!categories.some((category) => category.id === categoryId)) {
    return NextResponse.json({ error: "Choose a valid movie category." }, { status: 400 });
  }

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: String(MAX_RESULTS),
    q: query,
    videoCategoryId: categoryId,
    videoDuration: duration,
    order,
    videoEmbeddable: "true",
    key: config.apiKey,
  });

  try {
    const response = await fetch(`${YOUTUBE_SEARCH_URL}?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
    const reason = payload?.error?.errors?.[0]?.reason;
      if (["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(reason)) {
        return NextResponse.json(
          { error: "YouTube search is temporarily unavailable because its quota or rate limit was reached." },
          { status: 503 },
        );
      }

      console.error("YouTube search request failed", {
        status: response.status,
        reason: reason ?? "unknown",
      });
      return NextResponse.json(
        { error: "YouTube could not complete the search. Please try again." },
        { status: response.status === 400 ? 400 : 502 },
      );
    }

    const videos = (payload?.items ?? [])
      // A YouTube video ID is 11 URL-safe characters. Also discard entries that
      // cannot be embedded by the YouTube player.
      .filter((item) => /^[A-Za-z0-9_-]{11}$/.test(item.id?.videoId ?? "") && item.snippet)
      .map((item) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail:
          item.snippet.thumbnails?.medium?.url ??
          item.snippet.thumbnails?.default?.url ??
          null,
        channelName: item.snippet.channelTitle,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id.videoId)}`,
      }));

    return NextResponse.json({ videos });
  } catch (error) {
    console.error("YouTube search request failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Unable to reach YouTube right now. Please try again." },
      { status: 502 },
    );
  }
}
