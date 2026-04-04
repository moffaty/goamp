import type { Track } from "./types.js";

export interface SearchOptions {
  q: string;
  genre?: string;
  limit?: number;
}

/** Catalog API client for /catalog/* endpoints. */
export class CatalogClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * Search tracks across the P2P network and local cache.
   * Returns an empty array if no results are found.
   */
  async search(opts: SearchOptions): Promise<Track[]> {
    const params = new URLSearchParams({ q: opts.q });
    if (opts.genre) params.set("genre", opts.genre);
    if (opts.limit) params.set("limit", String(opts.limit));

    const res = await fetch(`${this.baseUrl}/catalog/search?${params}`);
    if (!res.ok) throw new Error(`catalog search failed: ${res.status}`);
    const body = await res.json();
    return body.tracks ?? [];
  }

  /** Announce that this node has a particular track available. */
  async announce(trackId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/catalog/announce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track_id: trackId }),
    });
    if (!res.ok) throw new Error(`catalog announce failed: ${res.status}`);
  }
}
