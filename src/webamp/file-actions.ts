import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import { track, trackError } from '../lib/analytics'
import { toWebampTracks } from './tracks'
import { settings } from '../services/index'
import type Webamp from 'webamp'

export async function openFolder(webamp: Webamp): Promise<void> {
  const selected = await open({ directory: true, multiple: false, title: 'Select music folder' })
  if (!selected) return
  const path = typeof selected === 'string' ? selected : selected[0]
  if (!path) return
  try {
    const tracks = await settings.scanDirectory(path)
    if (tracks.length === 0) return
    webamp.setTracksToPlay(toWebampTracks(tracks))
    track('folder_opened', { track_count: tracks.length })
  } catch (e) { trackError(e, { action: 'open_folder' }) }
}

export async function openFiles(webamp: Webamp): Promise<void> {
  const selected = await open({
    multiple: true, title: 'Select audio files',
    filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'ogg', 'wav', 'opus', 'm4a', 'aac'] }],
  })
  if (!selected) return
  const paths = Array.isArray(selected) ? selected : [selected]
  try {
    const metas = await Promise.all(paths.map((p) => settings.readMetadata(p)))
    webamp.setTracksToPlay(toWebampTracks(metas))
    track('files_opened', { track_count: metas.length })
  } catch (e) { trackError(e, { action: 'open_files' }) }
}

export async function loadSkin(webamp: Webamp): Promise<void> {
  const selected = await open({
    multiple: false, title: 'Select Winamp skin (.wsz)',
    filters: [{ name: 'Winamp Skin', extensions: ['wsz', 'zip'] }],
  })
  if (!selected) return
  const path = typeof selected === 'string' ? selected : selected[0]
  if (!path) return
  try { webamp.setSkinFromUrl(convertFileSrc(path)); track('skin_loaded') }
  catch (e) { trackError(e, { action: 'load_skin' }) }
}
