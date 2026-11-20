/**
 * Pomodoro state machine, following the Pomofocus session rules.
 * Every function takes the current time so the clock can be moved in
 * tests and a running session survives a reload.
 *
 * status: "idle" | "running" | "paused"
 * phase:  "focus" | "short" | "long"
 *
 * pomodorosToday is the number of focus intervals finished today. It does
 * not reset when the long break starts. The long break arrives when that
 * count is a multiple of the long-break interval. A zero-length break is
 * skipped. The number under the timer is today's current pomodoro during
 * focus, and the pomodoro just finished during a break.
 */

export const PHASES = ["focus", "short", "long"];

export const DEFAULT_SETTINGS = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  roundsUntilLong: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  autoCheckTasks: false,
  autoSwitchTasks: true,
  sound: true,
  notify: false,
};

export const CLASSIC_TIMING = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  roundsUntilLong: 4,
};

const LIMITS = {
  focusMin: [1, 120],
  shortMin: [0, 60],
  longMin: [0, 60],
  roundsUntilLong: [1, 12],
  estimate: [1, 99],
};

const AUTO_START_WINDOW_MS = 5000;
const AUTO_START_DELAY_MS = 2000;

export function durationMs(settings, phase) {
  const key = phase === "short" ? "shortMin" : phase === "long" ? "longMin" : "focusMin";
  return settings[key] * 60 * 1000;
}

export function freshState(now = Date.now(), settings = DEFAULT_SETTINGS) {
  const normalized = normalizeSettings(settings);
  return {
    settings: normalized,
    phase: "focus",
    status: "idle",
    endsAt: null,
    remainingMs: durationMs(normalized, "focus"),
    plannedMs: null,
    pomodorosToday: 0,
    autoStartAt: null,
    todayKey: dayKey(now),
    focusDoneToday: 0,
    focusMsToday: 0,
    activeTaskId: null,
    tasks: [],
    history: [],
    banner: null,
  };
}

export function dayKey(now) {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function rollDay(state, now) {
  const key = dayKey(now);
  if (key === state.todayKey) return state;
  return {
    ...state,
    todayKey: key,
    focusDoneToday: 0,
    focusMsToday: 0,
    pomodorosToday: 0,
  };
}

export function remaining(state, now) {
  if (state.status === "running" && Number.isFinite(state.endsAt)) {
    return Math.max(0, state.endsAt - now);
  }
  return Math.max(0, state.remainingMs);
}

export function ringFraction(left, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const safe = Number.isFinite(left) ? left : 0;
  return Math.min(1, Math.max(0, safe / total));
}

export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatSpan(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function todayLabel(state) {
  if (state.focusDoneToday <= 0) return "No focus yet today";
  const blocks = state.focusDoneToday === 1 ? "1 focus block" : `${state.focusDoneToday} focus blocks`;
  return `${blocks} · ${formatSpan(state.focusMsToday)} today`;
}

export function sessionNumber(state) {
  const count = state.pomodorosToday;
  if (state.phase === "focus" || count === 0) return count + 1;
  return count;
}

export function roundLabel(state) {
  return `#${sessionNumber(state)}`;
}

export function cueText(state) {
  const active = state.tasks.find((task) => task.id === state.activeTaskId);
  if (active) return active.title;
  return state.phase === "focus" ? "Time to focus!" : "Time for a break!";
}

export function phaseLabel(phase) {
  if (phase === "short") return "Short break";
  if (phase === "long") return "Long break";
  return "Focus";
}

export function bannerText(banner) {
  if (!banner) return "";
  if (banner.from === "focus" && banner.to === "long") return "Time to take a long break!";
  if (banner.from === "focus" && banner.to === "short") return "Time to take a short break!";
  return "Time to focus!";
}

export function pipMarks(state) {
  const total = state.settings.roundsUntilLong;
  const inCycle = state.pomodorosToday % total;
  if (state.phase === "long") return { total, done: total, current: -1 };
  if (state.phase === "short") return { total, done: inCycle, current: -1 };
  return { total, done: inCycle, current: inCycle };
}

export function nextPhase(from, pomodorosToday, settings) {
  if (from !== "focus") return "focus";
  const finishedCycle = pomodorosToday % settings.roundsUntilLong === 0;
  if (finishedCycle) return settings.longMin <= 0 ? "focus" : "long";
  return settings.shortMin <= 0 ? "focus" : "short";
}

export function start(state, now) {
  if (state.status === "running") return state;
  const plannedMs = state.status === "paused" && state.plannedMs ? state.plannedMs : state.remainingMs;
  return {
    ...state,
    status: "running",
    endsAt: now + state.remainingMs,
    plannedMs,
    autoStartAt: null,
    banner: null,
  };
}

export function pause(state, now) {
  if (state.status !== "running") return state;
  return {
    ...state,
    status: "paused",
    endsAt: null,
    autoStartAt: null,
    remainingMs: remaining(state, now),
  };
}

export function reset(state, now) {
  return {
    ...rollDay(state, now),
    status: "idle",
    endsAt: null,
    remainingMs: durationMs(state.settings, state.phase),
    plannedMs: null,
    autoStartAt: null,
    banner: null,
  };
}

export function switchPhase(state, phase, now) {
  if (!PHASES.includes(phase)) return state;
  return {
    ...rollDay(state, now),
    phase,
    status: "idle",
    endsAt: null,
    remainingMs: durationMs(state.settings, phase),
    plannedMs: null,
    autoStartAt: null,
    banner: null,
  };
}

export function skip(state, now) {
  if (state.status === "idle") return { state, completed: null };
  return finish(rollDay(state, now), now, now, true);
}

export function updateSettings(state, patch, now) {
  const settings = normalizeSettings({ ...state.settings, ...patch });
  const next = { ...state, settings };
  if (state.status === "idle") {
    return {
      ...rollDay(next, now),
      endsAt: null,
      plannedMs: null,
      remainingMs: durationMs(settings, state.phase),
    };
  }
  return next;
}

export function addTask(state, title, now = Date.now(), estimate = 1) {
  const clean = String(title || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!clean) return state;
  const task = {
    id: createId(now),
    title: clean,
    done: false,
    pomodoros: 0,
    estimate: clamp(estimate, ...LIMITS.estimate, 1),
    createdAt: now,
  };
  return {
    ...state,
    tasks: [task, ...state.tasks].slice(0, 24),
    activeTaskId: task.id,
  };
}

export function setEstimate(state, id, estimate) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  const value = clamp(estimate, ...LIMITS.estimate, task.estimate);
  if (value === task.estimate) return state;
  return {
    ...state,
    tasks: state.tasks.map((item) => (
      item.id === id ? { ...item, estimate: value } : item
    )),
  };
}

export function toggleTask(state, id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  const done = !task.done;
  let tasks = state.tasks.map((item) => (
    item.id === id ? { ...item, done } : item
  ));
  let activeTaskId = state.activeTaskId;
  if (done && state.settings.autoSwitchTasks) {
    ({ tasks, activeTaskId } = handOff(tasks, id, activeTaskId));
  }
  return { ...state, tasks, activeTaskId };
}

export function selectTask(state, id) {
  if (state.activeTaskId === id) return state;
  if (!state.tasks.some((task) => task.id === id)) return state;
  return { ...state, activeTaskId: id };
}

export function removeTask(state, id) {
  if (!state.tasks.some((task) => task.id === id)) return state;
  return {
    ...state,
    tasks: state.tasks.filter((task) => task.id !== id),
    activeTaskId: state.activeTaskId === id ? null : state.activeTaskId,
  };
}

export function clearFinished(state) {
  if (!state.tasks.some((task) => task.done)) return state;
  const tasks = state.tasks.filter((task) => !task.done);
  const activeLives = tasks.some((task) => task.id === state.activeTaskId);
  return {
    ...state,
    tasks,
    activeTaskId: activeLives ? state.activeTaskId : null,
  };
}

export function taskSummary(state, now) {
  const { tasks, settings } = state;
  const est = tasks.reduce((sum, task) => (
    sum + ((task.pomodoros > task.estimate || task.done) ? task.pomodoros : task.estimate)
  ), 0);
  const act = tasks.reduce((sum, task) => sum + task.pomodoros, 0);
  let remaining = 0;
  for (const task of tasks) {
    if (task.done || task.pomodoros >= task.estimate) continue;
    remaining += task.estimate < 1 ? 1 : task.estimate - task.pomodoros;
  }
  const focusLeft = (est - act) * durationMs(settings, "focus");
  const extraBreaks = Math.max(
    0,
    breakMs(state.pomodorosToday + remaining - 1, settings) - breakMs(state.pomodorosToday, settings),
  );
  const currentBreak = state.phase === "focus" ? 0 : durationMs(settings, state.phase);
  const remainingMs = Math.max(0, focusLeft + extraBreaks + currentBreak);
  return {
    act,
    est,
    remainingMs,
    finishAt: now + remainingMs,
    hours: Math.floor((remainingMs / 3600000) * 10) / 10,
  };
}

export function completeIfDue(state, now) {
  if (state.status !== "running" || !Number.isFinite(state.endsAt)) {
    return { state, completed: null };
  }
  if (now < state.endsAt) return { state, completed: null };
  const allowAuto = now - state.endsAt <= AUTO_START_WINDOW_MS;
  return finish(state, state.endsAt, now, allowAuto);
}

export function applyAutoStart(state, now) {
  if (!Number.isFinite(state.autoStartAt)) return state;
  if (now < state.autoStartAt) return state;
  if (now - state.autoStartAt > AUTO_START_DELAY_MS) {
    return { ...state, autoStartAt: null };
  }
  return start({ ...state, autoStartAt: null }, state.autoStartAt);
}

export function hydrate(json, now) {
  if (typeof json !== "string" || !json) return { state: freshState(now), completed: null };
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return { state: freshState(now), completed: null };
  }
  if (!data || typeof data !== "object") return { state: freshState(now), completed: null };

  const settings = normalizeSettings(data.settings || {});
  const phase = PHASES.includes(data.phase) ? data.phase : "focus";
  let status = data.status === "running" || data.status === "paused" ? data.status : "idle";
  let endsAt = Number(data.endsAt);
  if (!Number.isFinite(endsAt)) endsAt = null;
  if (status === "running" && endsAt == null) status = "idle";
  if (status !== "running") endsAt = null;

  let remainingMs = Number(data.remainingMs);
  if (!Number.isFinite(remainingMs) || remainingMs < 0) remainingMs = durationMs(settings, phase);
  if (status === "idle") remainingMs = durationMs(settings, phase);

  const tasks = sanitizeTasks(data.tasks);
  let activeTaskId = typeof data.activeTaskId === "string" ? data.activeTaskId : null;
  if (activeTaskId && !tasks.some((task) => task.id === activeTaskId)) activeTaskId = null;

  let pomodorosToday = Number(data.pomodorosToday);
  if (!Number.isFinite(pomodorosToday)) pomodorosToday = Number(data.completedFocusInCycle);
  pomodorosToday = clamp(pomodorosToday, 0, 9999, 0);

  let autoStartAt = Number(data.autoStartAt);
  if (!Number.isFinite(autoStartAt)) autoStartAt = null;
  if (status === "running") autoStartAt = null;

  const base = {
    settings,
    phase,
    status,
    endsAt,
    remainingMs,
    plannedMs: Number.isFinite(Number(data.plannedMs)) ? Number(data.plannedMs) : null,
    pomodorosToday,
    autoStartAt,
    todayKey: typeof data.todayKey === "string" ? data.todayKey : dayKey(now),
    focusDoneToday: clamp(data.focusDoneToday, 0, 9999, 0),
    focusMsToday: clamp(data.focusMsToday, 0, 1e12, 0),
    activeTaskId,
    tasks,
    history: sanitizeHistory(data.history),
    banner: sanitizeBanner(data.banner),
  };

  const rolled = rollDay(base, now);
  const armed = applyAutoStart(rolled, now);
  return completeIfDue(armed, now);
}

function finish(state, endedAt, now, allowAuto) {
  const planned = Number.isFinite(state.plannedMs) && state.plannedMs > 0
    ? state.plannedMs
    : durationMs(state.settings, state.phase);
  const from = state.phase;
  const task = state.tasks.find((item) => item.id === state.activeTaskId) || null;
  const completed = {
    id: `h-${endedAt}-${from}`,
    phase: from,
    ms: planned,
    endedAt,
    taskId: task ? task.id : null,
    taskTitle: task ? task.title : "",
  };

  let tasks = state.tasks;
  let activeTaskId = state.activeTaskId;
  let focusDoneToday = state.focusDoneToday;
  let focusMsToday = state.focusMsToday;
  let pomodorosToday = state.pomodorosToday;
  if (from === "focus") {
    focusDoneToday += 1;
    focusMsToday += planned;
    pomodorosToday += 1;
    if (task) {
      const pomodoros = task.pomodoros + 1;
      const done = task.done || (state.settings.autoCheckTasks && pomodoros >= task.estimate);
      tasks = tasks.map((item) => (
        item.id === task.id ? { ...item, pomodoros, done } : item
      ));
      if (done && !task.done && state.settings.autoSwitchTasks) {
        ({ tasks, activeTaskId } = handOff(tasks, task.id, activeTaskId));
      }
    }
  }

  const phase = nextPhase(from, pomodorosToday, state.settings);
  const auto = Boolean(allowAuto) && (
    (from === "focus" && state.settings.autoStartBreaks)
    || (from !== "focus" && state.settings.autoStartFocus)
  );
  const dur = durationMs(state.settings, phase);

  return {
    state: {
      ...state,
      phase,
      status: "idle",
      endsAt: null,
      remainingMs: dur,
      plannedMs: null,
      pomodorosToday,
      autoStartAt: auto ? now + AUTO_START_DELAY_MS : null,
      focusDoneToday,
      focusMsToday,
      tasks,
      activeTaskId,
      history: [completed, ...state.history].slice(0, 60),
      banner: { from, to: phase, auto },
    },
    completed,
  };
}

function breakMs(count, settings) {
  if (count <= 0) return 0;
  const longBreaks = Math.floor(count / settings.roundsUntilLong);
  const shortBreaks = count - longBreaks;
  return shortBreaks * durationMs(settings, "short") + longBreaks * durationMs(settings, "long");
}

function handOff(tasks, finishedId, activeTaskId) {
  const finished = tasks.find((task) => task.id === finishedId);
  const rest = tasks.filter((task) => task.id !== finishedId);
  const ordered = finished ? [...rest, finished] : tasks;
  let nextActive = activeTaskId;
  if (activeTaskId === finishedId) {
    const next = ordered.find((task) => !task.done);
    nextActive = next ? next.id : null;
  }
  return { tasks: ordered, activeTaskId: nextActive };
}

function normalizeSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    focusMin: clamp(source.focusMin, ...LIMITS.focusMin, DEFAULT_SETTINGS.focusMin),
    shortMin: clamp(source.shortMin, ...LIMITS.shortMin, DEFAULT_SETTINGS.shortMin),
    longMin: clamp(source.longMin, ...LIMITS.longMin, DEFAULT_SETTINGS.longMin),
    roundsUntilLong: clamp(
      source.roundsUntilLong,
      ...LIMITS.roundsUntilLong,
      DEFAULT_SETTINGS.roundsUntilLong,
    ),
    autoStartBreaks: Boolean(source.autoStartBreaks),
    autoStartFocus: Boolean(source.autoStartFocus),
    autoCheckTasks: Boolean(source.autoCheckTasks),
    autoSwitchTasks: source.autoSwitchTasks === undefined
      ? DEFAULT_SETTINGS.autoSwitchTasks
      : Boolean(source.autoSwitchTasks),
    sound: source.sound === undefined ? DEFAULT_SETTINGS.sound : Boolean(source.sound),
    notify: Boolean(source.notify),
  };
}

function sanitizeTasks(list) {
  if (!Array.isArray(list)) return [];
  const tasks = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.id !== "string" || typeof item.title !== "string") continue;
    const title = item.title.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!title || item.id.length > 40) continue;
    tasks.push({
      id: item.id,
      title,
      done: Boolean(item.done),
      pomodoros: clamp(item.pomodoros, 0, 999, 0),
      estimate: clamp(item.estimate, ...LIMITS.estimate, 1),
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : 0,
    });
    if (tasks.length >= 24) break;
  }
  return tasks;
}

function sanitizeHistory(list) {
  if (!Array.isArray(list)) return [];
  const history = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (!PHASES.includes(item.phase)) continue;
    const endedAt = Number(item.endedAt);
    const ms = Number(item.ms);
    if (!Number.isFinite(endedAt) || !Number.isFinite(ms) || ms < 0) continue;
    history.push({
      id: typeof item.id === "string" ? item.id.slice(0, 48) : `h-${endedAt}-${item.phase}`,
      phase: item.phase,
      ms,
      endedAt,
      taskId: typeof item.taskId === "string" ? item.taskId : null,
      taskTitle: typeof item.taskTitle === "string" ? item.taskTitle.slice(0, 120) : "",
    });
    if (history.length >= 60) break;
  }
  return history;
}

function sanitizeBanner(banner) {
  if (!banner || typeof banner !== "object") return null;
  if (!PHASES.includes(banner.from) || !PHASES.includes(banner.to)) return null;
  return { from: banner.from, to: banner.to, auto: Boolean(banner.auto) };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function createId(now) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now.toString(36)}-${rand}`;
}
