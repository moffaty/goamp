declare module "butterchurn" {
  const butterchurn: any;
  export default butterchurn;
}

declare module "butterchurn-presets" {
  const presets: Record<string, unknown>;
  export default presets;
}

declare module "webamp" {
  interface TrackInfo {
    metaData?: {
      artist?: string;
      title?: string;
    };
    url: string;
    duration?: number;
  }

  interface WebampOptions {
    initialTracks?: TrackInfo[];
    initialSkin?: { url: string };
    availableSkins?: Array<{ url: string; name: string }>;
    enableHotkeys?: boolean;
    windowLayout?: Record<string, unknown>;
    __butterchurnOptions?: {
      importButterchurn: () => Promise<unknown>;
      getPresets: () => Promise<
        Array<{ name: string; butterchurnPresetObject: unknown }>
      >;
      butterchurnOpen?: boolean;
    };
  }

  export default class Webamp {
    constructor(options?: WebampOptions);
    renderWhenReady(container: HTMLElement): Promise<void>;
    setTracksToPlay(tracks: TrackInfo[]): void;
    appendTracks(tracks: TrackInfo[]): void;
    play(): void;
    pause(): void;
    stop(): void;
    nextTrack(): void;
    previousTrack(): void;
    seekForward(seconds: number): void;
    seekBackward(seconds: number): void;
    setSkinFromUrl(url: string): void;
    onTrackDidChange(
      callback: (track: TrackInfo | null) => void,
    ): () => void;
    onWillClose(callback: (cancel: () => void) => void): () => void;
    onMinimize(callback: () => void): () => void;
    getMediaStatus(): string;
    dispose(): void;
  }
}
