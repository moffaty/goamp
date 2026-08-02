import type { IFeature } from '../../core/IFeature'
import type { ModuleContext } from '../../core/ModuleContext'
import type { ITransport } from '../../services/transport'
import type { ChartEntry, ChartPeriod } from '../../services/interfaces'
import { ChartsService } from '../../services/ChartsService'

// A tab is just a label + a loader. Personal periods hit get_top_tracks;
// Community aggregates peer profiles via get_community_charts.
type Tab = { label: string; load: (svc: ChartsService) => Promise<ChartEntry[]> }

const personalTab = (period: ChartPeriod, label: string): Tab => ({
  label,
  load: (svc) => svc.getTopTracks(period),
})

const TABS: Tab[] = [
  personalTab('week', 'Week'),
  personalTab('month', 'Month'),
  personalTab('all', 'All'),
  { label: 'Community', load: (svc) => svc.getCommunityCharts() },
]

export class ChartsFeature implements IFeature {
  readonly id = 'charts'

  private svc: ChartsService

  constructor(transport: ITransport) {
    this.svc = new ChartsService(transport)
  }

  async init(ctx: ModuleContext): Promise<void> {
    ctx.ui.registerPanel('charts', () => this.renderChartsPanel())
    ctx.ui.registerMenuItem('Charts', () => ctx.ui.togglePanel('charts'), 'charts')
  }

  /** "Your Top Tracks" panel with a Week/Month/All period toggle. */
  private renderChartsPanel(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'goamp-charts-panel'
    el.style.cssText =
      'background:#1e1e1e;color:#00ff00;font-family:monospace;font-size:11px;padding:8px;border:2px inset #444;'

    const header = document.createElement('div')
    header.textContent = 'Your Top Tracks'
    header.style.cssText = 'font-weight:bold;margin-bottom:6px;'
    el.appendChild(header)

    const list = document.createElement('ol')
    list.className = 'goamp-charts-list'
    list.style.cssText = 'margin:0;padding-left:20px;'

    const load = (tab: Tab) => {
      list.textContent = 'Loading…'
      tab.load(this.svc)
        .then((tracks) => {
          list.textContent = ''
          if (tracks.length === 0) {
            list.textContent = 'No plays yet — go listen to something'
            return
          }
          for (const t of tracks) {
            const li = document.createElement('li')
            li.textContent = `${t.title} — ${t.artist}  (${t.play_count})`
            list.appendChild(li)
          }
        })
        .catch(() => { list.textContent = 'Could not load charts' })
    }

    const toggle = document.createElement('div')
    toggle.style.cssText = 'margin-bottom:6px;'
    for (const tab of TABS) {
      const btn = document.createElement('button')
      btn.textContent = tab.label
      btn.style.cssText = 'margin-right:4px;font-family:monospace;'
      btn.addEventListener('click', () => load(tab))
      toggle.appendChild(btn)
    }
    el.appendChild(toggle)
    el.appendChild(list)

    load(TABS[0])
    return el
  }

  destroy(): void {}
}
