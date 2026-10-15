export function toPublicParty(party) {
  return {
    hostName: party.host_name,
    viewers: party.viewers,
    partyCode: party.party_code,
    videoUrls: party.video_urls,
    playlistVersion: party.playlist_version ?? 0,
  };
}
