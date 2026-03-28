import { describe, it, expect } from "vitest";
import { convertFileSrc } from "@tauri-apps/api/core";
import { toWebampTrack, toWebampTracks } from "./tracks";
import type { TrackMeta } from "../lib/tauri-ipc";

describe("toWebampTrack", () => {
  it("converts TrackMeta to WebampTrack", () => {
    const meta: TrackMeta = {
      path: "/music/song.mp3",
      title: "My Song",
      artist: "My Artist",
      album: "My Album",
      genre: "Rock",
      duration: 240,
    };

    const result = toWebampTrack(meta);
    expect(result.metaData.artist).toBe("My Artist");
    expect(result.metaData.title).toBe("My Song");
    expect(result.duration).toBe(240);
    expect(convertFileSrc).toHaveBeenCalledWith("/music/song.mp3");
  });

  it("uses 'Unknown Artist' when artist is null", () => {
    const meta: TrackMeta = {
      path: "/music/song.mp3",
      title: "Song",
      artist: null,
      album: null,
      genre: null,
      duration: 120,
    };

    const result = toWebampTrack(meta);
    expect(result.metaData.artist).toBe("Unknown Artist");
  });

  it("uses 'Unknown Track' when title is null", () => {
    const meta: TrackMeta = {
      path: "/music/song.mp3",
      title: null,
      artist: "Artist",
      album: null,
      genre: null,
      duration: 120,
    };

    const result = toWebampTrack(meta);
    expect(result.metaData.title).toBe("Unknown Track");
  });
});

describe("toWebampTracks", () => {
  it("converts array of TrackMeta", () => {
    const metas: TrackMeta[] = [
      { path: "/a.mp3", title: "A", artist: "X", album: null, genre: null, duration: 60 },
      { path: "/b.mp3", title: "B", artist: "Y", album: null, genre: null, duration: 90 },
    ];

    const result = toWebampTracks(metas);
    expect(result).toHaveLength(2);
    expect(result[0].metaData.title).toBe("A");
    expect(result[1].metaData.title).toBe("B");
  });

  it("returns empty array for empty input", () => {
    expect(toWebampTracks([])).toEqual([]);
  });
});
