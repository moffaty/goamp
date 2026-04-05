import {
  fetchRecommendations,
  getMoodChannels,
  syncWithServer,
} from './recommendation-service';
import { createSurveyWidget } from './SurveyWidget';
import type Webamp from 'webamp';

let panelContainer: HTMLElement | null = null;
let visible = false;

export function initRecommendationPanel(_webamp: Webamp) {
  // Panel is lazily created on first toggle
}

export function toggleRecommendationPanel() {
  if (!panelContainer) {
    panelContainer = buildPanel();
    document.body.appendChild(panelContainer);
  }
  visible = !visible;
  panelContainer.style.display = visible ? 'block' : 'none';
}

function buildPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'recommendation-panel';
  panel.style.cssText = `
    position: fixed;
    top: 50px;
    right: 10px;
    width: 280px;
    background: #000;
    border: 1px solid #0f0;
    color: #0f0;
    font-family: monospace;
    font-size: 11px;
    z-index: 9999;
    padding: 8px;
    max-height: 400px;
    overflow-y: auto;
  `;

  panel.innerHTML = `
    <div class="rec-header" style="display:flex;justify-content:space-between;margin-bottom:6px;">
      <span style="font-weight:bold;">RECOMMENDATIONS</span>
      <button class="rec-sync" title="Sync with network" style="background:none;border:1px solid #0f0;color:#0f0;cursor:pointer;padding:1px 4px;">&#x21bb;</button>
    </div>
    <div class="rec-channels" style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:3px;"></div>
    <div class="rec-list"></div>
    <div class="rec-survey-area" style="margin-top:6px;"></div>
  `;

  const channelsEl = panel.querySelector('.rec-channels') as HTMLElement;
  const listEl = panel.querySelector('.rec-list') as HTMLElement;
  const syncBtn = panel.querySelector('.rec-sync') as HTMLButtonElement;
  const surveyArea = panel.querySelector('.rec-survey-area') as HTMLElement;

  const survey = createSurveyWidget(surveyArea);
  let activeChannel: string | null = null;

  async function loadChannels() {
    const channels = await getMoodChannels();
    channelsEl.innerHTML = '';
    const mkTab = (label: string, id: string | null) => {
      const tab = document.createElement('button');
      tab.textContent = label;
      tab.style.cssText = `background:${activeChannel === id ? '#0f0' : 'none'};color:${activeChannel === id ? '#000' : '#0f0'};border:1px solid #0f0;cursor:pointer;padding:1px 5px;font-size:10px;`;
      tab.onclick = () => { activeChannel = id; loadRecommendations(); loadChannels(); };
      channelsEl.appendChild(tab);
    };
    mkTab('All', null);
    channels.forEach(ch => mkTab(ch.name, ch.id));
  }

  async function loadRecommendations() {
    listEl.innerHTML = '<div style="opacity:0.6;">Loading...</div>';
    const recs = await fetchRecommendations(30);
    listEl.innerHTML = '';
    if (recs.length === 0) {
      listEl.innerHTML = '<div style="opacity:0.6;">Listen to more music to get recommendations!</div>';
      return;
    }
    for (const rec of recs) {
      const item = document.createElement('div');
      item.style.cssText = 'padding:2px 0;border-bottom:1px solid #030;display:flex;justify-content:space-between;';
      const displayName = rec.artist && rec.title
        ? `${rec.artist} — ${rec.title}`
        : rec.canonicalId.substring(0, 12) + '...';
      item.innerHTML = `<span>${displayName}</span><span style="opacity:0.7;">${Math.round(rec.score * 100)}%</span>`;
      listEl.appendChild(item);
    }
  }

  syncBtn.onclick = async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = '...';
    try {
      const count = await syncWithServer();
      syncBtn.textContent = `\u2713${count}`;
      await loadRecommendations();
    } catch {
      syncBtn.textContent = '\u2717';
    }
    setTimeout(() => { syncBtn.textContent = '\u21bb'; syncBtn.disabled = false; }, 3000);
  };

  loadChannels();
  loadRecommendations();
  survey.check();
  setInterval(() => survey.check(), 15 * 60 * 1000);

  return panel;
}
