import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { IFeature } from '../../core/IFeature'
import type { ModuleContext } from '../../core/ModuleContext'
import type { Track } from '../../core/types'
import { EVENTS } from '../../core/events'
import { track as analyticsTrack } from '../../lib/analytics'
import { setupWindowDrag, setupClickThrough } from '../../webamp/window-drag'
import { applyOnTop, isOnTop, setOnTop, sendToBack } from '../../webamp/window-layer'
import { initSearchOverlay } from '../../youtube/SearchOverlay'
import { initPlaylistPanel } from '../../playlists/PlaylistPanel'
import { initAudioDevicePanel, restoreAudioDevice } from '../../settings/AudioDevicePanel'
import { initScrobbleSettings } from '../../scrobble/ScrobbleSettings'
import { initGoampMenu } from '../../webamp/goamp-menu'
import { initVisualizerPanel } from '../../webamp/VisualizerPanel'
import { initMilkdropController } from '../../webamp/milkdrop-controller'
import { initGenrePanel } from '../../settings/GenrePanel'
import { initRadioPanel } from '../../radio/RadioPanel'
import { initRecommendationPanel } from '../../recommendations/RecommendationPanel'
import { checkForUpdates } from '../../updater/UpdateNotification'
import { renderMoodTabs } from '../../webamp/bridge'
import type { WebampRenderer } from './WebampRenderer'
import type Webamp from 'webamp'

export class WebampUIFeature implements IFeature {
  readonly id = 'webamp-ui'

  private cleanups: Array<() => void> = []

  constructor(
    private readonly renderer: WebampRenderer,
    private readonly webamp: Webamp,
  ) {}

  async init(ctx: ModuleContext): Promise<void> {
    const store = this.renderer.playerStore

    // Restore the persistent On-Top toggle.
    applyOnTop()

    // UI panels — all need the Webamp instance
    initSearchOverlay(this.webamp)
    initPlaylistPanel(this.webamp)
    initAudioDevicePanel(this.webamp)
    initScrobbleSettings()
    initVisualizerPanel(this.webamp, store)
    initGenrePanel(this.webamp)
    initRadioPanel(this.webamp)
    initRecommendationPanel(this.webamp)
    initGoampMenu(this.webamp)
    initMilkdropController(store)
    renderMoodTabs().catch(() => {})
    restoreAudioDevice()

    setupWindowDrag()
    this.cleanups.push(setupClickThrough())

    // Track analytics on track start
    this.cleanups.push(
      ctx.events.on<Track>(EVENTS.TRACK_START, (t) => {
        const url = t.streamUrl ?? t.sourceId
        const ext = url.split('.').pop()?.toLowerCase() || 'unknown'
        analyticsTrack('track_played', { source: t.source, format: t.source === 'local' ? ext : 'stream' })
        const artist = t.artist.slice(0, 100)
        const title = t.title.slice(0, 100)
        analyticsTrack('track_info', { artist, title, source: t.source })
        invoke('update_tray_tooltip', { text: `${artist} — ${title}` }).catch(() => {})
        invoke('update_media_metadata', { title, artist }).catch(() => {})
        invoke('update_media_playback', { playing: true }).catch(() => {})
      }),
    )

    // Media keys
    const webview = getCurrentWebviewWindow()
    webview.listen<string>('media-action', ({ payload }) => {
      switch (payload) {
        case 'play':
        case 'play_pause': {
          const st = store.getStatus()
          store.dispatch({ type: st === 'PLAYING' ? 'PAUSE' : 'PLAY' })
          invoke('update_media_playback', { playing: st !== 'PLAYING' }).catch(() => {})
          break
        }
        case 'pause':
          store.dispatch({ type: 'PAUSE' })
          invoke('update_media_playback', { playing: false }).catch(() => {})
          break
        case 'next': store.dispatch({ type: 'PLAY_TRACK', id: 'NEXT' }); break
        case 'prev': store.dispatch({ type: 'PLAY_TRACK', id: 'PREV' }); break
        case 'stop':
          store.dispatch({ type: 'STOP' })
          invoke('update_media_playback', { playing: false }).catch(() => {})
          break
        case 'toggle_aot':
          setOnTop(!isOnTop())
          break
        case 'toggle_bottom':
          void sendToBack()
          break
      }
    })

    webview.listen<number>('goamp-node:profile-synced', ({ payload: peerCount }) => {
      const text = `${peerCount} peer${peerCount !== 1 ? 's' : ''} · synced just now`
      invoke('update_tray_tooltip', { text }).catch(() => {})
    })

    setTimeout(() => checkForUpdates(), 5_000)
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }
}
