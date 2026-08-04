import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { searchYoutube, extractAudio, extractAudioUrl, importPlaylist, isPlaylistUrl, downloadTrack, contentId } from "./youtube-service";
import type { YoutubeResult } from "./youtube-service";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("searchYoutube", () => {
  it("calls invoke with defaults (null limit and source)", async () => {
    mockInvoke.mockResolvedValue([]);
    await searchYoutube("test query");
    expect(mockInvoke).toHaveBeenCalledWith("search_youtube", {
      query: "test query",
      limit: null,
      source: null,
    });
  });

  it("passes limit and source when provided", async () => {
    mockInvoke.mockResolvedValue([]);
    await searchYoutube("test", 10, "soundcloud");
    expect(mockInvoke).toHaveBeenCalledWith("search_youtube", {
      query: "test",
      limit: 10,
      source: "soundcloud",
    });
  });

  it("returns results array", async () => {
    const results = [
      { id: "abc", title: "Song", channel: "Ch", duration: 180, thumbnail: "", source: "youtube", webpage_url: "" },
    ];
    mockInvoke.mockResolvedValue(results);
    const res = await searchYoutube("song");
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("abc");
  });
});

describe("importPlaylist", () => {
  it("calls invoke with the url", async () => {
    mockInvoke.mockResolvedValue([]);
    await importPlaylist("https://soundcloud.com/x/sets/album");
    expect(mockInvoke).toHaveBeenCalledWith("import_playlist", {
      url: "https://soundcloud.com/x/sets/album",
    });
  });
});

describe("isPlaylistUrl", () => {
  it("detects SoundCloud sets and YouTube playlists", () => {
    expect(isPlaylistUrl("https://soundcloud.com/sofiya-chernyak-646218391/sets/koroli-abstrakta-vi")).toBe(true);
    expect(isPlaylistUrl("https://www.youtube.com/playlist?list=PLabc")).toBe(true);
    expect(isPlaylistUrl("https://youtube.com/watch?v=x&list=PLabc")).toBe(true);
  });
  it("rejects plain queries and single tracks", () => {
    expect(isPlaylistUrl("короли абстракта")).toBe(false);
    expect(isPlaylistUrl("https://soundcloud.com/artist/single-track")).toBe(false);
    expect(isPlaylistUrl("")).toBe(false);
  });
});

describe("downloadTrack", () => {
  const base: YoutubeResult = {
    id: "vid1", title: "Title", channel: "Artist", duration: 200,
    thumbnail: "", source: "youtube", webpage_url: "https://sc/x", genre: "",
  };

  it("uses the video id for YouTube and seeds under a youtube content id", async () => {
    mockInvoke.mockResolvedValue("/dl/Artist - Title.mp3");
    await downloadTrack(base);
    expect(mockInvoke).toHaveBeenCalledWith("download_track", {
      url: "vid1", title: "Title", artist: "Artist", trackId: "youtube:vid1",
    });
  });

  it("uses the webpage_url for SoundCloud and seeds under a soundcloud content id", async () => {
    mockInvoke.mockResolvedValue("/dl/x.opus");
    await downloadTrack({ ...base, source: "soundcloud" });
    expect(mockInvoke).toHaveBeenCalledWith("download_track", {
      url: "https://sc/x", title: "Title", artist: "Artist", trackId: "soundcloud:https://sc/x",
    });
  });
});

describe("contentId", () => {
  const base: YoutubeResult = {
    id: "vid1", title: "T", channel: "A", duration: 1,
    thumbnail: "", source: "youtube", webpage_url: "https://sc/x", genre: "",
  };
  it("prefixes youtube ids and soundcloud urls", () => {
    expect(contentId(base)).toBe("youtube:vid1");
    expect(contentId({ ...base, source: "soundcloud" })).toBe("soundcloud:https://sc/x");
  });
});

describe("extractAudio", () => {
  it("calls invoke with videoId", async () => {
    mockInvoke.mockResolvedValue("/cache/abc.opus");
    const result = await extractAudio("abc");
    expect(mockInvoke).toHaveBeenCalledWith("extract_audio", { videoId: "abc" });
    expect(result).toBe("/cache/abc.opus");
  });
});

describe("extractAudioUrl", () => {
  it("calls invoke with url", async () => {
    mockInvoke.mockResolvedValue("/cache/sc.opus");
    const result = await extractAudioUrl("https://soundcloud.com/track");
    expect(mockInvoke).toHaveBeenCalledWith("extract_audio_url", { url: "https://soundcloud.com/track" });
    expect(result).toBe("/cache/sc.opus");
  });
});
