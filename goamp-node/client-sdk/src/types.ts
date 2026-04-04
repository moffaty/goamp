// Types mirroring proto/goamp.proto for use in the TypeScript SDK.

export interface Track {
  id: string;
  artist: string;
  title: string;
  musicbrainz_id?: string;
  duration_secs?: number;
  genre?: string;
  peer_count?: number;
}

export interface TasteProfile {
  version?: number;
  liked_hashes?: string[];
  genre_weights?: Record<string, number>;
  total_listens?: number;
}

export interface Recommendation {
  track_id: string;
  score: number;
  source: string;
}

export interface Peer {
  id: string;
  addrs: string[];
}

export interface HealthStatus {
  status: string;
  peer_count: number;
  uptime_secs: number;
  version: string;
}

export interface PluginInfo {
  id: string;
  version: string;
  port: number;
  protocols: string[];
}

// WebSocket event types
export type GoampEventType =
  | "peer:connected"
  | "peer:disconnected"
  | "track:found"
  | "track:announced"
  | "profile:synced"
  | "recommendations:updated";

export interface GoampEvent<T = unknown> {
  type: GoampEventType;
  payload: T;
}
