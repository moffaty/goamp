import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { searchYoutube, extractAudio, extractAudioUrl } from "./youtube-service";

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
