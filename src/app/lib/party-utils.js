export function toPublicParty(party) {
  return {
    hostName: party.host_name,
    viewers: party.viewers,
    partyCode: party.party_code,
    videoUrls: party.video_urls,
    videoDetails: (party.video_details ?? []).map((video) => ({
      url: video.url,
      id: video.video_id,
      title: video.title,
      thumbnail: video.thumbnail,
      channelName: video.channel_name,
      provider: video.provider ?? "youtube",
      playerType: video.player_type ?? "youtube-iframe",
      releaseYear: video.release_year ?? null,
      categories: video.categories ?? [],
      sourcePageUrl: video.source_page_url ?? "",
      licenseInfo: video.license_info ?? "",
      availabilityStatus: video.availability_status ?? "unknown",
    })),
    playlistVersion: party.playlist_version ?? 0,
  };
}
