// ── Re-export types used across services ──────────────────────────────────────

export interface Playlist {
  id: string
  name: string
  created_at: number
  updated_at: number
  track_count: number
}

export interface PlaylistTrack {
  id: string
  position: number
  title: string
  artist: string
  duration: number
  source: string
  source_id: string
  album: string
  original_title: string
  original_artist: string
  cover: string
  genre: string
}

export interface TrackInput {
  title: string
  artist: string
  duration: number
  source: string
  source_id: string
  album?: string
  original_title?: string
  original_artist?: string
  cover?: string
  genre?: string
}

export interface RadioStation {
  stationuuid: string
  name: string
  url: string
  url_resolved: string
  homepage: string
  favicon: string
  tags: string
  country: string
  countrycode: string
  language: string
  codec: string
  bitrate: number
  votes: number
  clickcount: number
}

export interface RadioTag {
  name: string
  stationcount: number
}

export interface RadioNowPlaying {
  title: string
  station_name: string
  station_uuid: string
}

export interface CachedSegment {
  index: number
  title: string
  duration_secs: number
}

export interface MoodChannel {
  id: string
  name: string
  description: string
  seed_tracks: string[]
  is_default: boolean
}

export interface Survey {
  id: number
  survey_type: string
  payload: string
  created_at: number
}

export interface ListenStats {
  canonical_id: string
  listen_count: number
  completed_count: number
  liked: boolean | null
}

export interface Recommendation {
  canonicalId: string
  score: number
  source: string
  artist: string
  title: string
}

export interface FeatureFlag {
  key: string
  enabled: boolean
  description: string
}

export interface ScrobbleStatus {
  lastfm: boolean
  listenbrainz: boolean
  queue_count: number
}

// ── Service interfaces ─────────────────────────────────────────────────────────

export interface IPlaylistService {
  create(name: string): Promise<Playlist>
  list(): Promise<Playlist[]>
  getTracks(playlistId: string): Promise<PlaylistTrack[]>
  addTrack(playlistId: string, track: TrackInput): Promise<PlaylistTrack>
  removeTrack(trackId: string): Promise<void>
  delete(playlistId: string): Promise<void>
  saveSession(tracks: TrackInput[]): Promise<void>
  loadSession(): Promise<PlaylistTrack[]>
  renameTrack(trackId: string, title?: string, artist?: string): Promise<void>
  updateTrackSource(trackId: string, source: string, sourceId: string): Promise<void>
  listGenres(): Promise<string[]>
  getTracksByGenre(genre: string): Promise<PlaylistTrack[]>
}

export interface IScrobbleService {
  lastfmSaveSettings(apiKey: string, secret: string): Promise<void>
  lastfmGetAuthUrl(): Promise<string>
  lastfmAuth(token: string): Promise<{ name: string; key: string }>
  lastfmGetStatus(): Promise<string | null>
  lastfmNowPlaying(artist: string, title: string, duration?: number): Promise<void>
  lastfmScrobble(artist: string, title: string, timestamp: number, duration?: number): Promise<void>
  listenbrainzSaveToken(token: string): Promise<string>
  listenbrainzGetStatus(): Promise<string | null>
  listenbrainzLogout(): Promise<void>
  listenbrainzNowPlaying(artist: string, title: string): Promise<void>
  listenbrainzScrobble(artist: string, title: string, timestamp: number, duration?: number): Promise<void>
  getStatus(): Promise<ScrobbleStatus>
  flushQueue(): Promise<number>
}

export interface IHistoryService {
  resolveTrackId(source: string, sourceId: string, artist: string, title: string, duration: number): Promise<string>
  recordListen(canonicalId: string, source: string, startedAt: number, durationSecs: number, listenedSecs: number, completed: boolean, skippedEarly: boolean): Promise<void>
  setLike(canonicalId: string, liked: boolean): Promise<void>
  removeLike(canonicalId: string): Promise<void>
  getStats(canonicalId: string): Promise<ListenStats>
  getLikedTracks(): Promise<string[]>
  surveyGetPending(): Promise<Survey | null>
  surveyRespond(id: number, response: string): Promise<void>
  surveySkip(id: number): Promise<void>
  surveyMarkShown(id: number): Promise<void>
}

export interface IRadioService {
  search(query: string, tag?: string, country?: string, limit?: number): Promise<RadioStation[]>
  topStations(limit?: number): Promise<RadioStation[]>
  byTag(tag: string, limit?: number): Promise<RadioStation[]>
  tags(): Promise<RadioTag[]>
  addFavorite(station: RadioStation): Promise<void>
  removeFavorite(stationuuid: string): Promise<void>
  listFavorites(): Promise<RadioStation[]>
  addCustom(name: string, url: string, tags?: string): Promise<void>
  removeCustom(id: string): Promise<void>
  listCustom(): Promise<RadioStation[]>
  play(station: RadioStation): Promise<string>
  stop(): Promise<void>
  nowPlaying(): Promise<RadioNowPlaying | null>
  listCached(): Promise<CachedSegment[]>
  saveSegment(index: number, title?: string): Promise<string>
  saveLastSecs(secs: number, title?: string): Promise<string>
}

export interface IRecommendationService {
  syncProfile(): Promise<number>
  getRecommendations(limit?: number): Promise<Recommendation[]>
  getColdstart(artist: string, title: string, limit?: number): Promise<[string, string, number][]>
  listMoodChannels(): Promise<MoodChannel[]>
  createMoodChannel(name: string, description: string): Promise<MoodChannel>
  addSeedTrack(channelId: string, canonicalId: string): Promise<void>
  deleteMoodChannel(channelId: string): Promise<void>
}

export interface CreatedAccount {
  mnemonic: string;
  accountPub: string;
  quizPositions: number[];
}

export interface CurrentAccount {
  accountPub: string;
  subPub: string;
  provisioned: boolean;
}

export interface RecoveredAccount {
  accountPub: string;
  subPub: string;
  manifestVersion: number;
}

export interface DeviceInfo {
  subPub: string;
  name: string;
  os: string;
  addedAt: string;
}

export interface DevicesList {
  devices: DeviceInfo[];
  version: number;
}

export interface IAccountService {
  create(deviceName: string, os: string): Promise<CreatedAccount>;
  current(): Promise<CurrentAccount | null>;
  forget(accountPub: string): Promise<void>;
  /** Pure helper — case-insensitive, whitespace-trimmed. */
  verifyQuiz(mnemonic: string[], positions: number[], answers: string[]): boolean;
  recover(mnemonic: string, deviceName: string, os: string, relayUrl: string): Promise<RecoveredAccount>;
  listDevices(accountPub: string, relayUrl: string): Promise<DevicesList>;
  revokeDevice(mnemonic: string, accountPub: string, subPubToRevoke: string, reason: string, relayUrl: string): Promise<number>;
}

export interface RemoteTrackRef {
  track_id: string;
  source: string;
  title?: string;
  artist?: string;
  url?: string;
}

export interface RemoteSession {
  version: number;
  active_device_id: string;
  track?: RemoteTrackRef;
  position_ms?: number;
  position_updated_at_ns?: number;
  playback_state?: "playing" | "paused" | "buffering" | "stopped";
  queue?: RemoteTrackRef[];
  queue_position?: number;
  shuffle?: boolean;
  repeat?: "off" | "one" | "all";
  last_heartbeat_ns?: number;
}

export interface RemoteCommand {
  op: "play" | "pause" | "seek" | "next" | "prev" | "add_to_queue" | "set_shuffle" | "set_repeat" | "play_track" | "takeover";
  arg_int?: number;
  arg_str?: string;
  arg_track?: RemoteTrackRef;
  issued_by: string;
  issued_at_ns: number;
  nonce: string;
}

export interface RemotePoller {
  stop(): void;
}

export interface IRemoteService {
  putSession(accountPub: string, relayUrl: string, session: RemoteSession): Promise<void>;
  getSession(accountPub: string, relayUrl: string): Promise<RemoteSession | null>;
  sendCommand(accountPub: string, relayUrl: string, cmd: RemoteCommand): Promise<void>;
  pullCommands(accountPub: string, relayUrl: string): Promise<RemoteCommand[]>;
  startPoller(opts: {
    accountPub: string;
    relayUrl: string;
    onCommand: (cmd: RemoteCommand) => void;
    onSession?: (session: RemoteSession | null) => void;
    sessionProvider?: () => RemoteSession | null;
    commandsIntervalMs?: number;
    sessionIntervalMs?: number;
  }): RemotePoller;
}

export interface ISettingsService {
  listFlags(): Promise<FeatureFlag[]>
  setFlag(key: string, enabled: boolean): Promise<void>
  getFlag(key: string): Promise<boolean>
  refreshFlagCache(): Promise<void>
  isEnabled(key: string): boolean
  youtubeSetCookies(path: string): Promise<void>
  youtubeGetCookies(): Promise<string | null>
  youtubeClearCookies(): Promise<void>
  youtubeGetPlaylist(url: string): Promise<any[]>
  scanDirectory(path: string): Promise<import('../lib/tauri-ipc').TrackMeta[]>
  readMetadata(path: string): Promise<import('../lib/tauri-ipc').TrackMeta>
}
