import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile, recordMissionComplete } from './progression.ts';
import type { PlayerProfile } from './progression.ts';
import {
  ACTIVE_MISSION_COUNT,
  applyMissionEvent,
  applyMissionEvents,
  generateMission,
  loadMissions,
  MISSION_TEMPLATES,
  MISSIONS_VERSION,
  replaceCompletedMissions,
  saveMissions,
} from './missions.ts';
import type { MissionEvent, MissionState, MissionsSaveData } from './missions.ts';
import { MISSIONS_KEY, setStorageBackend } from './storage.ts';

type MemBackend = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

function memoryBackend(initial: Record<string, string> = {}): MemBackend {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rng that returns values from a fixed list, then repeats the last one. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function makeMission(overrides: Partial<MissionState> = {}): MissionState {
  const template = MISSION_TEMPLATES.find((t) => t.id === overrides.id)!;
  return {
    id: template.id,
    difficulty: template.difficulty,
    type: template.type,
    title: template.title,
    description: template.description,
    target: template.target,
    progress: 0,
    rewardXp: template.rewardXp,
    mode: template.mode,
    minScore: template.minScore,
    completed: false,
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => setStorageBackend(undefined));

test('template pool covers every difficulty and objective type with sane targets', () => {
  for (const difficulty of ['easy', 'medium', 'hard', 'master']) {
    assert.ok(
      MISSION_TEMPLATES.some((t) => t.difficulty === difficulty),
      `missing ${difficulty} templates`,
    );
  }
  const types = new Set(MISSION_TEMPLATES.map((t) => t.type));
  for (const type of ['fruit', 'score', 'length', 'level', 'survival', 'run', 'mode', 'record', 'skill']) {
    assert.ok(types.has(type), `missing ${type} objective`);
  }
  const ids = MISSION_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'mission ids are unique');
  for (const t of MISSION_TEMPLATES) {
    assert.ok(t.target > 0 || t.dynamicTarget, `${t.id} needs a positive or dynamic target`);
    assert.ok(t.rewardXp > 0, `${t.id} needs a reward`);
    assert.ok(t.description.includes('{target}') || t.type === 'skill', `${t.id} description renders the target`);
    if (t.type === 'mode' || t.type === 'record') assert.ok(t.mode, `${t.id} needs a mode`);
    if (t.type === 'record') assert.ok(t.dynamicTarget, `${t.id} must be a dynamic target`);
    if (t.type === 'skill') assert.ok(t.minScore === undefined || t.minScore > 0, `${t.id} score gate`);
  }
});

test('a fresh player is offered a full roster of three unique missions', () => {
  const save = loadMissions(createDefaultProfile(), mulberry32(1));
  assert.equal(save.active.length, ACTIVE_MISSION_COUNT);
  const ids = save.active.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate missions');
  assert.ok(save.active.every((m) => !m.completed));
  for (const m of save.active) {
    assert.ok(m.target > 0, 'target is set');
    assert.ok(m.rewardXp > 0, 'reward is set');
    assert.ok(m.title && m.description, 'title and description are set');
  }
});

test('rank 0 rolls never pick master missions; apex players can', () => {
  const hatchling = generateMission(createDefaultProfile(), [], [], () => 0.95);
  assert.equal(hatchling?.difficulty, 'hard', 'highest hatchling tier is hard');
  const apex = generateMission({ ...createDefaultProfile(), xp: 2000 }, [], [], () => 0.95);
  assert.equal(apex?.difficulty, 'master');
});

test('recently seen missions are not re-picked', () => {
  const recent = MISSION_TEMPLATES.filter((t) => t.difficulty === 'easy').map((t) => t.id);
  const mission = generateMission(createDefaultProfile(), recent, [], () => 0);
  assert.ok(mission);
  assert.notEqual(mission!.difficulty, 'easy');
  assert.ok(!recent.includes(mission!.id));
});

test('generation skips already completed missions and returns null when the pool is spent', () => {
  const completionist = { ...createDefaultProfile(), completedMissions: MISSION_TEMPLATES.map((t) => t.id) };
  assert.equal(generateMission(completionist, [], [], () => 0), null);
  const partial = { ...createDefaultProfile(), completedMissions: ['eat-20-fruits', 'reach-level-3'] };
  const mission = generateMission(partial, [], [], () => 0);
  assert.ok(mission);
  assert.ok(!partial.completedMissions.includes(mission!.id));
});

test('fruit missions are seeded from lifetime fruit, capped at the target', () => {
  const veteran = { ...createDefaultProfile(), totalFruit: 100 };
  const save = loadMissions(veteran, () => 0);
  const fruit = save.active.find((m) => m.type === 'fruit');
  assert.ok(fruit, 'an easy roll yields the fruit mission');
  assert.equal(fruit!.progress, fruit!.target, 'seed never exceeds the target');
  const newbie = loadMissions(createDefaultProfile(), () => 0);
  assert.equal(newbie.active.find((m) => m.type === 'fruit')!.progress, 0);
});

test('record missions scale the target by 20% and need a real baseline', () => {
  const seasoned = { ...createDefaultProfile(), classicBest: 240 };
  const record = generateMission(seasoned, [], [], seqRng([0.95, 0.6]));
  assert.equal(record?.id, 'beat-classic-20pct');
  assert.equal(record!.target, Math.ceil(240 * 1.2));
  assert.ok(record!.description.includes(String(record!.target)));
  const fresh = generateMission(createDefaultProfile(), [], [], seqRng([0.95, 0.6]));
  assert.ok(fresh);
  assert.notEqual(fresh!.id, 'beat-classic-20pct', 'no baseline means no record mission');
});

test('fruit missions count cumulatively and complete exactly at the target', () => {
  const mission = makeMission({ id: 'eat-20-fruits' });
  let active = [mission];
  for (let i = 0; i < 19; i++) {
    active = applyMissionEvent(active, { type: 'fruit', amount: 1 }, 100).active;
  }
  assert.equal(active[0].completed, false);
  const done = applyMissionEvent(active, { type: 'fruit', amount: 1 }, 200);
  assert.equal(done.completed.length, 1);
  assert.equal(done.active[0].completed, true);
  assert.equal(done.active[0].completedAt, 200);
  assert.equal(done.active[0].progress, 20);
  const silence = applyMissionEvent(done.active, { type: 'fruit', amount: 1 }, 300);
  assert.equal(silence.completed.length, 0, 'a completed mission never re-announces');
  assert.equal(silence.active[0].progress, 20, 'completed missions stop tracking');
});

test('per-run missions track the best run, never the sum', () => {
  let active: MissionState[] = [
    makeMission({ id: 'score-100', progress: 30 }),
    makeMission({ id: 'reach-length-15', progress: 6 }),
    makeMission({ id: 'reach-level-3' }),
    makeMission({ id: 'survive-45s' }),
  ];
  let result = applyMissionEvents(
    active,
    [
      { type: 'score', score: 90 },
      { type: 'length', length: 10 },
      { type: 'level', level: 2 },
      { type: 'survival', seconds: 40 },
    ],
    1,
  );
  assert.deepEqual(result.active.map((m) => m.progress), [90, 10, 2, 40]);
  assert.equal(result.completed.length, 0);
  result = applyMissionEvents(
    result.active,
    [
      { type: 'score', score: 120 },
      { type: 'length', length: 8 },
      { type: 'level', level: 3 },
      { type: 'survival', seconds: 60 },
    ],
    2,
  );
  assert.deepEqual(result.active.map((m) => m.progress), [120, 10, 3, 60], 'weaker runs never lower progress');
  assert.deepEqual(result.completed.map((m) => m.id), ['score-100', 'reach-level-3', 'survive-45s']);
});

test('run missions count finished runs', () => {
  const result = applyMissionEvent([makeMission({ id: 'play-1-run' })], { type: 'run' }, 5);
  assert.equal(result.completed.length, 1);
  assert.equal(result.active[0].progress, 1);
});

test('mode missions only advance in their own mode', () => {
  const mission = makeMission({ id: 'score-100-time-attack' });
  const wrongMode = applyMissionEvent([mission], { type: 'mode', mode: 'classic', score: 300 }, 1);
  assert.equal(wrongMode.active[0].progress, 0);
  const rightMode = applyMissionEvent(wrongMode.active, { type: 'mode', mode: 'time-attack', score: 100 }, 2);
  assert.equal(rightMode.completed.length, 1);
});

test('record missions complete only on a run beating the generated target', () => {
  const mission = makeMission({ id: 'beat-classic-20pct', target: 240, progress: 200 });
  const otherMode = applyMissionEvent([mission], { type: 'record', mode: 'zen', score: 250 }, 3);
  assert.equal(otherMode.completed.length, 0);
  const beaten = applyMissionEvent(otherMode.active, { type: 'record', mode: 'classic', score: 250 }, 4);
  assert.equal(beaten.completed.length, 1);
});

test('no-pause missions require a clean run, and the master variant gates on score', () => {
  const hard = makeMission({ id: 'no-pause-run' });
  const clean = applyMissionEvent([hard], { type: 'skill', skill: 'no-pause-run', score: 10 }, 1);
  assert.equal(clean.completed.length, 1);
  const master = makeMission({ id: 'no-pause-score-150' });
  const weak = applyMissionEvent([master], { type: 'skill', skill: 'no-pause-run', score: 100 }, 2);
  assert.equal(weak.active[0].progress, 0, 'below the score gate nothing advances');
  const strong = applyMissionEvent(weak.active, { type: 'skill', skill: 'no-pause-run', score: 160 }, 3);
  assert.equal(strong.completed.length, 1);
});

test('completing a mission grants its XP reward and logs the id exactly once', () => {
  const profile = createDefaultProfile();
  const rewarded = recordMissionComplete(profile, 'score-100', 35);
  assert.equal(rewarded.xp, 35);
  assert.deepEqual(rewarded.completedMissions, ['score-100']);
  const repeat = recordMissionComplete(rewarded, 'score-100', 35);
  assert.equal(repeat.xp, 35, 'no double reward for the same mission');
  assert.deepEqual(repeat.completedMissions, ['score-100']);
});

test('replacing completed missions refills the roster without duplicates', () => {
  const profile = createDefaultProfile();
  const save = loadMissions(profile, mulberry32(10));
  const completedSave: MissionsSaveData = {
    ...save,
    active: save.active.map((m, i) => (i < 2 ? { ...m, completed: true, completedAt: 1 } : m)),
  };
  const replaced = replaceCompletedMissions(completedSave, profile, mulberry32(11));
  assert.equal(replaced.active.length, ACTIVE_MISSION_COUNT);
  assert.ok(replaced.active.every((m) => !m.completed));
  const ids = replaced.active.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const done of completedSave.active.filter((m) => m.completed)) {
    assert.ok(!ids.includes(done.id), 'just-completed missions are not re-offered');
  }
});

test('mission save round-trips through storage', () => {
  const backend = memoryBackend();
  setStorageBackend(backend);
  const profile = createDefaultProfile();
  const save = loadMissions(profile, mulberry32(20));
  assert.equal(saveMissions(save), true);
  const reloaded = loadMissions(profile, mulberry32(21));
  assert.deepEqual(reloaded.active.map((m) => m.id), save.active.map((m) => m.id));
  assert.deepEqual(reloaded.active.map((m) => m.progress), save.active.map((m) => m.progress));
});

test('completed missions persisted from an earlier session are refilled on load', () => {
  const backend = memoryBackend();
  setStorageBackend(backend);
  const profile = createDefaultProfile();
  const save = loadMissions(profile, mulberry32(30));
  const withDone: MissionsSaveData = {
    ...save,
    active: save.active.map((m, i) => (i === 0 ? { ...m, completed: true, completedAt: 9 } : m)),
  };
  saveMissions(withDone);
  const reloaded = loadMissions(profile, mulberry32(31));
  assert.equal(reloaded.active.length, ACTIVE_MISSION_COUNT);
  assert.ok(reloaded.active.every((m) => !m.completed));
  assert.ok(!reloaded.active.some((m) => m.id === withDone.active[0].id));
});

test('corrupt or version-mismatched mission blobs fall back to a fresh roster', () => {
  setStorageBackend(memoryBackend({ [MISSIONS_KEY]: '{not json' }));
  assert.equal(loadMissions(createDefaultProfile(), mulberry32(40)).active.length, ACTIVE_MISSION_COUNT);
  setStorageBackend(
    memoryBackend({ [MISSIONS_KEY]: JSON.stringify({ version: 99, active: [], recent: [] }) }),
  );
  assert.equal(loadMissions(createDefaultProfile(), mulberry32(41)).active.length, ACTIVE_MISSION_COUNT);
});

test('garbage mission fields are sanitized and unknown missions are dropped', () => {
  const backend = memoryBackend({
    [MISSIONS_KEY]: JSON.stringify({
      version: MISSIONS_VERSION,
      recent: ['x', 42, 'y'],
      active: [
        { id: 'score-100', progress: 'lots', target: 0, rewardXp: -1, completed: false },
        { id: 'not-a-real-mission', progress: 5 },
      ],
    }),
  });
  setStorageBackend(backend);
  const save = loadMissions(createDefaultProfile(), mulberry32(42));
  const kept = save.active.find((m) => m.id === 'score-100');
  assert.ok(kept, 'valid mission survives sanitization');
  assert.ok(!save.active.some((m) => m.id === 'not-a-real-mission'), 'unknown mission dropped');
  const template = MISSION_TEMPLATES.find((t) => t.id === 'score-100')!;
  assert.equal(kept!.target, template.target);
  assert.equal(kept!.progress, 0);
  assert.equal(kept!.rewardXp, template.rewardXp);
  assert.ok(!kept!.completed);
});

test('a full run event batch feeds every objective type in one pass', () => {
  const active: MissionState[] = [
    makeMission({ id: 'score-100' }),
    makeMission({ id: 'score-100-time-attack' }),
    makeMission({ id: 'no-pause-run' }),
    makeMission({ id: 'play-1-run' }),
  ];
  const events: MissionEvent[] = [
    { type: 'run' },
    { type: 'score', score: 120 },
    { type: 'length', length: 14 },
    { type: 'level', level: 3 },
    { type: 'survival', seconds: 55 },
    { type: 'mode', mode: 'classic', score: 120 },
    { type: 'record', mode: 'classic', score: 120 },
    { type: 'skill', skill: 'no-pause-run', score: 120 },
  ];
  const result = applyMissionEvents(active, events, 7);
  assert.deepEqual(result.completed.map((m) => m.id), ['play-1-run', 'score-100', 'no-pause-run']);
  assert.equal(result.active.find((m) => m.id === 'score-100-time-attack')!.progress, 0);
});

test('loadMissions without any storage falls back to a fresh roster safely', () => {
  setStorageBackend(null);
  const save = loadMissions(createDefaultProfile(), mulberry32(50));
  assert.equal(save.active.length, ACTIVE_MISSION_COUNT);
  assert.deepEqual(save.active.map((m) => m.progress), save.active.map(() => 0));
});

test('failing missions never punishes: a weak run leaves progress untouched', () => {
  const mission = makeMission({ id: 'score-180', progress: 50 });
  const result = applyMissionEvent([mission], { type: 'score', score: 20 }, 1);
  assert.equal(result.active[0].progress, 50);
  assert.equal(result.active[0].completed, false);
});