export const MAX_PLAYLIST_ITEMS = 50;

export function isExactPlaylistPermutation(currentUrls, requestedUrls) {
  if (!Array.isArray(currentUrls) || !Array.isArray(requestedUrls)) return false;
  if (currentUrls.length !== requestedUrls.length || currentUrls.length === 0) return false;
  if (currentUrls.some((url) => typeof url !== "string") || requestedUrls.some((url) => typeof url !== "string")) return false;

  const current = new Set(currentUrls);
  const requested = new Set(requestedUrls);
  return current.size === currentUrls.length &&
    requested.size === requestedUrls.length &&
    current.size === requested.size &&
    [...current].every((url) => requested.has(url));
}

export function movePlaylistItem(urls, fromIndex, toIndex) {
  if (!Array.isArray(urls) || urls.length < 2) return null;
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return null;
  if (fromIndex < 0 || fromIndex >= urls.length || toIndex < 0 || toIndex >= urls.length) return null;
  if (fromIndex === toIndex) return [...urls];

  const reordered = [...urls];
  const [item] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, item);
  return reordered;
}
