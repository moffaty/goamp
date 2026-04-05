// src/recommendations/history-service.ts

type ResolveTrackIdFn = (
  source: string, sourceId: string, artist: string, title: string, duration: number,
) => Promise<string>;

type RecordListenFn = (
  canonicalId: string, source: string, startedAt: number,
  durationSecs: number, listenedSecs: number, completed: boolean, skippedEarly: boolean,
) => Promise<void>;

export class HistoryTracker {
  private resolveTrackId: ResolveTrackIdFn;
  private recordListen: RecordListenFn;

  private currentCanonicalId: string | null = null;
  private currentSource: string = '';
  private currentDuration: number = 0;
  private startedAt: number = 0;
  private resolving: Promise<void> | null = null;

  constructor(resolveTrackId: ResolveTrackIdFn, recordListen: RecordListenFn) {
    this.resolveTrackId = resolveTrackId;
    this.recordListen = recordListen;
  }

  onTrackStart(source: string, sourceId: string, artist: string, title: string, duration: number) {
    this.currentCanonicalId = null;
    this.currentSource = source;
    this.currentDuration = duration;
    this.startedAt = Math.floor(Date.now() / 1000);

    this.resolving = this.resolveTrackId(source, sourceId, artist, title, duration)
      .then((cid) => { this.currentCanonicalId = cid; })
      .catch(() => { this.currentCanonicalId = null; });
  }

  async onTrackEnd(listenedSecs: number) {
    if (this.resolving) {
      await this.resolving;
    }
    if (!this.currentCanonicalId) return;

    const completed = listenedSecs >= this.currentDuration * 0.8;
    const skippedEarly = listenedSecs < 10;

    await this.recordListen(
      this.currentCanonicalId,
      this.currentSource,
      this.startedAt,
      this.currentDuration,
      listenedSecs,
      completed,
      skippedEarly,
    );

    this.currentCanonicalId = null;
  }
}
