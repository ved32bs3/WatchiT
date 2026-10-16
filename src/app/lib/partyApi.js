async function postJson(path, payload) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Could not reach the party service. Check that the app is running and try again.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "The party request could not be completed.");
  }
  if (data.sessionToken && data.partyCode && typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(`watchit:party:${data.partyCode}`, data.sessionToken);
    } catch {
      throw new Error("This browser could not save the party session for this tab. Allow session storage and try again.");
    }
  }
  return data;
}

export function createParty({ hostName, videoUrl, videoDetails }) {
  return postJson("/api/parties", { hostName, videoUrl, videoDetails });
}

export function joinParty({ name, partyCode }) {
  return postJson("/api/parties/join", { name, partyCode: Number(partyCode) });
}

export function authenticatedPartyRequest(partyCode, path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (typeof window !== "undefined") {
    try {
      const token = window.sessionStorage.getItem(`watchit:party:${partyCode}`);
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch {
      // The API responds without a participant role if this tab cannot access storage.
    }
  }
  return fetch(path, { ...options, headers });
}

export function partyRequest(partyCode, options = {}) {
  return authenticatedPartyRequest(partyCode, `/api/parties/${partyCode}`, options);
}

export function clearPartySession(partyCode) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`watchit:party:${partyCode}`);
  } catch {
    // Leaving the room still succeeds if this tab's storage is unavailable.
  }
}

export function chatRequest(partyCode, options = {}) {
  return authenticatedPartyRequest(partyCode, `/api/chats/${partyCode}`, options);
}

export function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id ?? "") ? id : null;
    }

    if (!["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const id = url.searchParams.get("v") || (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" ? parts[1] : "");
    return /^[A-Za-z0-9_-]{11}$/.test(id ?? "") ? id : null;
  } catch {
    return null;
  }
}
