import { surveyGetPending, surveyRespond, surveySkip } from '../lib/tauri-ipc';

const getNextSurvey = () => surveyGetPending();
const answerSurvey = (id: number, response: string) => surveyRespond(id, response);
const dismissSurvey = (id: number) => surveySkip(id);

export function createSurveyWidget(container: HTMLElement): { check: () => void } {
  const widget = document.createElement('div');
  widget.className = 'survey-widget';
  widget.style.display = 'none';
  container.appendChild(widget);

  async function check() {
    const survey = await getNextSurvey();
    if (!survey) {
      widget.style.display = 'none';
      return;
    }

    const payload = JSON.parse(survey.payload);
    widget.style.display = 'block';
    widget.innerHTML = '';

    const dismiss = document.createElement('button');
    dismiss.className = 'survey-dismiss';
    dismiss.textContent = '\u00d7';
    dismiss.onclick = () => {
      dismissSurvey(survey.id);
      widget.style.display = 'none';
    };
    widget.appendChild(dismiss);

    if (survey.survey_type === 'mood') {
      const label = document.createElement('span');
      label.textContent = 'This track feels:';
      widget.appendChild(label);
      for (const choice of payload.choices) {
        const btn = document.createElement('button');
        btn.className = 'survey-choice';
        btn.textContent = choice;
        btn.onclick = () => { answerSurvey(survey.id, choice); widget.style.display = 'none'; };
        widget.appendChild(btn);
      }
    } else if (survey.survey_type === 'genre') {
      const label = document.createElement('span');
      label.textContent = 'Best genre for this track:';
      widget.appendChild(label);
      for (const option of payload.options) {
        const btn = document.createElement('button');
        btn.className = 'survey-choice';
        btn.textContent = option;
        btn.onclick = () => { answerSurvey(survey.id, option); widget.style.display = 'none'; };
        widget.appendChild(btn);
      }
    } else if (survey.survey_type === 'similarity') {
      const label = document.createElement('span');
      label.textContent = 'Which two are most similar?';
      widget.appendChild(label);
      for (let i = 0; i < payload.tracks.length; i++) {
        for (let j = i + 1; j < payload.tracks.length; j++) {
          const btn = document.createElement('button');
          btn.className = 'survey-choice';
          btn.textContent = `${i + 1} & ${j + 1}`;
          btn.onclick = () => {
            answerSurvey(survey.id, `${payload.tracks[i]}|${payload.tracks[j]}`);
            widget.style.display = 'none';
          };
          widget.appendChild(btn);
        }
      }
    }
  }

  return { check };
}
