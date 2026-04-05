import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HistoryTracker } from './history-service';

describe('HistoryTracker', () => {
  let tracker: HistoryTracker;
  const mockResolveTrackId = vi.fn().mockResolvedValue('canonical_123');
  const mockRecordListen = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    tracker = new HistoryTracker(mockResolveTrackId, mockRecordListen);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks play start', () => {
    tracker.onTrackStart('youtube', 'vid1', 'Artist', 'Title', 200);
    expect(mockResolveTrackId).toHaveBeenCalledWith('youtube', 'vid1', 'Artist', 'Title', 200);
  });

  it('records completed listen on track end', async () => {
    tracker.onTrackStart('youtube', 'vid1', 'Artist', 'Title', 200);
    await vi.advanceTimersByTimeAsync(0);
    tracker.onTrackEnd(195);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRecordListen).toHaveBeenCalledWith(
      'canonical_123', 'youtube', expect.any(Number), 200, 195, true, false,
    );
  });

  it('records skip on early track change (<10s)', async () => {
    tracker.onTrackStart('youtube', 'vid1', 'Artist', 'Title', 200);
    await vi.advanceTimersByTimeAsync(0);
    tracker.onTrackEnd(5);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRecordListen).toHaveBeenCalledWith(
      'canonical_123', 'youtube', expect.any(Number), 200, 5, false, true,
    );
  });

  it('does not record if no track started', async () => {
    tracker.onTrackEnd(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRecordListen).not.toHaveBeenCalled();
  });
});
