// src/bootstrap/keyboard.ts
import { toggleSearchOverlay } from '../youtube/SearchOverlay'
import { togglePlaylistPanel } from '../playlists/PlaylistPanel'
import { toggleAudioDevicePanel } from '../settings/AudioDevicePanel'
import { toggleScrobbleSettings } from '../scrobble/ScrobbleSettings'
import { toggleFeatureFlagsPanel } from '../settings/FeatureFlagsPanel'
import { toggleVisualizerPanel } from '../webamp/VisualizerPanel'
import { toggleMilkdrop } from '../webamp/milkdrop-controller'
import { toggleGenrePanel, toggleYouTubeSettings } from '../settings/GenrePanel'
import { toggleRadioPanel } from '../radio/RadioPanel'
import { toggleRecommendationPanel } from '../recommendations/RecommendationPanel'
export function setupKeyboard(
  openFolder: () => Promise<void>,
  openFiles: () => Promise<void>,
  loadSkin: () => Promise<void>,
): void {
  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyO') {
      e.preventDefault()
      await openFolder()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyO') {
      e.preventDefault()
      await openFiles()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyY') {
      e.preventDefault()
      toggleSearchOverlay()
    }
    const active = document.activeElement
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyP') {
      e.preventDefault()
      togglePlaylistPanel()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyS') {
      e.preventDefault()
      await loadSkin()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyD') {
      e.preventDefault()
      toggleAudioDevicePanel()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyL') {
      e.preventDefault()
      toggleScrobbleSettings()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyG') {
      e.preventDefault()
      toggleGenrePanel()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyR') {
      e.preventDefault()
      toggleRadioPanel()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyR') {
      e.preventDefault()
      toggleRecommendationPanel()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyY') {
      e.preventDefault()
      toggleYouTubeSettings()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyV') {
      e.preventDefault()
      toggleMilkdrop()
    }
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyV' && !isTyping) {
      toggleVisualizerPanel()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'Backquote') {
      e.preventDefault()
      toggleFeatureFlagsPanel()
    }
  })
}
