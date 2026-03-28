import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  scanDirectory,
  readMetadata,
  createPlaylist,
  listPlaylists,
  getPlaylistTracks,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  deletePlaylist,
  saveSession,
  loadSession,
  renameTrack,
  updateTrackSource,
} from "./tauri-ipc";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("scanDirectory", () => {
  it("calls invoke with correct command and args", async () => {
    mockInvoke.mockResolvedValue([]);
    await scanDirectory("/music");
    expect(mockInvoke).toHaveBeenCalledWith("scan_directory", { path: "/music" });
  });

  it("returns track metadata array", async () => {
    const tracks = [
      { path: "/music/song.mp3", title: "Song", artist: "Artist", album: null, duration: 180 },
    ];
    mockInvoke.mockResolvedValue(tracks);
    const result = await scanDirectory("/music");
    expect(result).toEqual(tracks);
  });
});

describe("readMetadata", () => {
  it("calls invoke with correct command", async () => {
    mockInvoke.mockResolvedValue({ path: "/a.mp3", title: "A", artist: null, album: null, duration: 60 });
    await readMetadata("/a.mp3");
    expect(mockInvoke).toHaveBeenCalledWith("read_metadata", { path: "/a.mp3" });
  });
});

describe("playlist CRUD", () => {
  it("createPlaylist calls correct command", async () => {
    mockInvoke.mockResolvedValue({ id: "1", name: "My PL", created_at: 0, updated_at: 0, track_count: 0 });
    const result = await createPlaylist("My PL");
    expect(mockInvoke).toHaveBeenCalledWith("create_playlist", { name: "My PL" });
    expect(result.name).toBe("My PL");
  });

  it("listPlaylists calls correct command", async () => {
    mockInvoke.mockResolvedValue([]);
    await listPlaylists();
    expect(mockInvoke).toHaveBeenCalledWith("list_playlists");
  });

  it("getPlaylistTracks calls with playlistId", async () => {
    mockInvoke.mockResolvedValue([]);
    await getPlaylistTracks("abc");
    expect(mockInvoke).toHaveBeenCalledWith("get_playlist_tracks", { playlistId: "abc" });
  });

  it("addTrackToPlaylist calls with correct args", async () => {
    const track = { title: "T", artist: "A", duration: 120, source: "youtube", source_id: "vid1" };
    mockInvoke.mockResolvedValue({ id: "t1", position: 0, ...track, album: "", original_title: "", original_artist: "", cover: "" });
    await addTrackToPlaylist("pl1", track);
    expect(mockInvoke).toHaveBeenCalledWith("add_track_to_playlist", { playlistId: "pl1", track });
  });

  it("removeTrackFromPlaylist calls with trackId", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await removeTrackFromPlaylist("t1");
    expect(mockInvoke).toHaveBeenCalledWith("remove_track_from_playlist", { trackId: "t1" });
  });

  it("deletePlaylist calls with playlistId", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deletePlaylist("pl1");
    expect(mockInvoke).toHaveBeenCalledWith("delete_playlist", { playlistId: "pl1" });
  });
});

describe("session", () => {
  it("saveSession sends tracks", async () => {
    const tracks = [{ title: "T", artist: "A", duration: 60, source: "local", source_id: "/a.mp3" }];
    mockInvoke.mockResolvedValue(undefined);
    await saveSession(tracks);
    expect(mockInvoke).toHaveBeenCalledWith("save_session", { tracks });
  });

  it("loadSession returns tracks", async () => {
    const tracks = [{ id: "1", position: 0, title: "T", artist: "A", duration: 60, source: "local", source_id: "/a.mp3", album: "", original_title: "", original_artist: "", cover: "" }];
    mockInvoke.mockResolvedValue(tracks);
    const result = await loadSession();
    expect(result).toEqual(tracks);
  });
});

describe("renameTrack", () => {
  it("passes title and artist", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await renameTrack("t1", "New Title", "New Artist");
    expect(mockInvoke).toHaveBeenCalledWith("rename_track", { trackId: "t1", title: "New Title", artist: "New Artist" });
  });

  it("passes null for undefined title/artist", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await renameTrack("t1");
    expect(mockInvoke).toHaveBeenCalledWith("rename_track", { trackId: "t1", title: null, artist: null });
  });
});

describe("updateTrackSource", () => {
  it("calls with correct args", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await updateTrackSource("t1", "local", "/path.mp3");
    expect(mockInvoke).toHaveBeenCalledWith("update_track_source", { trackId: "t1", source: "local", sourceId: "/path.mp3" });
  });
});
