export function createPlayerAdapter(player, provider) {
  if (!player) return null;
  if (provider === "youtube") {
    return {
      provider,
      getCurrentTime: () => player.getCurrentTime(),
      getDuration: () => player.getDuration(),
      play: () => player.playVideo(),
      pause: () => player.pauseVideo(),
      seek: (seconds) => player.seekTo(seconds, true),
      seekTo: (seconds) => player.seekTo(seconds, true),
      setPlaybackRate: (rate) => player.setPlaybackRate(rate),
      getPlaybackRate: () => player.getPlaybackRate(),
      getNativePlaybackState: () => player.getPlayerState(),
      getPlaybackState() {
        const state = player.getPlayerState();
        return state === 1 ? "playing" : state === 2 ? "paused" : state === 3 ? "buffering" : state === 0 ? "ended" : "unavailable";
      },
      isReady: () => player.getPlayerState() !== -1,
    };
  }
  if (provider === "html5" || provider === "direct-file") {
    const state = () => player.error ? "unavailable" : player.ended ? "ended" : !player.paused && player.readyState < 3 ? "buffering" : player.paused ? "paused" : "playing";
    return {
      provider,
      getCurrentTime: () => player.currentTime,
      getDuration: () => player.duration,
      play: () => player.play(),
      pause: () => player.pause(),
      seek(seconds) { player.currentTime = seconds; },
      seekTo(seconds) { player.currentTime = seconds; },
      setPlaybackRate: (rate) => { player.playbackRate = rate; },
      getPlaybackRate: () => player.playbackRate,
      getPlaybackState: state,
      getNativePlaybackState: () => ({ playing: 1, paused: 2, buffering: 3, ended: 0, unavailable: -1 })[state()],
      isReady: () => !player.error && player.readyState >= 1,
    };
  }
  return null;
}
