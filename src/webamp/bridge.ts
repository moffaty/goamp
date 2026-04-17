import { moodService } from "../recommendations/mood-service";

let moodTabsEl: HTMLDivElement | null = null;

export async function renderMoodTabs(): Promise<void> {
  if (moodTabsEl) {
    moodTabsEl.remove();
    moodTabsEl = null;
  }

  const moods = await moodService.listMoods();
  const webampEl = document.getElementById("webamp");
  if (!webampEl) return;

  moodTabsEl = document.createElement("div");
  moodTabsEl.id = "mood-tabs";
  moodTabsEl.style.cssText = `
    display: flex; gap: 3px; padding: 2px 4px; background: #000;
    border-top: 1px solid #333; align-items: center; flex-wrap: wrap;
    font-family: 'MS Sans Serif', Tahoma, sans-serif; font-size: 10px;
  `;

  const render = () => {
    moodTabsEl!.innerHTML = "";
    moods.forEach((m) => {
      const tab = document.createElement("span");
      tab.className = "mood-tab";
      tab.dataset.moodId = m.id;
      const isActive = moodService.activeMood === m.id;
      tab.style.cssText = `
        padding: 1px 6px; cursor: pointer; border: 1px solid;
        border-color: ${isActive ? "#0f0" : "#444"};
        background: ${isActive ? "#1a3a1a" : "#111"};
        color: ${isActive ? "#0f0" : "#666"};
        user-select: none;
      `;
      tab.textContent = (isActive ? "● " : "") + m.name;
      tab.addEventListener("click", () => {
        moodService.setMood(moodService.activeMood === m.id ? null : m.id);
      });
      moodTabsEl!.appendChild(tab);
    });

    const addBtn = document.createElement("span");
    addBtn.id = "mood-tab-add";
    addBtn.style.cssText =
      "padding: 1px 6px; cursor: pointer; color: #444; border: 1px solid #222; background: #111;";
    addBtn.textContent = "+ add";
    addBtn.addEventListener("click", () => promptCreateMood());
    moodTabsEl!.appendChild(addBtn);
  };

  render();
  moodService.onMoodChange(() => render());

  const mainWindow = webampEl.querySelector("#main-window") ?? webampEl.firstElementChild;
  if (mainWindow && mainWindow.parentNode) {
    mainWindow.parentNode.insertBefore(moodTabsEl, mainWindow.nextSibling);
  } else {
    webampEl.appendChild(moodTabsEl);
  }
}

function promptCreateMood(): void {
  const name = window.prompt("Mood name:");
  if (!name?.trim()) return;
  const id = name.trim().toLowerCase().replace(/\s+/g, "_");
  moodService.createMood(id, name.trim(), []).then(() => renderMoodTabs());
}
