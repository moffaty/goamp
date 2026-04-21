// src/services/index.ts
import { TauriTransport } from './transport'
import { PlaylistService } from './PlaylistService'
import { ScrobbleService } from './ScrobbleService'
import { HistoryService } from './HistoryService'
import { RadioService } from './RadioService'
import { RecommendationService } from './RecommendationService'
import { SettingsService } from './SettingsService'
import { AccountService } from './AccountService'

const transport = new TauriTransport()

export const playlists = new PlaylistService(transport)
export const scrobble = new ScrobbleService(transport)
export const history = new HistoryService(transport)
export const radio = new RadioService(transport)
export const recommendations = new RecommendationService(transport)
export const settings = new SettingsService(transport)
export const account = new AccountService(transport)

export { AccountService } from './AccountService'
