import assert from "node:assert/strict";
import test from "node:test";
import {
  addTask,
  applyAutoStart,
  bannerText,
  CLASSIC_TIMING,
  clearFinished,
  completeIfDue,
  cueText,
  durationMs,
  formatClock,
  freshState,
  hydrate,
  pause,
  remaining,
  removeTask,
  reset,
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

const MINUTE = 60 * 1000;

test("a new timer is an idle 25 minute focus block", () => {
  const now = Date.UTC(2026, 10, 16, 16, 0, 0);
  const state = freshState(now);
  assert.equal(state.phase, "focus");
  assert.equal(state.status, "idle");
  assert.equal(state.remainingMs, 25 * MINUTE);
  assert.equal(formatClock(state.remainingMs), "25:00");
  assert.equal(roundLabel(state), "#1");
  assert.equal(cueText(state), "Time to focus!");
  assert.equal(state.pomodorosToday, 0);
  assert.equal(state.settings.autoSwitchTasks, true);
  assert.equal(todayLabel(state), "No focus yet today");
});

test("pause freezes the remaining time and resume continues it", () => {
  let now = 1_000_000;
  let state = start(freshState(now), now);
  now += 5000;
  state = pause(state, now);
  assert.equal(state.status, "paused");
  assert.equal(state.remainingMs, 25 * MINUTE - 5000);
  now += 20_000;
  assert.equal(remaining(state, now), 25 * MINUTE - 5000);
  state = start(state, now);
  assert.equal(state.endsAt, now + (25 * MINUTE - 5000));
  assert.equal(state.plannedMs, 25 * MINUTE);
});

test("finishing a focus block opens a short break and counts it", () => {
  const now = Date.UTC(2026, 10, 16, 16, 0, 0);
  let state = addTask(freshState(now), "  Draft   the outline  ", now);
  const taskId = state.activeTaskId;
  state = start(state, now);
  const step = completeIfDue(state, state.endsAt);
  state = step.state;
  assert.equal(step.completed.phase, "focus");
  assert.equal(step.completed.taskTitle, "Draft the outline");
  assert.equal(state.phase, "short");
  assert.equal(state.status, "idle");
  assert.equal(state.focusDoneToday, 1);
  assert.equal(state.focusMsToday, 25 * MINUTE);
  assert.equal(state.pomodorosToday, 1);
  assert.equal(roundLabel(state), "#1");
  assert.equal(cueText(state), "Draft the outline");
  assert.equal(state.tasks.find((task) => task.id === taskId).pomodoros, 1);
  assert.equal(state.tasks.find((task) => task.id === taskId).estimate, 1);
  assert.equal(bannerText(state.banner), "Time to take a short break!");
  assert.equal(todayLabel(state), "1 focus block · 25m today");
  assert.equal(state.history[0].taskTitle, "Draft the outline");
});

test("four focus blocks are followed by a long break, then the cycle restarts", () => {
  let now = Date.UTC(2026, 10, 16, 16, 0, 0);
  let state = freshState(now);
  for (let round = 1; round <= 4; round += 1) {
    state = start(state, now);
    now = state.endsAt;
    const focus = completeIfDue(state, now);
    state = focus.state;
    assert.equal(focus.completed.phase, "focus");
    assert.equal(state.focusDoneToday, round);
    if (round < 4) {
      assert.equal(state.phase, "short");
      assert.equal(state.pomodorosToday, round);
      assert.equal(roundLabel(state), `#${round}`);
      state = start(state, now);
      now = state.endsAt;
      state = completeIfDue(state, now).state;
      assert.equal(state.phase, "focus");
      assert.equal(roundLabel(state), `#${round + 1}`);
      assert.equal(state.focusDoneToday, round);
    } else {
      assert.equal(state.phase, "long");
      assert.equal(state.pomodorosToday, 4);
      assert.equal(roundLabel(state), "#4");
      assert.equal(bannerText(state.banner), "Time to take a long break!");
    }
  }
  state = start(state, now);
  now = state.endsAt;
  state = completeIfDue(state, now).state;
  assert.equal(state.phase, "focus");
  assert.equal(roundLabel(state), "#5");
  assert.equal(cueText(state), "Time to focus!");
  assert.equal(state.pomodorosToday, 4);
  assert.equal(state.focusDoneToday, 4);
});

test("a break does not increment the focus count", () => {
  let now = 0;
  let state = switchPhase(freshState(now), "short", now);
  state = start(state, now);
  const step = completeIfDue(state, state.endsAt);
  assert.equal(step.completed.phase, "short");
  assert.equal(step.state.phase, "focus");
  assert.equal(step.state.focusDoneToday, 0);
  assert.equal(step.state.history.length, 1);
});

test("skip finishes the running interval and counts a focus block", () => {
  let now = 0;
  let state = start(freshState(now), now);
  now += 10_000;
  const skipped = skip(state, now);
  state = skipped.state;
  assert.equal(skipped.completed.phase, "focus");
  assert.equal(skipped.completed.ms, 25 * MINUTE);
  assert.equal(state.phase, "short");
  assert.equal(state.status, "idle");
  assert.equal(state.focusDoneToday, 1);
  assert.equal(state.pomodorosToday, 1);
  assert.equal(state.history.length, 1);
  assert.equal(state.remainingMs, 5 * MINUTE);
  state = start(state, now);
  state = skip(state, now + 1000).state;
  assert.equal(state.phase, "focus");
  assert.equal(state.pomodorosToday, 1);
  assert.equal(roundLabel(state), "#2");
  assert.equal(skip(freshState(now), now).state.status, "idle");
  assert.equal(skip(freshState(now), now).completed, null);
});

test("auto-start waits two seconds and only arms when the end is observed promptly", () => {
  let now = 0;
  let state = updateSettings(freshState(now), { autoStartBreaks: true, autoStartFocus: true }, now);
  state = start(state, now);
  const live = completeIfDue(state, state.endsAt);
  assert.equal(live.state.phase, "short");
  assert.equal(live.state.status, "idle");
  assert.equal(live.state.autoStartAt, state.endsAt + 2000);
  assert.equal(bannerText(live.state.banner), "Time to take a short break!");
  const waiting = applyAutoStart(live.state, state.endsAt + 1000);
  assert.equal(waiting.status, "idle");
  const started = applyAutoStart(live.state, state.endsAt + 2000);
  assert.equal(started.status, "running");
  assert.equal(started.endsAt - state.endsAt, 5 * MINUTE + 2000);
  const missed = applyAutoStart(live.state, state.endsAt + 5000);
  assert.equal(missed.status, "idle");
  assert.equal(missed.autoStartAt, null);

  state = updateSettings(freshState(0), { autoStartBreaks: true }, 0);
  state = start(state, 0);
  const late = completeIfDue(state, state.endsAt + 60_000);
  assert.equal(late.state.status, "idle");
  assert.equal(late.state.phase, "short");
  assert.equal(late.state.autoStartAt, null);
  assert.equal(late.completed.endedAt, state.endsAt);
});

test("changing the length updates an idle timer and leaves a running one alone", () => {
  let now = 5_000;
  let state = updateSettings(freshState(now), { focusMin: 50 }, now);
  assert.equal(state.remainingMs, 50 * MINUTE);
  state = start(state, now);
  const endsAt = state.endsAt;
  state = updateSettings(state, { focusMin: 10 }, now + 1000);
  assert.equal(state.endsAt, endsAt);
  assert.equal(state.settings.focusMin, 10);
  state = reset(state, now);
  assert.equal(state.remainingMs, 10 * MINUTE);
  assert.equal(state.banner, null);
});

test("settings are clamped and the classic rhythm restores the defaults", () => {
  const state = updateSettings(freshState(0), {
    focusMin: 0,
    shortMin: 90,
    longMin: -4,
    roundsUntilLong: 1,
  }, 0);
  assert.equal(state.settings.focusMin, 1);
  assert.equal(state.settings.shortMin, 60);
  assert.equal(state.settings.longMin, 0);
  assert.equal(state.settings.roundsUntilLong, 1);
  const classic = updateSettings(state, CLASSIC_TIMING, 0);
  assert.equal(classic.settings.focusMin, 25);
  assert.equal(classic.remainingMs, 25 * MINUTE);
});

test("a zero-length short break is skipped and the daily count keeps climbing", () => {
  let now = 0;
  let state = updateSettings(freshState(now), { shortMin: 0, roundsUntilLong: 4 }, now);
  state = start(state, now);
  state = completeIfDue(state, state.endsAt).state;
  assert.equal(state.phase, "focus");
  assert.equal(state.pomodorosToday, 1);
  assert.equal(roundLabel(state), "#2");
  assert.equal(bannerText(state.banner), "Time to focus!");
});

test("the long break follows the interval even after the count passes four", () => {
  let now = 0;
  let state = freshState(now);
  state = { ...state, pomodorosToday: 7, phase: "focus", remainingMs: 25 * MINUTE };
  state = start(state, now);
  state = completeIfDue(state, state.endsAt).state;
  assert.equal(state.pomodorosToday, 8);
  assert.equal(state.phase, "long");
  assert.equal(roundLabel(state), "#8");
});

test("a new day clears today's totals and keeps the task list", () => {
  const monday = new Date(2026, 10, 16, 23, 50, 0).getTime();
  let state = addTask(freshState(monday), "Ship the notes", monday);
  state = start(state, monday);
  state = completeIfDue(state, state.endsAt).state;
  assert.equal(state.focusDoneToday, 1);
  const tuesday = new Date(2026, 10, 17, 0, 10, 0).getTime();
  state = start(switchPhase(state, "focus", tuesday), tuesday);
  assert.equal(state.focusDoneToday, 0);
  assert.equal(state.pomodorosToday, 0);
  assert.equal(roundLabel(state), "#1");
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].pomodoros, 1);
});

test("tasks can be selected, finished, and cleared", () => {
  let state = freshState(0);
  state = addTask(state, "First", 1);
  const first = state.activeTaskId;
  state = addTask(state, "Second", 2);
  const second = state.activeTaskId;
  assert.notEqual(first, second);
  assert.equal(state.activeTaskId, second);
  state = selectTask(state, first);
  assert.equal(state.activeTaskId, first);
  state = updateSettings(state, { autoSwitchTasks: false }, 0);
  state = toggleTask(state, first);
  assert.equal(state.tasks.find((task) => task.id === first).done, true);
  assert.equal(state.activeTaskId, first);
  state = clearFinished(state);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.activeTaskId, null);
  assert.equal(addTask(state, "   "), state);
  assert.deepEqual(removeTask(state, second).tasks, []);
});

test("a task title keeps markup as text and rejects an empty name", () => {
  const state = addTask(freshState(0), " <img src=x onerror=alert(1)> ", 3);
  assert.equal(state.tasks[0].title, "<img src=x onerror=alert(1)>");
  assert.equal(addTask(state, " \n\t "), state);
});

test("a refresh continues a running timer from the same end time", () => {
  const startedAt = Date.UTC(2026, 10, 20, 16, 0, 0);
  let state = addTask(freshState(startedAt), "Keep going", startedAt);
  state = start(state, startedAt);
  const saved = JSON.stringify(state);
  const later = startedAt + 90_000;
  const loaded = hydrate(saved, later);
  assert.equal(loaded.completed, null);
  assert.equal(loaded.state.status, "running");
  assert.equal(loaded.state.phase, "focus");
  assert.equal(loaded.state.endsAt, state.endsAt);
  assert.equal(remaining(loaded.state, later), 25 * MINUTE - 90_000);
  assert.equal(formatClock(remaining(loaded.state, later)), "23:30");
  assert.equal(loaded.state.tasks[0].title, "Keep going");
  assert.equal(loaded.state.activeTaskId, state.activeTaskId);
});

test("a refresh keeps a paused timer frozen", () => {
  const startedAt = Date.UTC(2026, 10, 20, 16, 0, 0);
  let state = start(freshState(startedAt), startedAt);
  state = pause(state, startedAt + 125_000);
  const loaded = hydrate(JSON.stringify(state), startedAt + 10 * MINUTE);
  assert.equal(loaded.state.status, "paused");
  assert.equal(loaded.state.endsAt, null);
  assert.equal(remaining(loaded.state, startedAt + 10 * MINUTE), 25 * MINUTE - 125_000);
  assert.equal(formatClock(remaining(loaded.state, startedAt + 10 * MINUTE)), "22:55");
});

test("reload completes a block that ended while the tab was closed, without chaining another", () => {
  const started = freshState(0);
  const withTask = addTask(started, "Read the spec", 10);
  const running = start(withTask, 0);
  const saved = JSON.stringify({ ...running, endsAt: 25 * MINUTE });
  const loaded = hydrate(saved, 25 * MINUTE + 30 * MINUTE);
  assert.equal(loaded.completed.phase, "focus");
  assert.equal(loaded.state.status, "idle");
  assert.equal(loaded.state.phase, "short");
  assert.equal(loaded.state.focusDoneToday, 1);
  assert.equal(loaded.state.settings.autoStartBreaks, false);
});

test("corrupt storage falls back to a fresh timer", () => {
  const loaded = hydrate("{not json", 0);
  assert.equal(loaded.state.phase, "focus");
  assert.equal(loaded.state.remainingMs, durationMs(loaded.state.settings, "focus"));
  assert.equal(loaded.completed, null);
  const weird = hydrate(JSON.stringify({ phase: "nap", status: "flying", tasks: [{ id: "x" }] }), 0);
  assert.equal(weird.state.phase, "focus");
  assert.deepEqual(weird.state.tasks, []);
});

test("the clock reads in whole seconds and shows a full minute at the start", () => {
  assert.equal(formatClock(25 * MINUTE), "25:00");
  assert.equal(formatClock(25 * MINUTE - 1), "25:00");
  assert.equal(formatClock(25 * MINUTE - 1000), "24:59");
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(500), "00:01");
});

test("switching phase drops the current block and does not count it", () => {
  let now = 0;
  let state = start(freshState(now), now);
  state = switchPhase(state, "long", now + 4000);
  assert.equal(state.phase, "long");
  assert.equal(state.status, "idle");
  assert.equal(state.remainingMs, 15 * MINUTE);
  assert.equal(state.focusDoneToday, 0);
  assert.equal(state.pomodorosToday, 0);
  assert.equal(roundLabel(state), "#1");
  assert.equal(cueText(state), "Time for a break!");
  state = start(state, now + 5000);
  state = switchPhase(state, "long", now + 8000);
  assert.equal(state.status, "idle");
  assert.equal(state.remainingMs, 15 * MINUTE);
  assert.equal(state.pomodorosToday, 0);
});

test("finishing the estimate checks the task and selects the next one", () => {
  let now = 0;
  let state = updateSettings(freshState(now), { autoCheckTasks: true, autoSwitchTasks: true }, now);
  state = addTask(state, "First", 1);
  const first = state.activeTaskId;
  state = addTask(state, "Second", 2);
  state = selectTask(state, first);
  state = setEstimate(state, first, 1);
  state = start(state, now);
  state = completeIfDue(state, state.endsAt).state;
  const finished = state.tasks.find((task) => task.id === first);
  assert.equal(finished.done, true);
  assert.equal(finished.pomodoros, 1);
  assert.equal(state.tasks.at(-1).id, first);
  assert.equal(state.activeTaskId, state.tasks.find((task) => task.title === "Second").id);
});

test("the finish estimate counts remaining pomodoros and the breaks between them", () => {
  const now = Date.UTC(2026, 10, 16, 16, 0, 0);
  let state = addTask(freshState(now), "One", now);
  state = addTask(state, "Two", now + 1);
  state = setEstimate(state, state.tasks.find((task) => task.title === "One").id, 1);
  state = setEstimate(state, state.tasks.find((task) => task.title === "Two").id, 1);
  const summary = taskSummary(state, now);
  assert.equal(summary.act, 0);
  assert.equal(summary.est, 2);
  assert.equal(summary.remainingMs, 55 * MINUTE);
  assert.equal(summary.hours, 0.9);
  assert.equal(summary.finishAt, now + 55 * MINUTE);
});
