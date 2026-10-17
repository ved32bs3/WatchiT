"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export default function VideoSearch({ isHost = false, onSelectVideo, onAddToPlaylist }) {
  const [query, setQuery] = useState("");
  const [videos, setVideos] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [duration, setDuration] = useState("any");
  const [order, setOrder] = useState("relevance");
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);

  // Load the region's assignable movie-related categories from YouTube.
  useEffect(() => {
    let isCurrent = true;
    fetch("/api/youtube/categories")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load movie categories.");
        if (!isCurrent) return;
        setCategories(data.categories ?? []);
        setCategoryId(data.categories?.[0]?.id ?? "");
        if (!data.categories?.length) setError("YouTube has no movie-related categories available for this region.");
      })
      .catch((categoryError) => {
        if (isCurrent) setError(categoryError.message || "Could not load movie categories.");
      })
      .finally(() => {
        if (isCurrent) setIsLoadingCategories(false);
      });
    return () => { isCurrent = false; };
  }, []);

  if (!isHost) return null;

  async function handleSearch(event) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2 || trimmedQuery.length > 100) {
      setError("Enter a search between 2 and 100 characters.");
      setVideos([]);
      return;
    }

    setIsLoading(true);
    setError("");
    setHasSearched(true);

    try {
      const response = await fetch(
        `/api/youtube/search?q=${encodeURIComponent(trimmedQuery)}&categoryId=${encodeURIComponent(categoryId)}&duration=${duration}&order=${order}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed.");
      setVideos(data.videos ?? []);
    } catch (searchError) {
      setVideos([]);
      setError(searchError.message || "Unable to search videos right now.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="w-full" aria-labelledby="video-search-title">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Host tools</p>
        <h2 id="video-search-title" className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Find the next thing to watch
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Search YouTube and choose a video for your party.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="video-query" className="sr-only">Search YouTube videos</label>
        <input
          id="video-query"
          type="search"
          minLength={2}
          maxLength={100}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search movie titles, actors, or filmmakers"
          className="min-h-12 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-zinc-950/70 px-4 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-rose-300/50 focus:ring-2 focus:ring-rose-300/10"
        />
        <button
          type="submit"
          disabled={isLoading || isLoadingCategories || !categoryId}
          className="min-h-12 cursor-pointer rounded-lg bg-rose-500 px-6 text-sm font-semibold text-white transition hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Searching..." : "Search videos"}
        </button>
      </form>

      <div className="mt-5 space-y-4 rounded-lg border border-white/[0.07] bg-black/20 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">YouTube category</span>
            {isLoadingCategories ? (
              <span className="text-zinc-500">Loading…</span>
            ) : (
              <div className="flex flex-wrap gap-2" aria-label="Movie category filter">
                {categories.map((category) => (
                  <button
                    type="button"
                    key={category.id}
                    aria-pressed={categoryId === category.id}
                    onClick={() => { setCategoryId(category.id); setVideos([]); setHasSearched(false); }}
                    className={`inline-flex min-h-9 cursor-pointer items-center gap-2 border-b px-2.5 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${categoryId === category.id ? "border-rose-300/70 text-rose-100" : "border-transparent text-zinc-400 hover:text-zinc-100"}`}
                  >
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${categoryId === category.id ? "bg-rose-300" : "bg-zinc-600"}`} />
                    {category.title}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-zinc-500">YouTube uploader category</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-medium text-zinc-400">Video length</p>
            <div className="flex flex-wrap gap-2" aria-label="Video length filter">
              {[{ id: "any", label: "Any length" }, { id: "short", label: "Under 4 min" }, { id: "medium", label: "4-20 min" }, { id: "long", label: "Over 20 min" }].map((option) => (
                <button
                  type="button"
                  key={option.id}
                  aria-pressed={duration === option.id}
                  onClick={() => { setDuration(option.id); setVideos([]); setHasSearched(false); }}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-xs transition ${duration === option.id ? "bg-white/10 text-white shadow-inner shadow-white/[0.04]" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            Sort
            <select
              value={order}
              onChange={(event) => { setOrder(event.target.value); setVideos([]); setHasSearched(false); }}
              className="min-h-9 cursor-pointer rounded-md border border-white/10 bg-zinc-900 px-2 text-xs text-white outline-none focus:border-rose-300/50"
            >
              <option value="relevance">Relevance</option>
              <option value="viewCount">Most viewed</option>
              <option value="date">Newest</option>
              <option value="rating">Top rated</option>
            </select>
          </label>
        </div>
        <p className="text-[11px] leading-5 text-zinc-500">YouTube categories are uploader classifications. Movie-related categories are used here as a best-effort movie filter; they do not guarantee every result is a full feature film.</p>
      </div>

      <div className="mt-6" aria-live="polite">
        {error && (
          <p role="alert" className="rounded-lg border-l-2 border-rose-400/60 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        )}
        {!error && !isLoading && hasSearched && videos.length === 0 && (
          <p className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-5 text-sm text-zinc-400">
            No videos found. Try a different search.
          </p>
        )}
        {videos.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((video) => (
              <li key={video.id} className="overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.025] transition-colors hover:bg-white/[0.04]">
                {video.thumbnail ? (
                  <Image src={video.thumbnail} alt="" width={480} height={270} unoptimized className="aspect-video w-full object-cover" />
                ) : (
                  <div className="aspect-video bg-white/[0.05]" aria-hidden="true" />
                )}
                <div className="p-4">
                  <h3 className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-white">{video.title}</h3>
                  <p className="mt-1 truncate text-xs text-zinc-400">{video.channelName}</p>
                  <div className={`mt-4 grid gap-2 ${onAddToPlaylist ? "sm:grid-cols-2" : "grid-cols-1"}`}>
                    <button
                      type="button"
                      onClick={() => onSelectVideo?.(video.url, video)}
                      className={`min-h-10 w-full cursor-pointer rounded-lg px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${onAddToPlaylist ? "bg-rose-500/10 text-rose-200 hover:bg-rose-500/20" : "bg-white/[0.04] text-zinc-100 hover:bg-white/[0.08]"}`}
                    >
                      {onAddToPlaylist ? "Play video" : "Select Video"}
                    </button>
                    {onAddToPlaylist && (
                      <button
                        type="button"
                        onClick={() => onAddToPlaylist(video.url, video)}
                        className="min-h-10 w-full cursor-pointer rounded-lg bg-transparent px-3 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                      >
                        Add to Playlist
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
