import axios from 'axios';
import { createObjectCsvWriter } from 'csv-writer';
import { Track } from './types';
import dotenv from 'dotenv';

dotenv.config();

// Remplace par l'ID (string) de ta playlist publique Spotify
const PLAYLIST_ID = process.env.SPOTIFY_PLAYLIST_ID || '';

// Chemin du fichier CSV de sortie
const OUTPUT_FILE = 'spotify_playlist_analysis.csv';

// Récupère le token Spotify depuis la variable d'environnement
const SPOTIFY_TOKEN = process.env.SPOTIFY_TOKEN;
if (!SPOTIFY_TOKEN) {
  console.error('Please set the SPOTIFY_TOKEN environment variable (Bearer token).');
  process.exit(1);
}

const axiosSpotify = axios.create({
  headers: {
    Authorization: `Bearer ${SPOTIFY_TOKEN}`,
  },
});

// Récupère tous les tracks d'une playlist Spotify (pagination)
async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const tracks: Track[] = [];
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

  while (url) {
    const response = await axiosSpotify.get(url);
    const data = response.data;
    for (const item of data.items) {
      const t = item.track;
      if (!t) continue;
      const mapped: Track = {
        id: t.id,
        title: t.name,
        durationMs: t.duration_ms,
        artist: {
          id: t.artists && t.artists[0] ? t.artists[0].id : 'unknown',
          name: t.artists && t.artists[0] ? t.artists[0].name : 'Inconnu',
        },
        album: {
          id: t.album ? t.album.id : 'unknown',
          title: t.album ? t.album.name : 'Inconnu',
        },
      };
      tracks.push(mapped);
    }
    url = data.next; // Spotify returns full URL in `next`
  }

  return tracks;
}

// TheAudioDB API key (default '1' public key)
const THEAUDIODB_API_KEY = process.env.THEAUDIODB_API_KEY || '1';

// Récupère le genre via TheAudioDB en recherchant l'artiste par nom
async function getGenreFromAudioDB(artistName: string): Promise<string> {
  try {
    const url = `https://theaudiodb.com/api/v1/json/${THEAUDIODB_API_KEY}/search.php?s=${encodeURIComponent(
      artistName,
    )}`;
    const response = await axios.get(url);
    if (response.data && response.data.artists && response.data.artists[0] && response.data.artists[0].strGenre) {
      return response.data.artists[0].strGenre as string;
    }
    return 'Inconnu';
  } catch (e) {
    console.error(`Erreur lors de la récupération du genre pour l'artiste ${artistName}:`, e);
    return 'Inconnu';
  }
}

// Récupère le BPM via TheAudioDB en recherchant la piste par artiste + titre
async function getTrackBpmFromAudioDB(artistName: string, trackTitle: string): Promise<number | undefined> {
  try {
    const url = `https://theaudiodb.com/api/v1/json/${THEAUDIODB_API_KEY}/searchtrack.php?s=${encodeURIComponent(
      artistName,
    )}&t=${encodeURIComponent(trackTitle)}`;
    const response = await axios.get(url);
    if (response.data && response.data.track && response.data.track[0] && response.data.track[0].intTempo) {
      const tempo = response.data.track[0].intTempo;
      const n = Number(tempo);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  } catch (e) {
    console.error(`Erreur lors de la récupération du BPM pour le titre ${trackTitle} de l'artiste ${artistName}:`, e);
    return undefined;
  }
}

// Récupère le genre depuis Spotify (via artist id)
async function getGenreFromSpotifyById(artistId: string): Promise<string> {
  try {
    if (!artistId || artistId === 'unknown') return 'Inconnu';
    const url = `https://api.spotify.com/v1/artists/${artistId}`;
    const response = await axiosSpotify.get(url);
    const genres: string[] = response.data && response.data.genres ? response.data.genres : [];
    return genres.length > 0 ? genres[0] : 'Inconnu';
  } catch (e) {
    console.error(`Erreur lors de la récupération du genre depuis Spotify pour artistId ${artistId}:`, e);
    return 'Inconnu';
  }
}

// Essaye TheAudioDB puis Spotify si TheAudioDB n'a rien
async function getGenreWithFallback(artistName: string, artistId?: string): Promise<string> {
  const fromAudioDB = await getGenreFromAudioDB(artistName);
  if (fromAudioDB && fromAudioDB !== 'Inconnu') return fromAudioDB;
  if (artistId) {
    const fromSpotify = await getGenreFromSpotifyById(artistId);
    if (fromSpotify && fromSpotify !== 'Inconnu') return fromSpotify;
  }
  return 'Inconnu';
}

// Fonction principale
async function analyzePlaylist() {
  if (!PLAYLIST_ID) {
    console.error('Please set SPOTIFY_PLAYLIST_ID environment variable to the playlist ID.');
    process.exit(1);
  }

  try {
    const tracks = await getPlaylistTracks(PLAYLIST_ID);
    const csvWriter = createObjectCsvWriter({
      path: OUTPUT_FILE,
      header: [
        { id: 'title', title: 'Titre' },
        { id: 'artist', title: 'Artiste' },
        { id: 'album', title: 'Album' },
        { id: 'genre', title: 'Genre' },
        { id: 'duration', title: 'Durée' },
        { id: 'duration_seconds', title: 'Durée (s)' },
      ],
    });

    console.log(`Analyse de la playlist Spotify ID: ${PLAYLIST_ID} avec ${tracks.length} titres...`);

    const records: Array<{ title: string; artist: string; album: string; genre: string; duration: string; duration_seconds: number | string }>
      = [];

    function formatDurationMs(ms?: number): string {
      if (!ms || !Number.isFinite(ms)) return 'Inconnu';
      const totalSec = Math.floor(ms / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    for (const track of tracks) {
      const artistName = track.artist.name || 'Inconnu';
      const artistId = track.artist.id || undefined;
      const genreName = await getGenreWithFallback(artistName, artistId);
      // Pause 1 seconde entre chaque appel pour éviter de surcharger l'API
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const durationSeconds = track.durationMs && Number.isFinite(track.durationMs) ? Math.floor(track.durationMs / 1000) : undefined;
      records.push({
        title: track.title,
        artist: track.artist.name,
        album: track.album.title,
        genre: genreName,
        duration: formatDurationMs(track.durationMs),
        duration_seconds: durationSeconds ?? '',
      });
    }

    // Trier les enregistrements par genre (insensible à la casse), puis par artiste puis par titre
    records.sort((a, b) => {
      const ga = (a.genre || '').toLowerCase();
      const gb = (b.genre || '').toLowerCase();
      if (ga < gb) return -1;
      if (ga > gb) return 1;
      const aa = (a.artist || '').toLowerCase();
      const ab = (b.artist || '').toLowerCase();
      if (aa < ab) return -1;
      if (aa > ab) return 1;
      const ta = (a.title || '').toLowerCase();
      const tb = (b.title || '').toLowerCase();
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return 0;
    });

    await csvWriter.writeRecords(records);
    console.log(`Analyse terminée ! Les résultats sont dans ${OUTPUT_FILE}`);
  } catch (error) {
    console.error("Erreur lors de l'analyse de la playlist:", error);
  }
}

// Exécuter le script
analyzePlaylist();
