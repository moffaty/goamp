import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  yandexSaveToken,
  yandexGetStatus,
  yandexRequestDeviceCode,
  yandexPollToken,
  yandexLogout,
  yandexSearch,
  yandexGetTrackUrl,
  yandexListStations,
  yandexStationTracks,
  yandexListPlaylists,
  yandexGetPlaylistTracks,
  yandexImportPlaylist,
  yandexDownloadTrack,
  yandexGetLikedTracks,
  yandexGetTrackUrls,
  yandexLikeTrack,
  yandexDownloadToLibrary,
  yandexRefreshToken,
  yandexOpenOAuthWindow,
  yandexDownloadPlaylist,
  yandexSearchSuggest,
  yandexSimilarTracks,
  yandexGetLyrics,
  yandexDownloadLyrics,
  yandexStationFeedback,
  yandexGetTrackUrlsBatch,
} from "./yandex-service";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("yandex auth", () => {
  it("yandexSaveToken sends token", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await yandexSaveToken("tok123");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_save_token", { token: "tok123" });
  });

  it("yandexGetStatus returns account or null", async () => {
    mockInvoke.mockResolvedValue({ uid: "1", login: "user", display_name: "User", has_plus: true });
    const result = await yandexGetStatus();
    expect(result?.login).toBe("user");
  });

  it("yandexRequestDeviceCode returns device code response", async () => {
    const resp = { user_code: "ABC", verification_url: "https://ya.cc/device", interval: 5, device_code: "dc1", expires_in: 300 };
    mockInvoke.mockResolvedValue(resp);
    const result = await yandexRequestDeviceCode();
    expect(result.user_code).toBe("ABC");
  });

  it("yandexPollToken sends deviceCode", async () => {
    mockInvoke.mockResolvedValue("token123");
    const result = await yandexPollToken("dc1");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_poll_token", { deviceCode: "dc1" });
    expect(result).toBe("token123");
  });

  it("yandexLogout calls correct command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await yandexLogout();
    expect(mockInvoke).toHaveBeenCalledWith("yandex_logout");
  });

  it("yandexRefreshToken calls correct command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await yandexRefreshToken();
    expect(mockInvoke).toHaveBeenCalledWith("yandex_refresh_token");
  });

  it("yandexOpenOAuthWindow calls correct command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await yandexOpenOAuthWindow();
    expect(mockInvoke).toHaveBeenCalledWith("yandex_open_oauth_window");
  });
});

describe("yandex search", () => {
  it("passes query and null page by default", async () => {
    mockInvoke.mockResolvedValue([]);
    await yandexSearch("query");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_search", { query: "query", page: null });
  });

  it("passes page when specified", async () => {
    mockInvoke.mockResolvedValue([]);
    await yandexSearch("query", 2);
    expect(mockInvoke).toHaveBeenCalledWith("yandex_search", { query: "query", page: 2 });
  });
});

describe("yandex tracks", () => {
  it("yandexGetTrackUrl calls with trackId", async () => {
    mockInvoke.mockResolvedValue("https://stream.ya.ru/track.mp3");
    const url = await yandexGetTrackUrl("12345");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_get_track_url", { trackId: "12345" });
    expect(url).toContain("stream");
  });

  it("yandexGetTrackUrls calls with trackIds array", async () => {
    mockInvoke.mockResolvedValue(["url1", "url2"]);
    const urls = await yandexGetTrackUrls(["1", "2"]);
    expect(mockInvoke).toHaveBeenCalledWith("yandex_get_track_urls", { trackIds: ["1", "2"] });
    expect(urls).toHaveLength(2);
  });

  it("yandexLikeTrack sends trackId and like flag", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await yandexLikeTrack("123", true);
    expect(mockInvoke).toHaveBeenCalledWith("yandex_like_track", { trackId: "123", like: true });
  });

  it("yandexGetLikedTracks calls correct command", async () => {
    mockInvoke.mockResolvedValue([]);
    await yandexGetLikedTracks();
    expect(mockInvoke).toHaveBeenCalledWith("yandex_get_liked_tracks");
  });
});

describe("yandex stations", () => {
  it("yandexListStations returns stations", async () => {
    mockInvoke.mockResolvedValue([{ id: "s1", name: "Rock", icon: "" }]);
    const stations = await yandexListStations();
    expect(stations).toHaveLength(1);
  });

  it("yandexStationTracks passes stationId and null lastTrackId", async () => {
    mockInvoke.mockResolvedValue([]);
    await yandexStationTracks("s1");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_station_tracks", { stationId: "s1", lastTrackId: null });
  });

  it("yandexStationTracks passes lastTrackId when provided", async () => {
    mockInvoke.mockResolvedValue([]);
    await yandexStationTracks("s1", "t99");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_station_tracks", { stationId: "s1", lastTrackId: "t99" });
  });
});

describe("yandex playlists", () => {
  it("yandexListPlaylists returns playlists", async () => {
    mockInvoke.mockResolvedValue([]);
    await yandexListPlaylists();
    expect(mockInvoke).toHaveBeenCalledWith("yandex_list_playlists");
  });

  it("yandexGetPlaylistTracks passes owner and kind", async () => {
    mockInvoke.mockResolvedValue([]);
    await yandexGetPlaylistTracks("user1", 3);
    expect(mockInvoke).toHaveBeenCalledWith("yandex_get_playlist_tracks", { owner: "user1", kind: 3 });
  });

  it("yandexImportPlaylist passes owner, kind, name", async () => {
    mockInvoke.mockResolvedValue("new-pl-id");
    const id = await yandexImportPlaylist("user1", 3, "My Import");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_import_playlist", { owner: "user1", kind: 3, name: "My Import" });
    expect(id).toBe("new-pl-id");
  });
});

describe("yandex downloads", () => {
  it("yandexDownloadTrack passes trackId, title, artist", async () => {
    mockInvoke.mockResolvedValue("/downloads/track.mp3");
    await yandexDownloadTrack("123", "Song", "Artist");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_download_track", { trackId: "123", title: "Song", artist: "Artist" });
  });

  it("yandexDownloadPlaylist passes owner and kind", async () => {
    mockInvoke.mockResolvedValue(["/d/1.mp3", "/d/2.mp3"]);
    const paths = await yandexDownloadPlaylist("user1", 3);
    expect(mockInvoke).toHaveBeenCalledWith("yandex_download_playlist", { owner: "user1", kind: 3 });
    expect(paths).toHaveLength(2);
  });

  it("yandexDownloadToLibrary passes trackId, title, artist", async () => {
    mockInvoke.mockResolvedValue("/library/track.mp3");
    await yandexDownloadToLibrary("123", "Song", "Artist");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_download_to_library", { trackId: "123", title: "Song", artist: "Artist" });
  });
});

describe("yandex search suggestions", () => {
  it("yandexSearchSuggest passes part string", async () => {
    mockInvoke.mockResolvedValue({ suggestions: ["rock", "rock music"] });
    const result = await yandexSearchSuggest("roc");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_search_suggest", { part: "roc" });
    expect(result.suggestions).toHaveLength(2);
  });
});

describe("yandex similar tracks", () => {
  it("yandexSimilarTracks passes trackId", async () => {
    mockInvoke.mockResolvedValue([{ id: "2", title: "Similar", artist: "A", album: "", duration: 200, cover: "", available: true }]);
    const tracks = await yandexSimilarTracks("1");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_similar_tracks", { trackId: "1" });
    expect(tracks).toHaveLength(1);
  });
});

describe("yandex lyrics", () => {
  it("yandexGetLyrics passes trackId and synced flag", async () => {
    mockInvoke.mockResolvedValue({ download_url: "https://lyrics.ya.ru/1.txt", writers: ["Author"] });
    const result = await yandexGetLyrics("123", false);
    expect(mockInvoke).toHaveBeenCalledWith("yandex_get_lyrics", { trackId: "123", synced: false });
    expect(result.download_url).toContain("lyrics");
  });

  it("yandexDownloadLyrics fetches text by URL", async () => {
    mockInvoke.mockResolvedValue("Line 1\nLine 2\nLine 3");
    const text = await yandexDownloadLyrics("https://lyrics.ya.ru/1.txt");
    expect(mockInvoke).toHaveBeenCalledWith("yandex_download_lyrics", { url: "https://lyrics.ya.ru/1.txt" });
    expect(text).toContain("Line 1");
  });
});

describe("yandex station feedback", () => {
  it("yandexStationFeedback sends feedback", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await yandexStationFeedback("genre:rock", "123", "trackStarted", 0);
    expect(mockInvoke).toHaveBeenCalledWith("yandex_station_feedback", {
      stationId: "genre:rock",
      trackId: "123",
      feedbackType: "trackStarted",
      totalPlayedSeconds: 0,
      batchId: null,
    });
  });
});

describe("yandex batch URLs", () => {
  it("yandexGetTrackUrlsBatch passes trackIds array", async () => {
    mockInvoke.mockResolvedValue(["url1", "url2", "url3"]);
    const urls = await yandexGetTrackUrlsBatch(["1", "2", "3"]);
    expect(mockInvoke).toHaveBeenCalledWith("yandex_get_track_urls_batch", { trackIds: ["1", "2", "3"] });
    expect(urls).toHaveLength(3);
  });
});
