import Webamp from 'webamp'
import { initAnalytics, track } from './lib/analytics'
import { getButterchurnOptions } from './webamp/butterchurn'
import { GoampCore } from './core/GoampCore'
import { TauriTransport } from './services/transport'
import { WebampRenderer } from './renderers/webamp/WebampRenderer'
import { WebampUIFeature } from './renderers/webamp/WebampUIFeature'
import { LocalSource } from './sources/local/LocalSource'
import { YouTubeSource } from './sources/youtube/YouTubeSource'
import { PlaylistFeature } from './features/playlists/PlaylistFeature'
import { HistoryFeature } from './features/history/HistoryFeature'
import { ScrobbleFeature } from './features/scrobble/ScrobbleFeature'
import { RadioFeature } from './features/radio/RadioFeature'
import { RecommendationsFeature } from './features/recommendations/RecommendationsFeature'
import { P2PFeature } from './features/p2p/P2PFeature'
import { AutoplayFeature } from './features/autoplay/AutoplayFeature'
import { showErrorOverlay, installGlobalErrorHandlers } from './lib/error-overlay'

// Install error handlers FIRST so any failure below is visible (no devtools in prod).
installGlobalErrorHandlers()

try {
  initAnalytics()

  const webamp = new Webamp({
    __initialWindowLayout: {
      main: { position: { x: 0, y: 0 } },
      equalizer: { position: { x: 0, y: 116 } },
      playlist: { position: { x: 0, y: 232 }, size: [0, 4] },
    },
    initialTracks: [
      {
        metaData: { artist: 'GOAMP', title: 'Press Ctrl+O to open a folder' },
        url: '',
        duration: 0,
      },
    ],
    __butterchurnOptions: getButterchurnOptions(),
  } as any)

  const transport = new TauriTransport()
  const renderer = new WebampRenderer(webamp)

  await new GoampCore()
    .renderer(renderer)
    .transport(transport)
    .source(new LocalSource(transport))
    .source(new YouTubeSource(transport))
    .feature(new WebampUIFeature(renderer, webamp))
    .feature(new PlaylistFeature(transport))
    .feature(new HistoryFeature(transport))
    .feature(new ScrobbleFeature(transport))
    .feature(new RadioFeature(transport))
    .feature(new RecommendationsFeature(transport))
    .feature(new P2PFeature(transport))
    .feature(new AutoplayFeature(webamp, transport))
    .start(document.getElementById('app')!)

  track('app_launched')
} catch (e) {
  // No devtools in prod — make failures visible.
  showErrorOverlay('GOAMP startup failed', e)
}
