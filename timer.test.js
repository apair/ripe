import assert from "node:assert/strict";
import test from "node:test";
import {
  addTask,
  bannerText,
  CLASSIC_TIMING,
  clearFinished,
  completeIfDue,
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
  skip,
  start,
  switchPhase,
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
  assert.equal(roundLabel(state), "Round 1 of 4");
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
  assert.equal(state.completedFocusInCycle, 1);
  assert.equal(state.tasks.find((task) => task.id === taskId).pomodoros, 1);
  assert.equal(bannerText(state.banner), "Focus block finished. Short break is ready.");
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
      assert.equal(state.completedFocusInCycle, round);
      state = start(state, now);
      now = state.endsAt;
      state = completeIfDue(state, now).state;
      assert.equal(state.phase, "focus");
      assert.equal(state.focusDoneToday, round);
    } else {
      assert.equal(state.phase, "long");
      assert.equal(state.completedFocusInCycle, 0);
      assert.equal(bannerText(state.banner), "Cycle complete. Take a long break.");
    }
  }
  state = start(state, now);
  now = state.endsAt;
  state = completeIfDue(state, now).state;
  assert.equal(state.phase, "focus");
  assert.equal(roundLabel(state), "Round 1 of 4");
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

test("skip abandons the current block without counting it", () => {
  let now = 0;
  let state = start(freshState(now), now);
  now += 10_000;
  state = skip(state, now);
  assert.equal(state.phase, "short");
  assert.equal(state.status, "idle");
  assert.equal(state.focusDoneToday, 0);
  assert.equal(state.completedFocusInCycle, 0);
  assert.equal(state.history.length, 0);
  assert.equal(state.remainingMs, 5 * MINUTE);
  state = start(state, now);
  state = skip(state, now + 1000);
  assert.equal(state.phase, "focus");
  assert.equal(skip(freshState(now), now).status, "idle");
});

test("auto-start begins the next block only when the end is observed promptly", () => {
  let now = 0;
  let state = updateSettings(freshState(now), { autoStartBreaks: true, autoStartFocus: true }, now);
  state = start(state, now);
  const live = completeIfDue(state, state.endsAt);
  assert.equal(live.state.phase, "short");
  assert.equal(live.state.status, "running");
  assert.equal(live.state.endsAt - state.endsAt, 5 * MINUTE);
  assert.match(bannerText(live.state.banner), /Short break started/);

  state = updateSettings(freshState(0), { autoStartBreaks: true }, 0);
  state = start(state, 0);
  const late = completeIfDue(state, state.endsAt + 60_000);
  assert.equal(late.state.status, "idle");
  assert.equal(late.state.phase, "short");
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
  assert.equal(state.settings.longMin, 1);
  assert.equal(state.settings.roundsUntilLong, 2);
  const classic = updateSettings(state, CLASSIC_TIMING, 0);
  assert.equal(classic.settings.focusMin, 25);
  assert.equal(classic.remainingMs, 25 * MINUTE);
});

test("shrinking the cycle length never leaves the counter past the last round", () => {
  let now = 0;
  let state = freshState(now);
  for (let i = 0; i < 3; i += 1) {
    state = start(state, now);
    now = state.endsAt;
    state = completeIfDue(state, now).state;
    if (state.phase !== "focus") {
      state = start(state, now);
      now = state.endsAt;
      state = completeIfDue(state, now).state;
    }
  }
  assert.equal(state.completedFocusInCycle, 3);
  state = updateSettings(state, { roundsUntilLong: 2 }, now);
  assert.equal(state.completedFocusInCycle, 1);
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
  state = toggleTask(state, first);
  assert.equal(state.tasks.find((task) => task.id === first).done, true);
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
  assert.equal(roundLabel(state), "Long break · cycle complete");
});
