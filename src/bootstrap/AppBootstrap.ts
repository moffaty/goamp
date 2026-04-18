// src/bootstrap/AppBootstrap.ts
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { track } from '../lib/analytics'
import { setupWindowDrag, setupClickThrough } from '../webamp/window-drag'
import { openFolder, openFiles, loadSkin } from '../webamp/file-actions'
import { initSearchOverlay } from '../youtube/SearchOverlay'
import { initPlaylistPanel } from '../playlists/PlaylistPanel'
import { initAudioDevicePanel, restoreAudioDevice } from '../settings/AudioDevicePanel'
import { initScrobbleSettings } from '../scrobble/ScrobbleSettings'
import { initGoampMenu } from '../webamp/goamp-menu'
import { initVisualizerPanel } from '../webamp/VisualizerPanel'
import { initMilkdropController } from '../webamp/milkdrop-controller'
import { renderMoodTabs } from '../webamp/bridge'
import { initGenrePanel } from '../settings/GenrePanel'
import { initRadioPanel } from '../radio/RadioPanel'
import { initRecommendationPanel } from '../recommendations/RecommendationPanel'
import { checkForUpdates } from '../updater/UpdateNotification'
import { HistoryTracker } from '../recommendations/history-service'
import { PlayerStore } from '../player/PlayerStore'
import { PlayerEvents } from '../player/PlayerEvents'
import { saveSession, restoreSession } from './session'
import { setupKeyboard } from './keyboard'
import { playlists, scrobble, history, settings } from '../services/index'
import type Webamp from 'webamp'

export async function setupApp(webamp: Webamp): Promise<void> {
  const store = new PlayerStore(webamp)
  const events = new PlayerEvents(store)
  const appWindow = getCurrentWindow()

  appWindow.setAlwaysOnTop(false).catch(() => {})

  // Init panels
  initSearchOverlay(webamp)
  initPlaylistPanel(webamp)
  initAudioDevicePanel(webamp)
  initScrobbleSettings()
  initVisualizerPanel(webamp, store)
  initGenrePanel(webamp)
  initRadioPanel(webamp)
  initRecommendationPanel(webamp)
  initGoampMenu(webamp)
  initMilkdropController(store)
  renderMoodTabs().catch(() => {})
  restoreAudioDevice()
  settings.refreshFlagCache().catch(() => {})

  // Session restore
  await restoreSession(
    (tracks) => webamp.setTracksToPlay(tracks),
    () => store.dispatch({ type: 'STOP' }),
    playlists,
  ).catch((e) => console.error('[GOAMP] Failed to restore session:', e))

  // Scrobbling state (declared early so handleClose can reference them)
  let scrobbleTimer: ReturnType<typeof setInterval> | null = null
  let currentTrackStart = 0
  let currentTrackDuration = 0
  let currentTrackScrobbled = false
  let currentTrackArtist = ''
  let currentTrackTitle = ''
  const flushInterval = setInterval(() => { scrobble.flushQueue().catch(() => {}) }, 30000)

  // Close handler
  const handleClose = async () => {
    clearInterval(flushInterval)
    if (scrobbleTimer) clearInterval(scrobbleTimer)
    try { await saveSession(store, playlists) } catch (e) { console.error('[GOAMP] Failed to save session:', e) }
    appWindow.destroy()
  }
  webamp.onWillClose(handleClose)
  webamp.onClose(handleClose)

  // Track analytics
  events.onTrackChange((trackInfo) => {
    if (!trackInfo) return
    const url = trackInfo.url
    const source = url.startsWith('http') ? 'youtube' : 'local'
    const ext = url.split('.').pop()?.toLowerCase() || 'unknown'
    track('track_played', { source, format: source === 'local' ? ext : 'stream' })
    const meta = trackInfo.metaData
    const artist = (meta?.artist || 'Unknown').slice(0, 100)
    const title = (meta?.title || 'Unknown').slice(0, 100)
    if (meta?.artist || meta?.title) track('track_info', { artist, title, source })
    const tooltip = `${artist} — ${title}`
    invoke('update_tray_tooltip', { text: tooltip }).catch(() => {})
    invoke('update_media_metadata', { title, artist }).catch(() => {})
    invoke('update_media_playback', { playing: true }).catch(() => {})
  })

  // Media keys
  const webview = getCurrentWebviewWindow()
  webview.listen<string>('media-action', ({ payload }) => {
    switch (payload) {
      case 'play':
      case 'play_pause': {
        const status = store.getStatus()
        if (status === 'PLAYING') {
          store.dispatch({ type: 'PAUSE' })
          invoke('update_media_playback', { playing: false }).catch(() => {})
        } else {
          store.dispatch({ type: 'PLAY' })
          invoke('update_media_playback', { playing: true }).catch(() => {})
        }
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
      case 'quit': saveSession(store, playlists).catch(() => {}); break
    }
  })

  webview.listen<number>('goamp-node:profile-synced', ({ payload: peerCount }) => {
    const text = `${peerCount} peer${peerCount !== 1 ? 's' : ''} · synced just now`
    invoke('update_tray_tooltip', { text }).catch(() => {})
  })

  // Scrobbling

  events.onTrackChange(async (trackInfo) => {
    if (scrobbleTimer) clearInterval(scrobbleTimer)
    currentTrackScrobbled = false
    currentTrackStart = Math.floor(Date.now() / 1000)
    if (!trackInfo) return

    const meta = trackInfo.metaData
    currentTrackArtist = meta?.artist || ''
    currentTrackTitle = meta?.title || trackInfo.url.split('/').pop() || ''
    currentTrackDuration = trackInfo.duration || 0
    if (!currentTrackArtist && !currentTrackTitle) return

    if (!settings.isEnabled('auto_scrobble')) return
    const lastfmEnabled = localStorage.getItem('goamp_lastfm_enabled') === '1' && settings.isEnabled('lastfm_scrobble')
    const lbEnabled = localStorage.getItem('goamp_lb_enabled') === '1' && settings.isEnabled('listenbrainz_scrobble')
    if (!lastfmEnabled && !lbEnabled) return

    let hasLastfm = false, hasLb = false
    if (lastfmEnabled) { try { hasLastfm = !!(await scrobble.lastfmGetStatus()) } catch { /* ignore */ } }
    if (lbEnabled) { try { hasLb = !!(await scrobble.listenbrainzGetStatus()) } catch { /* ignore */ } }
    if (!hasLastfm && !hasLb) return

    const artist = currentTrackArtist || 'Unknown'
    const dur = currentTrackDuration > 0 ? Math.floor(currentTrackDuration) : undefined
    if (hasLastfm) scrobble.lastfmNowPlaying(artist, currentTrackTitle, dur).catch(() => {})
    if (hasLb) scrobble.listenbrainzNowPlaying(artist, currentTrackTitle).catch(() => {})

    scrobbleTimer = setInterval(() => {
      if (currentTrackScrobbled) { if (scrobbleTimer) clearInterval(scrobbleTimer); return }
      if (store.getStatus() !== 'PLAYING') return
      const elapsed = Math.floor(Date.now() / 1000) - currentTrackStart
      const threshold = Math.min(currentTrackDuration > 0 ? currentTrackDuration / 2 : Infinity, 240)
      if (elapsed >= threshold) {
        currentTrackScrobbled = true
        if (scrobbleTimer) clearInterval(scrobbleTimer)
        const sd = currentTrackDuration > 0 ? Math.floor(currentTrackDuration) : undefined
        if (hasLastfm) scrobble.lastfmScrobble(artist, currentTrackTitle, currentTrackStart, sd).catch(() => {})
        if (hasLb) scrobble.listenbrainzScrobble(artist, currentTrackTitle, currentTrackStart, sd).catch(() => {})
      }
    }, 5000)
  })

  // History tracking
  if (settings.isEnabled('recommendations')) {
    function extractSource(url: string): { source: string; sourceId: string } {
      if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('audio_cache')) {
        const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/)
        return { source: 'youtube', sourceId: match?.[1] ?? url }
      }
      if (url.includes('soundcloud.com')) return { source: 'soundcloud', sourceId: url }
      return { source: 'local', sourceId: url }
    }

    const historyTracker = new HistoryTracker(
      (source, sourceId, artist, title, duration) => history.resolveTrackId(source, sourceId, artist, title, duration),
      (canonicalId, source, startedAt, durationSecs, listenedSecs, completed, skippedEarly) =>
        history.recordListen(canonicalId, source, startedAt, durationSecs, listenedSecs, completed, skippedEarly),
    )
    let tracking = false

    events.onTrackChange((trackInfo) => {
      if (tracking) {
        const listenedSecs = Math.floor(store.getTimeElapsed())
        historyTracker.onTrackEnd(listenedSecs).catch(() => {})
        tracking = false
      }
      if (!trackInfo) return
      const url = trackInfo.url
      const meta = trackInfo.metaData
      const { source, sourceId } = extractSource(url)
      historyTracker.onTrackStart(source, sourceId, meta?.artist || '', meta?.title || '', trackInfo.duration ?? 0)
      tracking = true
    })
  }

  setupKeyboard(
    () => openFolder(webamp),
    () => openFiles(webamp),
    () => loadSkin(webamp),
  )
  setupWindowDrag()
  setupClickThrough()

  setTimeout(() => checkForUpdates(), 5000)
}
