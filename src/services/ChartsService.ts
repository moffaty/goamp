import type { ITransport } from './transport'
import type { IChartsService, ChartEntry, ChartPeriod } from './interfaces'

export class ChartsService implements IChartsService {
  constructor(private t: ITransport) {}

  getTopTracks(period: ChartPeriod, limit = 50) {
    return this.t.call<ChartEntry[]>('get_top_tracks_cmd', { period, limit })
  }
}
