import type { Recommendation, TasteProfile } from "./types.js";

/** Profiles API client for /profiles/* and /recommendations endpoints. */
export class ProfilesClient {
  constructor(private readonly baseUrl: string) {}

  /** Submit a taste profile to the network. */
  async sync(profile: TasteProfile): Promise<void> {
    const res = await fetch(`${this.baseUrl}/profiles/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) throw new Error(`profiles sync failed: ${res.status}`);
  }

  /** Get personalised track recommendations. */
  async getRecommendations(): Promise<Recommendation[]> {
    const res = await fetch(`${this.baseUrl}/recommendations`);
    if (!res.ok) throw new Error(`recommendations failed: ${res.status}`);
    const body = await res.json();
    return body.recommendations ?? [];
  }
}
