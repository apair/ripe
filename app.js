import {
  addTask,
  bannerText,
  CLASSIC_TIMING,
  applyAutoStart,
  clearFinished,
  completeIfDue,
  cueText,
  durationMs,
  formatClock,
  hydrate,
  pause,
  phaseLabel,
  pipMarks,
  remaining,
  removeTask,
  reset,
  rollDay,
  roundLabel,
  selectTask,
  setEstimate,
  skip,
  start,
  switchPhase,
  taskSummary,
  todayLabel,
  toggleTask,
  updateSettings,
} from "./timer.js";

const STORAGE_KEY = "ripe.timer.v1";
const THEME_KEY = "ripe.theme";
const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const timeEl = document.getElementById("time");
const phaseEl = document.getElementById("phase-label");
const chipEl = document.getElementById("status-chip");
const pipsEl = document.getElementById("pips");
const roundEl = document.getElementById("round-hint");
const cueEl = document.getElementById("cue");
const summaryEl = document.getElementById("task-summary");
const todayEl = document.getElementById("today");
const plateBtn = document.getElementById("plate");
const resetBtn = document.getElementById("reset");
const skipBtn = document.getElementById("skip");
const confirmReset = document.getElementById("confirm-reset");
const confirmLead = document.getElementById("confirm-reset-lead");
const bannerEl = document.getElementById("banner");
const tasksEl = document.getElementById("tasks");
const taskEmptyEl = document.getElementById("task-empty");
const historyEl = document.getElementById("history");
const historyEmptyEl = document.getElementById("history-empty");
const clearBtn = document.getElementById("clear-finished");
const taskForm = document.getElementById("task-form");
const taskInput = document.getElementById("task-input");
const addBtn = document.getElementById("add-task");
const progressEl = document.getElementById("progress");
const ringEl = document.getElementById("ring");
const liveEl = document.getElementById("live");
const dialog = document.getElementById("settings");
const openSettingsBtn = document.getElementById("open-settings");
const themeBtn = document.getElementById("theme-toggle");
const themeMeta = document.querySelector('meta[name="theme-color"]');
const classicBtn = document.getElementById("classic");
const notifyNote = document.getElementById("notify-note");

const modeButtons = [...document.querySelectorAll(".mode")];
const setFocus = document.getElementById("set-focus");
const setShort = document.getElementById("set-short");
const setLong = document.getElementById("set-long");
const setRounds = document.getElementById("set-rounds");
const setAutoBreaks = document.getElementById("set-auto-breaks");
const setAutoFocus = document.getElementById("set-auto-focus");
const setAutoCheck = document.getElementById("set-auto-check");
const setAutoSwitch = document.getElementById("set-auto-switch");
const setSound = document.getElementById("set-sound");
const setNotify = document.getElementById("set-notify");

let state = load();
let pulseTaskId = null;
let pulseTimer = 0;
let audioCtx = null;
let lastAnnouncement = "";

function load() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  const loaded = hydrate(saved, Date.now());
  if (loaded.completed && Date.now() - loaded.completed.endedAt <= 5000) {
    queueMicrotask(() => feedback(loaded.completed));
  }
  return loaded.state;
}

function persist() {
  try {
    const snapshot = state.status === "running"
      ? { ...state, remainingMs: remaining(state, Date.now()) }
      : state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* Private mode or a full disk. The timer still runs in memory. */
  }
}

function commit(next, completed) {
  if (next === state && !completed) return;
  if (completed?.taskId) armPulse(completed.taskId);
  state = next;
  persist();
  render();
  if (completed) feedback(completed);
}

function armPulse(taskId) {
  pulseTaskId = taskId;
  window.clearTimeout(pulseTimer);
  pulseTimer = window.setTimeout(() => {
    pulseTaskId = null;
    render();
  }, 800);
}

let lastPersistedSecond = 0;

function tick() {
  const now = Date.now();
  const rolled = applyAutoStart(rollDay(state, now), now);
  const result = completeIfDue(rolled, now);
  if (result.completed) {
    commit(result.state, result.completed);
    return;
  }
  if (result.state !== state) {
    commit(result.state);
    return;
  }
  if (state.status === "running") {
    paintClock();
    const second = Math.floor(now / 1000);
    if (second !== lastPersistedSecond) {
      lastPersistedSecond = second;
      persist();
    }
  }
}

function paintClock() {
  const now = Date.now();
  const left = remaining(state, now);
  const total = state.status === "idle"
    ? durationMs(state.settings, state.phase)
    : (state.plannedMs || durationMs(state.settings, state.phase));
  const clock = formatClock(left);
  timeEl.textContent = clock;
  timeEl.dataset.digits = String(clock.length);
  const label = phaseLabel(state.phase);
  const spoken = spokenRemaining(left);
  timeEl.setAttribute("aria-label", `${spoken} remaining, ${label}`);
  paintRing(left, total);
  if (state.status === "running" || state.status === "paused") {
    document.title = `${clock} · ${label} — Ripe`;
  } else {
    document.title = "Ripe — Pomodoro timer";
  }
}

function spokenRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const minuteText = minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const secondText = seconds === 1 ? "1 second" : `${seconds} seconds`;
  return `${minuteText} ${secondText}`;
}

function paintRing(left, total) {
  const ratio = total <= 0 ? 0 : Math.min(1, Math.max(0, left / total));
  progressEl.style.strokeDasharray = `${RING_LENGTH}`;
  progressEl.style.strokeDashoffset = `${RING_LENGTH * (1 - ratio)}`;
  progressEl.style.strokeLinecap = ratio > 0.985 || ratio < 0.015 ? "butt" : "round";
}

function render() {
  document.body.dataset.phase = state.phase;
  const restore = restoreKey(document.activeElement);
  paintClock();

  phaseEl.textContent = phaseLabel(state.phase);
  chipEl.hidden = state.status !== "paused";
  roundEl.textContent = roundLabel(state);
  cueEl.textContent = cueText(state);
  todayEl.textContent = todayLabel(state);

  for (const button of modeButtons) {
    const on = button.dataset.phase === state.phase;
    button.setAttribute("aria-checked", on ? "true" : "false");
  }
  document.getElementById("len-focus").textContent = `${state.settings.focusMin} min`;
  document.getElementById("len-short").textContent = `${state.settings.shortMin} min`;
  document.getElementById("len-long").textContent = `${state.settings.longMin} min`;

  plateBtn.setAttribute("aria-label", state.status === "running"
    ? "Pause"
    : state.status === "paused"
      ? "Resume"
      : "Start");
  skipBtn.disabled = state.status === "idle";

  const message = bannerText(state.banner);
  bannerEl.hidden = !message;
  bannerEl.textContent = message;

  renderPips();
  renderTasks();
  renderHistory();
  syncSettingsForm();

  if (restore) {
    document.querySelector(`[data-restore="${cssEscape(restore)}"]`)?.focus();
  }
}

function renderPips() {
  const marks = pipMarks(state);
  pipsEl.replaceChildren();
  for (let index = 0; index < marks.total; index += 1) {
    const pip = document.createElement("span");
    pip.className = "pip";
    if (index < marks.done) pip.classList.add("is-done");
    if (index === marks.current) pip.classList.add("is-current");
    pipsEl.append(pip);
  }
}

function renderTasks() {
  clearBtn.hidden = !state.tasks.some((task) => task.done);
  taskEmptyEl.hidden = state.tasks.length > 0;
  tasksEl.replaceChildren();
  for (const task of state.tasks) {
    const item = document.createElement("li");
    item.className = "task";
    if (task.id === state.activeTaskId) item.classList.add("is-active");
    if (task.done) item.classList.add("is-done");
    if (task.id === pulseTaskId) item.classList.add("is-pulsed");

    const checkLabel = document.createElement("label");
    checkLabel.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = task.done;
    box.dataset.action = "toggle";
    box.dataset.restore = `toggle:${task.id}`;
    box.setAttribute("aria-label", task.done ? `Mark not done: ${task.title}` : `Mark done: ${task.title}`);
    checkLabel.append(box);

    const main = document.createElement("button");
    main.type = "button";
    main.className = "task-main";
    main.dataset.action = "select";
    main.dataset.restore = `select:${task.id}`;
    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;
    main.append(title);

    const estimate = document.createElement("span");
    estimate.className = "estimate";
    const down = document.createElement("button");
    down.type = "button";
    down.className = "step";
    down.dataset.action = "estimate-down";
    down.dataset.restore = `estimate-down:${task.id}`;
    down.setAttribute("aria-label", `Decrease estimate for ${task.title}`);
    down.textContent = "−";
    down.disabled = task.estimate <= 1;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${task.pomodoros}/${task.estimate}`;
    count.setAttribute("aria-label", `${task.pomodoros} of ${task.estimate} pomodoros`);
    const up = document.createElement("button");
    up.type = "button";
    up.className = "step";
    up.dataset.action = "estimate-up";
    up.dataset.restore = `estimate-up:${task.id}`;
    up.setAttribute("aria-label", `Increase estimate for ${task.title}`);
    up.textContent = "+";
    up.disabled = task.estimate >= 99;
    estimate.append(down, count, up);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.dataset.action = "remove";
    remove.dataset.restore = `remove:${task.id}`;
    remove.setAttribute("aria-label", `Remove ${task.title}`);
    remove.textContent = "×";

    item.append(checkLabel, main, estimate, remove);
    tasksEl.append(item);
  }
  renderSummary();
}

function renderSummary() {
  if (state.tasks.length === 0) {
    summaryEl.hidden = true;
    summaryEl.textContent = "";
    return;
  }
  const summary = taskSummary(state, Date.now());
  const when = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(summary.finishAt);
  summaryEl.hidden = false;
  summaryEl.textContent = `Pomos: ${summary.act}/${summary.est} · Finish at ${when} (${summary.hours}h)`;
}

function renderHistory() {
  const entries = state.history.filter((entry) => dayKeyOf(entry.endedAt) === state.todayKey);
  historyEmptyEl.hidden = entries.length > 0;
  historyEl.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.dataset.phase = entry.phase;
    const copy = document.createElement("div");
    copy.className = "history-copy";
    const line = document.createElement("strong");
    line.textContent = `${phaseLabel(entry.phase)} · ${formatMinutes(entry.ms)}`;
    copy.append(line);
    if (entry.taskTitle) {
      const task = document.createElement("span");
      task.textContent = entry.taskTitle;
      copy.append(task);
    }
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = formatWhen(entry.endedAt);
    item.append(dot, copy, when);
    historyEl.append(item);
  }
}

function syncSettingsForm() {
  setNumber(setFocus, state.settings.focusMin);
  setNumber(setShort, state.settings.shortMin);
  setNumber(setLong, state.settings.longMin);
  setNumber(setRounds, state.settings.roundsUntilLong);
  setAutoBreaks.checked = state.settings.autoStartBreaks;
  setAutoFocus.checked = state.settings.autoStartFocus;
  setAutoCheck.checked = state.settings.autoCheckTasks;
  setAutoSwitch.checked = state.settings.autoSwitchTasks;
  setSound.checked = state.settings.sound;
  setNotify.checked = state.settings.notify;
}

function setNumber(input, value) {
  if (document.activeElement === input) return;
  input.value = String(value);
}

function readSettingsPatch() {
  return {
    focusMin: setFocus.value,
    shortMin: setShort.value,
    longMin: setLong.value,
    roundsUntilLong: setRounds.value,
    autoStartBreaks: setAutoBreaks.checked,
    autoStartFocus: setAutoFocus.checked,
    autoCheckTasks: setAutoCheck.checked,
    autoSwitchTasks: setAutoSwitch.checked,
    sound: setSound.checked,
    notify: setNotify.checked,
  };
}

function applySettings() {
  commit(updateSettings(state, readSettingsPatch(), Date.now()));
}

function toggleRun() {
  unlockAudio();
  const now = Date.now();
  if (state.status === "running") {
    commit(pause(state, now));
    announce("Paused");
  } else {
    const next = start(state, now);
    commit(next);
    announce(`${phaseLabel(next.phase)} started`);
  }
}

function feedback(completed) {
  if (state.settings.sound) chime(completed.phase);
  notify(completed);
  announce(bannerText(state.banner));
}

function announce(message) {
  if (!message || message === lastAnnouncement) return;
  lastAnnouncement = message;
  liveEl.textContent = message;
}

function unlockAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function chime(phase) {
  unlockAudio();
  if (!audioCtx || audioCtx.state === "suspended") return;
  const notes = phase === "focus" ? [523.25, 659.25, 783.99] : [392, 523.25];
  for (let index = 0; index < notes.length; index += 1) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = notes[index];
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const startAt = audioCtx.currentTime + index * 0.14;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.06, startAt + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.7);
    osc.start(startAt);
    osc.stop(startAt + 0.72);
  }
}

function notify(completed) {
  if (!state.settings.notify || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const title = bannerText(state.banner) || "Timer finished";
  const body = cueText(state);
  try {
    const notification = new Notification(title, { body, silent: true });
    window.setTimeout(() => notification.close(), 6000);
  } catch {
    /* Some browsers reject Notification outside a secure user gesture. */
  }
}

function onTaskClick(event) {
  const item = event.target.closest(".task");
  if (!item) return;
  const actionEl = event.target.closest("[data-action]");
  const action = actionEl?.dataset.action;
  const id = taskIdFrom(item);
  if (!id) return;
  if (action === "toggle") commit(toggleTask(state, id));
  else if (action === "remove") commit(removeTask(state, id));
  else if (action === "select") commit(selectTask(state, id));
  else if (action === "estimate-down" || action === "estimate-up") {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    const next = action === "estimate-down" ? task.estimate - 1 : task.estimate + 1;
    commit(setEstimate(state, id, next));
  }
}

function taskIdFrom(item) {
  const control = item.querySelector("[data-restore]");
  const key = control?.dataset.restore || "";
  const split = key.indexOf(":");
  return split === -1 ? "" : key.slice(split + 1);
}

function restoreKey(node) {
  const control = node?.closest?.("[data-restore]");
  return control?.dataset.restore || "";
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function dayKeyOf(timestamp) {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatMinutes(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return `${minutes}m`;
}

function formatWhen(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

document.addEventListener("pointerdown", unlockAudio, { passive: true });

plateBtn.addEventListener("click", toggleRun);
resetBtn.addEventListener("click", () => {
  const label = phaseLabel(state.phase).toLowerCase();
  confirmLead.textContent = `The ${label} clock goes back to the start. This interval is not counted.`;
  confirmReset.showModal();
});
confirmReset.addEventListener("click", (event) => {
  if (event.target === confirmReset) confirmReset.close();
});
confirmReset.addEventListener("close", () => {
  const confirmed = confirmReset.returnValue === "reset";
  confirmReset.returnValue = "";
  if (!confirmed) {
    resetBtn.focus();
    return;
  }
  commit(reset(state, Date.now()));
  announce(`${phaseLabel(state.phase)} reset`);
  plateBtn.focus();
});
skipBtn.addEventListener("click", () => {
  const step = skip(state, Date.now());
  if (step.state === state) return;
  commit(step.state, step.completed);
});

function choosePhase(phase) {
  const next = switchPhase(state, phase, Date.now());
  commit(next);
  announce(phaseLabel(next.phase));
}

for (const button of modeButtons) {
  button.addEventListener("click", () => choosePhase(button.dataset.phase));
}

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const next = addTask(state, taskInput.value, Date.now());
  if (next === state) return;
  taskInput.value = "";
  addBtn.disabled = true;
  commit(next);
  taskInput.focus();
});

taskInput.addEventListener("input", () => {
  addBtn.disabled = taskInput.value.trim().length === 0;
});

tasksEl.addEventListener("click", onTaskClick);
clearBtn.addEventListener("click", () => commit(clearFinished(state)));

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  const dark = next === "dark";
  document.documentElement.dataset.theme = next;
  if (themeMeta) themeMeta.setAttribute("content", dark ? "#161210" : "#efe4d4");
  if (themeBtn) {
    themeBtn.setAttribute("aria-pressed", dark ? "true" : "false");
    themeBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
}

function rememberTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* The toggle still changes this page when storage is blocked. */
  }
}

applyTheme(currentTheme());

themeBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  rememberTheme(next);
});

const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
themeQuery.addEventListener("change", (event) => {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    saved = null;
  }
  if (saved === "light" || saved === "dark") return;
  applyTheme(event.matches ? "dark" : "light");
});

openSettingsBtn.addEventListener("click", () => {
  syncSettingsForm();
  notifyNote.hidden = true;
  dialog.showModal();
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  openSettingsBtn.focus();
});

for (const input of [setFocus, setShort, setLong, setRounds]) {
  input.addEventListener("change", applySettings);
}
for (const input of [setAutoBreaks, setAutoFocus, setAutoCheck, setAutoSwitch, setSound]) {
  input.addEventListener("change", applySettings);
}

setNotify.addEventListener("change", async () => {
  if (setNotify.checked && "Notification" in window && Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setNotify.checked = false;
      notifyNote.hidden = false;
    }
  }
  applySettings();
});

classicBtn.addEventListener("click", () => {
  commit(updateSettings(state, CLASSIC_TIMING, Date.now()));
  syncSettingsForm();
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = document.activeElement?.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA";
  if (event.key === "Escape" && (dialog.open || confirmReset.open)) {
    if (confirmReset.open) confirmReset.close();
    else dialog.close();
    return;
  }
  if (typing || dialog.open || confirmReset.open) return;
  if (event.key === " " && tag !== "BUTTON") {
    event.preventDefault();
    toggleRun();
  } else if (event.key === "r" || event.key === "R") {
    resetBtn.click();
  } else if (event.key === "n" || event.key === "N") {
    skipBtn.click();
  } else if (event.key === "1") {
    choosePhase("focus");
  } else if (event.key === "2") {
    choosePhase("short");
  } else if (event.key === "3") {
    choosePhase("long");
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === THEME_KEY) {
    applyTheme(event.newValue === "dark" ? "dark" : "light");
    return;
  }
  if (event.key !== STORAGE_KEY) return;
  const loaded = hydrate(event.newValue, Date.now());
  state = loaded.state;
  render();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") tick();
  else persist();
});

window.addEventListener("pagehide", persist);

ringEl.classList.add("is-instant");
render();
requestAnimationFrame(() => ringEl.classList.remove("is-instant"));
window.setInterval(tick, 250);
