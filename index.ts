import axios from 'axios';
import { createObjectCsvWriter } from 'csv-writer';
import { Track } from './types';
import dotenv from 'dotenv';

dotenv.config();

// Remplace par l'ID (string) de ta playlist publique Deezer
const PLAYLIST_ID = process.env.DEEZER_PLAYLIST_ID || '';

// Chemin du fichier CSV de sortie
const OUTPUT_FILE = 'deezer_playlist_analysis.csv';

// Récupère tous les tracks d'une playlist Deezer (pagination)
async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const url = `https://api.deezer.com/playlist/${playlistId}/tracks?limit=1000`;
  console.log(`Récupération des titres depuis Deezer: ${url}`);

  const response = await axios.get(url);
  const data = response.data;

  console.log(`Récupéré ${data.data.length} titres de la playlist.`);
  return data.data;
}

// TheAudioDB API key (default '1' public key)
const THEAUDIODB_API_KEY = process.env.THEAUDIODB_API_KEY || '1';

// Cache pour éviter de récupérer plusieurs fois les mêmes albums
const albumCache = new Map<number, any>();

// Récupère les informations d'un album depuis Deezer (incluant les genres)
async function getDeezerAlbumInfo(albumId: number): Promise<{ genres: string[] }> {
  if (albumCache.has(albumId)) {
    return albumCache.get(albumId);
  }

  try {
    const url = `https://api.deezer.com/album/${albumId}`;
    const response = await axios.get(url);
    const genres: string[] = [];

    if (response.data?.genres?.data) {
      for (const genre of response.data.genres.data) {
        if (genre.name) {
          genres.push(genre.name);
        }
      }
    }

    const result = { genres };
    albumCache.set(albumId, result);
    return result;
  } catch (e) {
    console.error(`Erreur lors de la récupération de l'album ${albumId}:`, e);
    return { genres: [] };
  }
}

// Récupère des informations supplémentaires depuis TheAudioDB (BPM et genre en fallback)
async function getAudioDBInfo(artistName: string, trackTitle: string): Promise<{ genre: string; bpm?: number }> {
  const info = { genre: 'Inconnu' };

  // Récupère le genre de l'artiste (utilisé comme fallback si Deezer n'a pas de genre)
  try {
    const artistUrl = `https://theaudiodb.com/api/v1/json/${THEAUDIODB_API_KEY}/search.php?s=${encodeURIComponent(artistName)}`;
    const artistResponse = await axios.get(artistUrl);
    if (artistResponse.data?.artists?.[0]?.strGenre) {
      info.genre = artistResponse.data.artists[0].strGenre;
    }
  } catch (e) {
    console.error(`Erreur lors de la récupération du genre pour ${artistName}:`, e);
  }

  return info;
}

// Fonction principale
async function analyzePlaylist() {
  if (!PLAYLIST_ID) {
    console.error('Please set DEEZER_PLAYLIST_ID environment variable to the playlist ID.');
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
        { id: 'duration_seconds', title: 'Durée (s)' },
        { id: 'duration', title: 'Durée' },
      ],
    });

    console.log(`Analyse de la playlist Deezer ID: ${PLAYLIST_ID} avec ${tracks.length} titres...`);

    const records: Array<{
      title: string;
      artist: string;
      album: string;
      genre: string;
      duration: string;
      duration_seconds: number | string;
    }> = [];

    function formatDuration(seconds?: number): string {
      if (!seconds || !Number.isFinite(seconds)) return 'Inconnu';
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    for (const track of tracks) {
      const artistName = track.artist?.name || 'Inconnu';
      const trackTitle = track.title || 'Inconnu';
      const albumId = track.album?.id;

      // Récupère le genre depuis Deezer (via l'album)
      let genreName = 'Inconnu';

      if (albumId) {
        const albumInfo = await getDeezerAlbumInfo(albumId);
        if (albumInfo.genres.length > 0) {
          genreName = albumInfo.genres.join(', ');
        }
      }

      // Si Deezer n'a pas de genre, utilise TheAudioDB comme fallback
      if (genreName === 'Inconnu') {
        const audioDBInfo = await getAudioDBInfo(artistName, trackTitle);
        genreName = audioDBInfo.genre;
        // Pause 1 seconde entre chaque appel pour éviter de surcharger l'API
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      records.push({
        title: trackTitle,
        artist: artistName,
        album: track.album?.title || 'Inconnu',
        genre: genreName,
        duration: formatDuration(track.duration),
        duration_seconds: track.duration ?? '',
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
    console.error("Erreur lors de l'analyse de la playlist:", (error as Error).message);
  }
}

// Exécuter le script
analyzePlaylist();
