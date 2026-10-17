"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import VideoSearch from "./components/VideoSearch";
import MovieRecommendations from "./components/MovieRecommendations";
import { createParty, joinParty } from "./lib/partyApi";
import { classifyVideoUrl } from "./lib/video-providers.mjs";

const fieldClass = "mt-2 min-h-12 w-full rounded-lg border border-white/[0.08] bg-zinc-950/70 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-rose-300/50 focus:ring-2 focus:ring-rose-300/10";
const submitClass = "mt-5 min-h-12 w-full cursor-pointer rounded-lg bg-rose-500 px-5 text-sm font-semibold text-white transition hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60";

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
  const previewRef = useRef(null);

  const videoSource = classifyVideoUrl(videoUrl.trim());
  const videoId = videoSource.error ? "" : videoSource.id;
  const playerSrc = videoSource.provider === "youtube"
    ? `https://www.youtube.com/embed/${videoSource.providerVideoId}?${new URLSearchParams({ enablejsapi: "1", origin: typeof window === "undefined" ? "" : window.location.origin })}`
    : videoSource.provider === "internet-archive" ? videoSource.playbackUrl : null;

  useEffect(() => {
    if (!selectedVideo) return;
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    previewRef.current?.focus({ preventScroll: true });
  }, [selectedVideo]);

  async function handleCreateParty(event) {
    event.preventDefault();
    setHostError("");
    setHostSuccess("");

    const normalizedName = hostName.trim();
    const normalizedUrl = videoUrl.trim();
    if (!normalizedName) return setHostError("Enter your name to host the party.");
    if (normalizedName.length > 40) return setHostError("Your name must be 40 characters or fewer.");
    const source = classifyVideoUrl(normalizedUrl);
    if (source.error) {
      return setHostError(source.error);
    }

    setIsCreating(true);
    try {
      const result = await createParty({
        hostName: normalizedName,
        videoUrl: normalizedUrl,
        videoDetails: selectedVideo,
      });
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
          <Link href="/" className="inline-flex cursor-pointer items-center gap-2 text-xl font-bold tracking-tight text-white">
            <Image src="/logo.png" alt="" width={40} height={40} className="size-10 object-contain" />
            <span>Watch<span className="text-rose-400">iT</span></span>
          </Link>
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400">Watch together</span>
        </header>

        <section className="mb-10 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-300">Your movie night starts here</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Pick a seat. Press play together.</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400">Start a room for your friends, or join one with a six-digit party code.</p>
        </section>

        <section aria-label="Create or join a watch party" className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-white/[0.07] border-t-2 border-t-rose-400/50 bg-gradient-to-br from-rose-400/[0.055] to-white/[0.015] p-5 sm:p-7">
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
                <button type="button" onClick={() => setShowVideoSearch((visible) => !visible)} aria-expanded={showVideoSearch} aria-controls="host-video-search" className="cursor-pointer text-xs font-medium text-rose-300 underline decoration-rose-300/40 underline-offset-4 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
                  {showVideoSearch ? "Hide video recommendations" : "Browse videos & free movies"}
                </button>
              </div>
              <input id="initial-video" name="videoUrl" type="url" inputMode="url" required value={videoUrl} onChange={(event) => { setVideoUrl(event.target.value); setSelectedVideo(null); }} placeholder="YouTube, Internet Archive, or direct MP4/WebM URL" className={fieldClass} aria-describedby="video-url-hint" />
              <p id="video-url-hint" className="mt-1.5 text-xs text-zinc-500">Use a supported YouTube or Internet Archive URL, or a direct MP4/WebM file URL.</p>

              {hostError && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm leading-5 text-rose-200">{hostError}</p>}
              {hostSuccess && <p role="status" className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm leading-5 text-emerald-200">{hostSuccess}</p>}
              <button type="submit" disabled={isCreating} className={submitClass}>{isCreating ? "Creating party…" : "Create party"}</button>
            </form>
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5 sm:p-7">
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
              <div ref={previewRef} tabIndex={-1} className="mb-8 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
                {videoSource.playerType === "html5-video" ? <video key={videoId} src={videoSource.playbackUrl} controls playsInline preload="metadata" className="aspect-video w-full" /> : <iframe key={videoId} src={playerSrc} title={selectedVideo?.title || "Initial video preview"} className="aspect-video w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="origin" allowFullScreen />}
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
                setSelectedVideo(video);
                setHostError("");
              }}
            />
            <div className="mt-12 border-t border-white/10 pt-9">
              <MovieRecommendations onSelectMovie={(url, movie) => { setVideoUrl(url); setSelectedVideo(movie); setHostError(""); }} />
            </div>
          </section>
        )}

        <footer className="mt-14 border-t border-white/10 pt-5 text-xs leading-5 text-zinc-500">
          YouTube search and a curated Internet Archive movie catalog are available. Create a party as host or join one with its six-digit code.
        </footer>
      </div>
    </main>
  );
}
