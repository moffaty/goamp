use lofty::prelude::*;
use lofty::probe::Probe;
use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone)]
pub struct TrackMeta {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub duration: f64,
}

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "wav", "opus", "m4a", "aac", "wma"];

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn read_track_meta(path: &Path) -> TrackMeta {
    let path_str = path.to_string_lossy().to_string();

    let (title, artist, album, genre, duration) =
        match Probe::open(path).and_then(|probe| probe.read()) {
            Ok(tagged_file) => {
                let tag = tagged_file
                    .primary_tag()
                    .or_else(|| tagged_file.first_tag());
                let props = tagged_file.properties();
                let duration_secs = props.duration().as_secs_f64();

                let title = tag.and_then(|t| t.title().map(|s| s.to_string()));
                let artist = tag.and_then(|t| t.artist().map(|s| s.to_string()));
                let album = tag.and_then(|t| t.album().map(|s| s.to_string()));
                let genre = tag.and_then(|t| t.genre().map(|s| s.to_string()));

                (title, artist, album, genre, duration_secs)
            }
            Err(_) => (None, None, None, None, 0.0),
        };

    let fallback_title = title.clone().unwrap_or_else(|| {
        path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone())
    });

    TrackMeta {
        path: path_str,
        title: Some(fallback_title),
        artist,
        album,
        genre,
        duration,
    }
}

#[tauri::command]
pub fn scan_directory(path: String) -> Result<Vec<TrackMeta>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut tracks: Vec<TrackMeta> = WalkDir::new(dir)
        .follow_links(false)
        .max_depth(20)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_audio_file(e.path()))
        .map(|e| read_track_meta(e.path()))
        .collect();

    tracks.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(tracks)
}

#[tauri::command]
pub fn read_metadata(path: String) -> Result<TrackMeta, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    Ok(read_track_meta(p))
}
