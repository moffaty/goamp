import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  lastfmSaveSettings,
  lastfmGetAuthUrl,
  lastfmAuth,
  lastfmNowPlaying,
  lastfmScrobble,
  lastfmGetStatus,
  listenbrainzSaveToken,
  listenbrainzGetStatus,
  listenbrainzLogout,
  listenbrainzNowPlaying,
  listenbrainzScrobble,
  scrobbleGetStatus,
  scrobbleFlushQueue,
} from "./scrobble-service";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("Last.fm service", () => {
  it("lastfmSaveSettings sends apiKey and secret", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await lastfmSaveSettings("key123", "secret456");
    expect(mockInvoke).toHaveBeenCalledWith("lastfm_save_settings", { apiKey: "key123", secret: "secret456" });
  });

  it("lastfmGetAuthUrl returns URL", async () => {
    mockInvoke.mockResolvedValue("https://last.fm/auth?api_key=k");
    const url = await lastfmGetAuthUrl();
    expect(url).toContain("last.fm");
  });

  it("lastfmAuth sends token and returns session", async () => {
    mockInvoke.mockResolvedValue({ name: "user1", key: "sess_key" });
    const session = await lastfmAuth("tok");
    expect(mockInvoke).toHaveBeenCalledWith("lastfm_auth", { token: "tok" });
    expect(session.name).toBe("user1");
  });

  it("lastfmNowPlaying sends artist, title, and optional duration", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await lastfmNowPlaying("Artist", "Title", 180);
    expect(mockInvoke).toHaveBeenCalledWith("lastfm_now_playing", { artist: "Artist", title: "Title", duration: 180 });
  });

  it("lastfmNowPlaying sends null duration when not provided", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await lastfmNowPlaying("Artist", "Title");
    expect(mockInvoke).toHaveBeenCalledWith("lastfm_now_playing", { artist: "Artist", title: "Title", duration: null });
  });

  it("lastfmScrobble sends all params", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await lastfmScrobble("Artist", "Title", 1700000000, 200);
    expect(mockInvoke).toHaveBeenCalledWith("lastfm_scrobble", {
      artist: "Artist",
      title: "Title",
      timestamp: 1700000000,
      duration: 200,
    });
  });

  it("lastfmGetStatus returns session key or null", async () => {
    mockInvoke.mockResolvedValue("sess_key");
    const status = await lastfmGetStatus();
    expect(status).toBe("sess_key");
  });
});

describe("ListenBrainz service", () => {
  it("listenbrainzSaveToken sends token and returns username", async () => {
    mockInvoke.mockResolvedValue("user42");
    const username = await listenbrainzSaveToken("lb-token");
    expect(mockInvoke).toHaveBeenCalledWith("listenbrainz_save_token", { token: "lb-token" });
    expect(username).toBe("user42");
  });

  it("listenbrainzGetStatus returns username or null", async () => {
    mockInvoke.mockResolvedValue("user42");
    const status = await listenbrainzGetStatus();
    expect(status).toBe("user42");
  });

  it("listenbrainzLogout calls correct command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await listenbrainzLogout();
    expect(mockInvoke).toHaveBeenCalledWith("listenbrainz_logout");
  });

  it("listenbrainzNowPlaying sends artist and title", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await listenbrainzNowPlaying("Artist", "Title");
    expect(mockInvoke).toHaveBeenCalledWith("listenbrainz_now_playing", { artist: "Artist", title: "Title" });
  });

  it("listenbrainzScrobble sends all params", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await listenbrainzScrobble("Artist", "Title", 1700000000, 200);
    expect(mockInvoke).toHaveBeenCalledWith("listenbrainz_scrobble", {
      artist: "Artist",
      title: "Title",
      timestamp: 1700000000,
      duration: 200,
    });
  });

  it("listenbrainzScrobble sends null duration when not provided", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await listenbrainzScrobble("Artist", "Title", 1700000000);
    expect(mockInvoke).toHaveBeenCalledWith("listenbrainz_scrobble", {
      artist: "Artist",
      title: "Title",
      timestamp: 1700000000,
      duration: null,
    });
  });
});

describe("scrobble queue", () => {
  it("scrobbleGetStatus returns status", async () => {
    mockInvoke.mockResolvedValue({ lastfm: true, listenbrainz: false, queue_count: 5 });
    const status = await scrobbleGetStatus();
    expect(status.lastfm).toBe(true);
    expect(status.queue_count).toBe(5);
  });

  it("scrobbleFlushQueue returns flushed count", async () => {
    mockInvoke.mockResolvedValue(3);
    const count = await scrobbleFlushQueue();
    expect(count).toBe(3);
  });
});
