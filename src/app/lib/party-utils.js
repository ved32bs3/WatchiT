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
    })),
    playlistVersion: party.playlist_version ?? 0,
  };
}
