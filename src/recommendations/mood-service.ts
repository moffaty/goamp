import { invoke } from "@tauri-apps/api/core";

export interface MoodChannel {
  id: string;
  name: string;
  description: string;
  seed_tracks: string[];
  is_default: boolean;
}

export interface QueueTrack {
  canonical_id: string;
  title: string;
  artist: string;
  source: string;
  source_id: string;
  score: number;
  is_discovery: boolean;
}

export interface TagWeight {
  tag: string;
  scope: string;
  weight: number;
}

const ACTIVE_MOOD_KEY = "goamp_active_mood";

export class MoodService {
  private _activeMood: string | null;
  private _listeners: Array<(mood: string | null) => void> = [];

  constructor() {
    this._activeMood = localStorage.getItem(ACTIVE_MOOD_KEY);
  }

  get activeMood(): string | null {
    return this._activeMood;
  }

  setMood(id: string | null): void {
    this._activeMood = id;
    if (id === null) {
      localStorage.removeItem(ACTIVE_MOOD_KEY);
    } else {
      localStorage.setItem(ACTIVE_MOOD_KEY, id);
    }
    this._listeners.forEach((fn) => fn(id));
  }

  onMoodChange(fn: (mood: string | null) => void): () => void {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== fn);
    };
  }

  async listMoods(): Promise<MoodChannel[]> {
    return invoke("list_mood_channels");
  }

  async createMood(name: string, description = ""): Promise<MoodChannel> {
    return invoke("create_mood_channel", { name, description });
  }

  async deleteMood(channelId: string): Promise<void> {
    return invoke("delete_mood_channel", { channelId });
  }

  async generateQueue(moodId: string, limit = 20): Promise<QueueTrack[]> {
    return invoke("generate_mood_queue", { moodId, limit });
  }

  async recordPlay(
    canonicalId: string,
    moodId: string,
    completionRate: number,
    skipped: boolean
  ): Promise<void> {
    return invoke("record_mood_play", { moodId, canonicalId, completionRate, skipped });
  }

  async recordSignal(canonicalId: string, signal: 1 | -1, scope: string): Promise<void> {
    return invoke("record_track_signal", { canonicalId, signal, scope });
  }

}

export const moodService = new MoodService();
