const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "youtube-nocookie.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const DIRECT_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogv", "ogg"]);

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host.endsWith(".internal") || host === "0.0.0.0" || host === "::" || host === "::1" ||
    host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")
  ) return true;

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19));
}

function classifyYouTube(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let id = "";
  if (host === "youtu.be") id = parts[0] ?? "";
  else if (YOUTUBE_HOSTS.has(host)) {
    id = url.searchParams.get("v") || (["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : "");
  } else return null;
  if (!YOUTUBE_ID.test(id)) return { error: "That YouTube URL does not contain a valid video ID." };
  return {
    provider: "youtube",
    playerType: "youtube-iframe",
    id: `youtube:${id}`,
    providerVideoId: id,
    playbackUrl: `https://www.youtube.com/watch?v=${id}`,
    syncSupported: true,
  };
}

export function classifyVideoUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    return { error: "Enter a supported HTTPS video URL under 2,048 characters." };
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { error: "Enter a valid video URL." };
  }
  if (url.protocol !== "https:" || url.username || url.password || isPrivateHost(url.hostname) || (url.port && url.port !== "443")) {
    return { error: "Use a public HTTPS video URL without embedded credentials or a private network address." };
  }

  const youtube = classifyYouTube(url);
  if (youtube) return youtube;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "archive.org" || host === "www.archive.org") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "details" && /^[A-Za-z0-9._-]{1,120}$/.test(parts[1] ?? "")) {
      const identifier = parts[1];
      return {
        provider: "internet-archive",
        playerType: "internet-archive-embed",
        id: `internet-archive:${identifier}`,
        providerVideoId: identifier,
        playbackUrl: `https://archive.org/embed/${encodeURIComponent(identifier)}`,
        syncSupported: false,
        syncLimitation: "The Internet Archive embed does not expose a supported cross-origin playback clock to this app.",
      };
    }
    if (parts[0] === "download" && /^[A-Za-z0-9._-]{1,120}$/.test(parts[1] ?? "")) {
      const extension = parts[2]?.split(".").at(-1)?.toLowerCase();
      if (DIRECT_VIDEO_EXTENSIONS.has(extension)) {
        return {
          provider: "internet-archive",
          playerType: "html5-video",
          id: `internet-archive:${parts[1]}:${parts.slice(2).join("/")}`,
          providerVideoId: parts[1],
          playbackUrl: url.href,
          syncSupported: true,
        };
      }
      return { error: "Use a direct MP4, WebM, OGV, or OGG file from the Internet Archive, or open its item page." };
    }
  }

  const extension = url.pathname.split(".").at(-1)?.toLowerCase();
  if (DIRECT_VIDEO_EXTENSIONS.has(extension)) {
    return {
      provider: "direct-file",
      playerType: "html5-video",
      id: `direct:${url.origin}${url.pathname}`,
      providerVideoId: null,
      playbackUrl: url.href,
      syncSupported: true,
    };
  }

  return { error: "This provider or link format is not supported. Use a YouTube URL, an Internet Archive item/direct video URL, or a direct MP4/WebM/OGV/OGG file." };
}

export function getVideoTitleFallback(video) {
  return video?.provider === "youtube" ? `YouTube video ${video.providerVideoId}` : "Shared movie";
}
