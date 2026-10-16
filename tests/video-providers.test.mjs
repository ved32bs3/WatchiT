import test from "node:test";
import assert from "node:assert/strict";
import { classifyVideoUrl } from "../src/app/lib/video-providers.mjs";
import { normalizeVideoDetails } from "../src/app/lib/video-details.mjs";
import { createPlayerAdapter } from "../src/app/lib/player-adapter.mjs";

test("YouTube URL forms still classify to the official iframe player", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    "https://youtu.be/M7lc1UVf-VE",
    "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE",
  ]) {
    const source = classifyVideoUrl(url);
    assert.equal(source.provider, "youtube");
    assert.equal(source.playerType, "youtube-iframe");
    assert.equal(source.providerVideoId, "M7lc1UVf-VE");
    assert.equal(source.syncSupported, true);
  }
});

test("HTTPS direct media files and Internet Archive item/download URLs are classified", () => {
  const direct = classifyVideoUrl("https://cdn.example.org/film.mp4?token=opaque");
  assert.equal(direct.provider, "direct-file");
  assert.equal(direct.playerType, "html5-video");
  assert.equal(direct.syncSupported, true);
  assert.equal(classifyVideoUrl("https://archive.org/download/night-film/night.ia.mp4").playerType, "html5-video");

  const item = classifyVideoUrl("https://archive.org/details/night-film");
  assert.equal(item.provider, "internet-archive");
  assert.equal(item.playerType, "internet-archive-embed");
  assert.equal(item.syncSupported, false);
  assert.match(item.syncLimitation, /cross-origin playback clock/);
});

test("unsupported and private-network video URLs fail without server-side fetching", () => {
  for (const url of [
    "http://example.org/movie.mp4",
    "https://127.0.0.1/private.mp4",
    "https://localhost/movie.webm",
    "https://example.org/watch?v=anything",
    "javascript:alert(1)",
    "not a url",
  ]) assert.equal(typeof classifyVideoUrl(url).error, "string", url);
});

test("playlist metadata must match the classified URL and only accepts safe thumbnails", () => {
  const normalized = normalizeVideoDetails("https://archive.org/download/film/title.ia.mp4", {
    url: "https://archive.org/download/film/title.ia.mp4",
    id: "archive-item",
    title: "A film",
    thumbnail: "https://evil.example/image.jpg",
    releaseYear: 1925,
    categories: ["Feature Films"],
    sourcePageUrl: "https://archive.org/details/film",
    licenseInfo: "Curator supplied rights note",
    availabilityStatus: "reachable",
  });
  assert.equal(normalized.provider, "internet-archive");
  assert.equal(normalized.video_id, "internet-archive:film:title.ia.mp4");
  assert.equal(normalized.thumbnail, "");
  assert.equal(normalized.release_year, 1925);
  assert.equal(normalized.source_page_url, "https://archive.org/details/film");
});

test("common player adapter exposes time, duration, controls, status, readiness, and seek", async () => {
  const calls = [];
  const media = {
    currentTime: 12,
    duration: 180,
    playbackRate: 1,
    readyState: 4,
    paused: true,
    ended: false,
    error: null,
    async play() { calls.push("play"); this.paused = false; },
    pause() { calls.push("pause"); this.paused = true; },
  };
  const adapter = createPlayerAdapter(media, "html5");
  assert.equal(adapter.getCurrentTime(), 12);
  assert.equal(adapter.getDuration(), 180);
  assert.equal(adapter.getPlaybackState(), "paused");
  assert.equal(adapter.isReady(), true);
  adapter.seek(30);
  adapter.setPlaybackRate(1.25);
  await adapter.play();
  assert.equal(adapter.getCurrentTime(), 30);
  assert.equal(adapter.getPlaybackRate(), 1.25);
  assert.equal(adapter.getPlaybackState(), "playing");
  adapter.pause();
  assert.deepEqual(calls, ["play", "pause"]);

  const youtubeCalls = [];
  const youtube = createPlayerAdapter({
    getCurrentTime: () => 4,
    getDuration: () => 80,
    playVideo: () => youtubeCalls.push("play"),
    pauseVideo: () => youtubeCalls.push("pause"),
    seekTo: (seconds, allowSeekAhead) => youtubeCalls.push(["seek", seconds, allowSeekAhead]),
    setPlaybackRate: (rate) => youtubeCalls.push(["rate", rate]),
    getPlaybackRate: () => 1.5,
    getPlayerState: () => 1,
  }, "youtube");
  youtube.seek(10);
  youtube.setPlaybackRate(2);
  youtube.play();
  assert.equal(youtube.getPlaybackState(), "playing");
  assert.equal(youtube.getDuration(), 80);
  assert.deepEqual(youtubeCalls, [["seek", 10, true], ["rate", 2], "play"]);
});

test("switching between YouTube and direct media retains the shared playback contract", () => {
  const youtubePlayer = {
    getCurrentTime: () => 4,
    getDuration: () => 80,
    playVideo() {},
    pauseVideo() {},
    seekTo() {},
    setPlaybackRate() {},
    getPlaybackRate: () => 1,
    getPlayerState: () => 1,
  };
  const html5Player = {
    currentTime: 10,
    duration: 100,
    playbackRate: 1,
    readyState: 4,
    paused: false,
    ended: false,
    error: null,
    play() {},
    pause() {},
  };
  const selectedUrls = [
    "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    "https://archive.org/download/feature-film/film.mp4",
    "https://youtu.be/M7lc1UVf-VE",
  ];
  const adapters = selectedUrls.map((url) => {
    const source = classifyVideoUrl(url);
    assert.equal(source.error, undefined);
    return source.playerType === "youtube-iframe"
      ? createPlayerAdapter(youtubePlayer, "youtube")
      : createPlayerAdapter(html5Player, "html5");
  });
  assert.deepEqual(adapters.map((adapter) => adapter.provider), ["youtube", "html5", "youtube"]);
  for (const adapter of adapters) {
    assert.equal(typeof adapter.getCurrentTime, "function");
    assert.equal(typeof adapter.getDuration, "function");
    assert.equal(typeof adapter.play, "function");
    assert.equal(typeof adapter.pause, "function");
    assert.equal(typeof adapter.seek, "function");
    assert.equal(typeof adapter.setPlaybackRate, "function");
    assert.equal(typeof adapter.isReady, "function");
  }
  assert.equal(createPlayerAdapter({}, "internet-archive"), null);
});
