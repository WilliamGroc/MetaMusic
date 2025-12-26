export interface Album {
  id: string;
  title: string;
}

export interface Track {
  id: string;
  title: string;
  bpm?: number | string;
  /** duration in milliseconds as provided by Spotify (optional) */
  durationMs?: number;
  artist: {
    id: string;
    name: string;
  };
  album: Album;
}
