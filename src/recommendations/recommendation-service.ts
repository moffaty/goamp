import {
  getHybridRecommendations,
  getColdstartRecommendations,
  listMoodChannels,
  syncProfile,
  surveyGetPending,
  surveyRespond,
  surveySkip,
  type MoodChannel,
  type Survey,
} from '../lib/tauri-ipc';

export interface Recommendation {
  canonicalId: string;
  score: number;
  source: string;
  artist: string;
  title: string;
}

export async function fetchRecommendations(limit = 30): Promise<Recommendation[]> {
  const recs = await getHybridRecommendations(limit);
  return recs.map(([canonicalId, score, source, artist, title]) => ({ canonicalId, score, source, artist, title }));
}

export async function fetchColdstart(artist: string, title: string, limit = 20) {
  return getColdstartRecommendations(artist, title, limit);
}

export async function getMoodChannels(): Promise<MoodChannel[]> {
  return listMoodChannels();
}

export async function syncWithServer(): Promise<number> {
  return syncProfile();
}

export async function getNextSurvey(): Promise<Survey | null> {
  return surveyGetPending();
}

export async function answerSurvey(surveyId: number, response: string): Promise<void> {
  return surveyRespond(surveyId, response);
}

export async function dismissSurvey(surveyId: number): Promise<void> {
  return surveySkip(surveyId);
}
