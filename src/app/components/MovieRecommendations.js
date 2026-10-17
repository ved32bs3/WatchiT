"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const MOVIES_PER_PAGE = 6;

function toVideoDetails(movie) {
  return {
    id: `internet-archive:${movie.sourceIdentifier}:${movie.playbackUrl.split("/").at(-1)}`,
    url: movie.playbackUrl,
    title: movie.title,
    creator: movie.creator,
    thumbnail: movie.thumbnail,
    channelName: movie.sourceProvider,
    provider: "internet-archive",
    playerType: movie.playerType,
    releaseYear: movie.releaseYear,
    runtimeSeconds: movie.runtimeSeconds,
    categories: movie.categories,
    sourcePageUrl: movie.sourcePageUrl,
    licenseInfo: movie.licenseInfo,
    availabilityStatus: movie.availabilityStatus,
  };
}

function formatRuntime(runtimeSeconds) {
  return Number.isFinite(runtimeSeconds) ? `${Math.round(runtimeSeconds / 60)} min` : "";
}

export default function MovieRecommendations({ onSelectMovie, onAddToPlaylist }) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [visibleMovieCount, setVisibleMovieCount] = useState(MOVIES_PER_PAGE);
  const [movies, setMovies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (submittedQuery) params.set("q", submittedQuery);
    if (selectedCategory) params.set("category", selectedCategory);
    fetch(`/api/movies?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Could not load movie recommendations.");
        setMovies(payload.movies ?? []);
        setCategories(payload.categories ?? []);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message || "Could not load movie recommendations.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [submittedQuery, selectedCategory, retryCount]);

  function select(movie) {
    if (movie.availabilityStatus === "unavailable") return;
    const details = toVideoDetails(movie);
    onSelectMovie?.(movie.playbackUrl, details);
  }

  return (
    <section className="w-full" aria-labelledby="movie-recommendations-title">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Free-to-watch catalog</p>
        <h2 id="movie-recommendations-title" className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Movie recommendations</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">Curated feature films served by the Internet Archive. Rights and playback status are shown per title.</p>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); setError(""); setLoading(true); setVisibleMovieCount(MOVIES_PER_PAGE); setSubmittedQuery(query.trim()); }} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="movie-catalog-search" className="sr-only">Search the movie catalog</label>
        <input id="movie-catalog-search" type="search" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search movie titles or descriptions" className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20" />
        <label className="flex items-center gap-2 text-sm text-zinc-400">Genre
          <span className="relative">
            <select aria-label="Filter movies by genre" value={selectedCategory} onChange={(event) => { setError(""); setLoading(true); setVisibleMovieCount(MOVIES_PER_PAGE); setSelectedCategory(event.target.value); }} className="min-h-11 min-w-40 cursor-pointer appearance-none rounded-lg border border-white/[0.08] bg-zinc-950/80 py-2 pl-3 pr-9 text-sm text-zinc-100 outline-none transition hover:border-white/20 focus:border-rose-300/50 focus:ring-2 focus:ring-rose-300/10">
              <option value="">All genres</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 fill-zinc-500"><path d="m3.5 5.75 4.5 4.5 4.5-4.5z" /></svg>
          </span>
        </label>
        <button type="submit" className="min-h-11 cursor-pointer rounded-lg bg-white/[0.08] px-5 text-sm font-medium text-white hover:bg-white/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">Search</button>
      </form>

      <div className="mt-6" aria-live="polite">
        {loading && <p role="status" className="rounded-xl border border-white/10 p-4 text-sm text-zinc-400">Loading movie recommendations…</p>}
        {!loading && error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}<button type="button" onClick={() => { setError(""); setLoading(true); setRetryCount((count) => count + 1); }} className="ml-3 cursor-pointer underline">Retry</button></div>}
        {!loading && !error && movies.length === 0 && <p className="rounded-xl border border-white/10 p-5 text-sm text-zinc-400">No matching movies are available. Try another title or category.</p>}
        {!loading && !error && movies.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {movies.slice(0, visibleMovieCount).map((movie) => (
              <li key={movie.sourceIdentifier} className="overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.025] transition-colors hover:bg-white/[0.04]">
                {movie.thumbnail ? <Image src={movie.thumbnail} alt="" width={640} height={360} unoptimized className="aspect-video w-full bg-black object-cover" /> : <div className="aspect-video bg-white/[0.05]" aria-hidden="true" />}
                <div className="p-4">
                  <button type="button" onClick={() => setSelectedMovie(movie)} className="cursor-pointer text-left text-sm font-semibold text-white underline decoration-white/20 underline-offset-4 hover:decoration-white/70">{movie.title}</button>
                  {movie.creator && <p className="mt-1 text-xs text-zinc-400">By {movie.creator}</p>}
                  <p className="mt-1 text-xs text-zinc-400">{movie.releaseYear ?? "Year not listed"}{formatRuntime(movie.runtimeSeconds) ? ` · ${formatRuntime(movie.runtimeSeconds)}` : ""}{movie.categories?.length ? ` · ${movie.categories.join(" · ")}` : ""}</p>
                  <p className="mt-2 text-xs text-zinc-500">Playback: {movie.availabilityStatus}</p>
                  <div className={`mt-4 grid gap-2 ${onAddToPlaylist ? "grid-cols-2" : "grid-cols-1"}`}>
                    <button type="button" disabled={movie.availabilityStatus === "unavailable"} onClick={() => select(movie)} className="min-h-10 cursor-pointer rounded-lg bg-white/[0.04] px-3 text-sm font-medium text-zinc-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">Watch</button>
                    {onAddToPlaylist && <button type="button" disabled={movie.availabilityStatus === "unavailable"} onClick={() => onAddToPlaylist(movie.playbackUrl, toVideoDetails(movie))} className="min-h-10 cursor-pointer rounded-lg bg-transparent px-3 text-sm text-zinc-300 transition hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-50">Add to Playlist</button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && !error && movies.length > visibleMovieCount && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => setVisibleMovieCount((count) => Math.min(count + MOVIES_PER_PAGE, movies.length))}
              className="min-h-11 cursor-pointer rounded-lg border border-white/15 bg-white/[0.06] px-5 text-sm font-medium text-white hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              See more movies
            </button>
          </div>
        )}
      </div>

      {selectedMovie && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMovie(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="movie-details-title" className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><h3 id="movie-details-title" className="text-xl font-semibold text-white">{selectedMovie.title}</h3>{selectedMovie.creator && <p className="mt-1 text-sm text-zinc-400">By {selectedMovie.creator}</p>}<p className="mt-1 text-sm text-zinc-400">{selectedMovie.releaseYear ?? "Year not listed"}{formatRuntime(selectedMovie.runtimeSeconds) ? ` · ${formatRuntime(selectedMovie.runtimeSeconds)}` : ""}{selectedMovie.categories?.length ? ` · ${selectedMovie.categories.join(" · ")}` : ""}</p></div><button type="button" autoFocus onClick={() => setSelectedMovie(null)} aria-label="Close movie details" className="cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-300">Close</button></div>
            {selectedMovie.thumbnail && <Image src={selectedMovie.thumbnail} alt="" width={960} height={540} unoptimized className="mt-4 aspect-video w-full rounded-xl bg-black object-cover" />}
            <p className="mt-4 whitespace-pre-line text-sm leading-6 text-zinc-300">{selectedMovie.description || "No description was supplied by the source catalog."}</p>
            <p className="mt-4 text-xs leading-5 text-zinc-400">Rights note: {selectedMovie.licenseInfo}</p>
            <p className="mt-2 text-xs text-zinc-500">Playback status: {selectedMovie.availabilityStatus}. Internet Archive catalog and uploader metadata are source claims, not a guarantee of worldwide rights or uninterrupted availability.</p>
            <div className="mt-4 flex flex-wrap gap-3"><a href={selectedMovie.sourcePageUrl} target="_blank" rel="noreferrer" className="cursor-pointer rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-200 underline">Source item</a><button type="button" onClick={() => { select(selectedMovie); setSelectedMovie(null); }} disabled={selectedMovie.availabilityStatus === "unavailable"} className="cursor-pointer rounded-lg border border-white/[0.12] bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">Watch in party</button></div>
          </section>
        </div>
      )}
    </section>
  );
}
