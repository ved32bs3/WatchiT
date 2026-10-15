"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import VideoSearch from "./components/VideoSearch";
import { createParty, getYouTubeVideoId, joinParty } from "./lib/partyApi";

const fieldClass = "mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20";
const submitClass = "mt-5 min-h-12 w-full rounded-xl bg-rose-500 px-5 text-sm font-semibold text-white transition hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-wait disabled:opacity-60";

export default function Home() {
  const router = useRouter();
  const [hostName, setHostName] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [viewerName, setViewerName] = useState("");
  const [partyCode, setPartyCode] = useState("");
  const [showVideoSearch, setShowVideoSearch] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [hostError, setHostError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [hostSuccess, setHostSuccess] = useState("");
  const [joinSuccess, setJoinSuccess] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const videoId = selectedVideo?.id || getYouTubeVideoId(videoUrl.trim());
  const playerSrc = videoId
    ? `https://www.youtube.com/embed/${videoId}?${new URLSearchParams({ enablejsapi: "1", origin: typeof window === "undefined" ? "" : window.location.origin })}`
    : null;

  async function handleCreateParty(event) {
    event.preventDefault();
    setHostError("");
    setHostSuccess("");

    const normalizedName = hostName.trim();
    const normalizedUrl = videoUrl.trim();
    if (!normalizedName) return setHostError("Enter your name to host the party.");
    if (normalizedName.length > 40) return setHostError("Your name must be 40 characters or fewer.");
    if (!getYouTubeVideoId(normalizedUrl)) {
      return setHostError("Enter a valid YouTube video URL or choose a video from search.");
    }

    setIsCreating(true);
    try {
      const result = await createParty({ hostName: normalizedName, videoUrl: normalizedUrl });
      router.push(`/party/${result.partyCode}`);
    } catch (error) {
      setHostError(error.message);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleJoinParty(event) {
    event.preventDefault();
    setJoinError("");
    setJoinSuccess("");

    const normalizedName = viewerName.trim();
    if (!normalizedName) return setJoinError("Enter your name to join the party.");
    if (normalizedName.length > 40) return setJoinError("Your name must be 40 characters or fewer.");
    if (!/^\d{6}$/.test(partyCode)) return setJoinError("Enter the six-digit party code.");

    setIsJoining(true);
    try {
      const result = await joinParty({ name: normalizedName, partyCode });
      router.push(`/party/${result.partyCode}`);
    } catch (error) {
      setJoinError(error.message);
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <main className="min-h-screen flex-1 bg-[#09090b] px-5 py-8 text-white sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-14 flex items-center justify-between border-b border-white/10 pb-5">
          <Link href="/" className="text-lg font-bold tracking-tight text-white">
            watch<span className="text-rose-400">it</span>
          </Link>
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400">Watch together</span>
        </header>

        <section className="mb-10 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-300">Your movie night starts here</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Pick a seat. Press play together.</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400">Start a room for your friends, or join one with a six-digit party code.</p>
        </section>

        <section aria-label="Create or join a watch party" className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-rose-400/20 bg-gradient-to-br from-rose-400/[0.08] to-white/[0.025] p-5 sm:p-7">
            <div className="mb-6 flex items-start gap-4">
              <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-rose-400/15 text-lg text-rose-200">▶</span>
              <div>
                <h2 className="text-xl font-semibold text-white">Host a party</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-400">Choose the first video and invite everyone with your party code.</p>
              </div>
            </div>

            <form onSubmit={handleCreateParty} noValidate>
              <label htmlFor="host-name" className="text-sm font-medium text-zinc-200">Your name</label>
              <input id="host-name" name="hostName" autoComplete="name" maxLength={40} required value={hostName} onChange={(event) => setHostName(event.target.value)} placeholder="e.g. Alex" className={fieldClass} aria-describedby="host-name-hint" />
              <p id="host-name-hint" className="mt-1.5 text-xs text-zinc-500">This is how you’ll appear to viewers.</p>

              <div className="mt-5 flex items-center justify-between gap-3">
                <label htmlFor="initial-video" className="text-sm font-medium text-zinc-200">First video URL</label>
                <button type="button" onClick={() => setShowVideoSearch((visible) => !visible)} aria-expanded={showVideoSearch} aria-controls="host-video-search" className="text-xs font-medium text-rose-300 underline decoration-rose-300/40 underline-offset-4 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
                  {showVideoSearch ? "Hide video search" : "Search movie videos"}
                </button>
              </div>
              <input id="initial-video" name="videoUrl" type="url" inputMode="url" required value={videoUrl} onChange={(event) => { setVideoUrl(event.target.value); setSelectedVideo(null); }} placeholder="https://www.youtube.com/watch?v=..." className={fieldClass} aria-describedby="video-url-hint" />
              <p id="video-url-hint" className="mt-1.5 text-xs text-zinc-500">Paste a YouTube URL or choose a result below.</p>

              {hostError && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm leading-5 text-rose-200">{hostError}</p>}
              {hostSuccess && <p role="status" className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm leading-5 text-emerald-200">{hostSuccess}</p>}
              <button type="submit" disabled={isCreating} className={submitClass}>{isCreating ? "Creating party…" : "Create party"}</button>
            </form>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
            <div className="mb-6 flex items-start gap-4">
              <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-lg text-zinc-200">↗</span>
              <div>
                <h2 className="text-xl font-semibold text-white">Join a party</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-400">Enter the name your friends will see and the code from your host.</p>
              </div>
            </div>

            <form onSubmit={handleJoinParty} noValidate>
              <label htmlFor="viewer-name" className="text-sm font-medium text-zinc-200">Your name</label>
              <input id="viewer-name" name="name" autoComplete="name" maxLength={40} required value={viewerName} onChange={(event) => setViewerName(event.target.value)} placeholder="e.g. Sam" className={fieldClass} aria-describedby="viewer-name-hint" />
              <p id="viewer-name-hint" className="mt-1.5 text-xs text-zinc-500">Use a name your friends will recognize.</p>

              <label htmlFor="party-code" className="mt-5 block text-sm font-medium text-zinc-200">Six-digit party code</label>
              <input id="party-code" name="partyCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={partyCode} onChange={(event) => setPartyCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className={`${fieldClass} font-mono tracking-[0.25em]`} aria-describedby="party-code-hint" />
              <p id="party-code-hint" className="mt-1.5 text-xs text-zinc-500">The code has exactly six numbers.</p>

              {joinError && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm leading-5 text-rose-200">{joinError}</p>}
              {joinSuccess && <p role="status" className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm leading-5 text-emerald-200">{joinSuccess}</p>}
              <button type="submit" disabled={isJoining} className={`${submitClass} bg-white/[0.09] hover:bg-white/[0.14]`}>{isJoining ? "Joining party…" : "Join party"}</button>
            </form>
          </div>
        </section>

        {showVideoSearch && (
          <section id="host-video-search" className="mt-12 border-t border-white/10 pt-9" aria-labelledby="video-discovery-heading">
            {videoId && (
              <div className="mb-8 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/40">
                <iframe key={videoId} src={playerSrc} title={selectedVideo?.title || "Initial video preview"} className="aspect-video w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="origin" allowFullScreen />
                {selectedVideo?.title && <p className="px-4 py-3 text-sm font-medium text-white">{selectedVideo.title}</p>}
              </div>
            )}
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Host picks</p>
              <h2 id="video-discovery-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Browse movie recommendations</h2>
              <p className="mt-2 text-sm text-zinc-400">Choose a result to load it in the player and add its URL to the host form.</p>
            </div>
            <VideoSearch
              isHost
              onSelectVideo={(url, video) => {
                setVideoUrl(url);
                setSelectedVideo({ id: video.id, title: video.title });
                setHostError("");
              }}
            />
          </section>
        )}

        <footer className="mt-14 border-t border-white/10 pt-5 text-xs leading-5 text-zinc-500">
          Video search is provided by YouTube. Create a party as host or join one with its six-digit code.
        </footer>
      </div>
    </main>
  );
}
