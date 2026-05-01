/*
 * engine.js — Scheduling Engine
 * Pure algorithm logic. No DOM access whatsoever.
 * Mirrors the C implementation (scheduler.c) 1-to-1.
 *
 * Exported global: Engine
 */

const CORE_COLORS = ['#4f9cf9', '#4fdd9a', '#f9a84f', '#c77dff'];
const QUANTUM        = 4;
const IMBAL_THRESH   = 2;
const AGING_EVERY    = 10;

/* ── Process factory ──────────────────────────────────── */
function makeProcess(id, name, burst, priority, arrive) {
  return {
    id, name, burst, priority, basePriority: priority,
    arrive, rem: burst,
    state: 'new',     // new | ready | running | done
    core: -1,
    migrations: 0,
    startTick: -1,    // first time on CPU
    endTick: -1,
    tat: 0,
    wt: 0,
  };
}

/* ── Core factory ─────────────────────────────────────── */
function makeCore(id) {
  return {
    id,
    queue:   [],      // array of process ids waiting
    running: -1,      // id of currently running process
    qLeft:   0,       // quantum ticks left
    busy:    0,       // ticks spent executing
    total:   0,       // total ticks elapsed
  };
}

/* ── Default workload ─────────────────────────────────── */
const DEFAULT_JOBS = [
  { name: 'Alpha',   burst: 12, priority: 3, arrive: 0 },
  { name: 'Beta',    burst:  8, priority: 1, arrive: 0 },
  { name: 'Gamma',   burst: 20, priority: 5, arrive: 1 },
  { name: 'Delta',   burst:  6, priority: 2, arrive: 2 },
  { name: 'Epsilon', burst: 15, priority: 4, arrive: 3 },
  { name: 'Zeta',    burst: 10, priority: 3, arrive: 4 },
  { name: 'Eta',     burst:  7, priority: 1, arrive: 5 },
  { name: 'Theta',   burst: 18, priority: 6, arrive: 6 },
  { name: 'Iota',    burst:  5, priority: 2, arrive: 7 },
  { name: 'Kappa',   burst: 11, priority: 4, arrive: 8 },
];

/* ════════════════════════════════════════════════════════
   ENGINE OBJECT
   ════════════════════════════════════════════════════════ */
const Engine = (() => {

  /* ── State ─────────────────────────────────────────── */
  let procs    = [];
  let cores    = [];
  let tick     = 0;
  let doneCount= 0;
  let steals   = 0;
  let migrations = 0;
  let ageBoosts  = 0;
  let pidCounter = 0;
  let ganttHistory = {};  // ganttHistory[pid] = [coreId | -1, ...]

  /* flags controlled by the toggles in the UI */
  let flags = { steal: true, migrate: true, age: true };

  /* event log */
  const events = [];
  function log(type, msg) {
    events.push({ tick, type, msg });
    if (events.length > 300) events.shift();
  }

  /* ── Queue helpers ─────────────────────────────────── */
  /* Pop the highest-priority (lowest number) pid from queue */
  function popBest(core) {
    if (!core.queue.length) return -1;
    let bi = 0;
    for (let i = 1; i < core.queue.length; i++)
      if (procs[core.queue[i]].priority < procs[core.queue[bi]].priority)
        bi = i;
    const [pid] = core.queue.splice(bi, 1);
    return pid;
  }

  function removePid(core, pid) {
    const i = core.queue.indexOf(pid);
    if (i !== -1) { core.queue.splice(i, 1); return true; }
    return false;
  }

  function coreLoad(ci) {
    return cores[ci].queue.length + (cores[ci].running !== -1 ? 1 : 0);
  }

  /* ── ALGORITHM 1 — Admit newly arrived processes ────── */
  function admitNew() {
    procs.forEach(p => {
      if (p.state !== 'new' || p.arrive > tick) return;
      const best = cores.reduce((b, c) => coreLoad(c.id) < coreLoad(b) ? c.id : b, 0);
      p.state = 'ready';
      p.core  = best;
      cores[best].queue.push(p.id);
      log('arrive', `P${p.id} (${p.name}) → Core${best}  [burst=${p.burst} pri=${p.priority}]`);
    });
  }

  /* ── ALGORITHM 2 — Work Stealing ───────────────────── */
  function workSteal() {
    if (!flags.steal) return;
    cores.forEach(idle => {
      if (idle.running !== -1 || idle.queue.length > 0) return;
      // find busiest
      let src = null;
      cores.forEach(c => {
        if (c.id === idle.id) return;
        if (!src || c.queue.length > src.queue.length) src = c;
      });
      if (!src || src.queue.length < 2) return;
      // steal the lowest-priority process (least damage to src)
      let worstPri = -1, pid = -1;
      src.queue.forEach(p => {
        if (procs[p].priority > worstPri) { worstPri = procs[p].priority; pid = p; }
      });
      removePid(src, pid);
      idle.queue.push(pid);
      procs[pid].core = idle.id;
      procs[pid].migrations++;
      steals++;
      log('steal', `P${pid} (${procs[pid].name})  Core${src.id}→Core${idle.id}  [src queue: ${src.queue.length+1}→${src.queue.length}]`);
    });
  }

  /* ── ALGORITHM 3 — Dynamic Migration ───────────────── */
  function migrate() {
    if (!flags.migrate) return;
    cores.forEach(heavy => {
      cores.forEach(light => {
        if (heavy.id === light.id) return;
        if (heavy.queue.length - light.queue.length <= IMBAL_THRESH) return;
        // move the lowest-priority waiting process
        let worstPri = -1, pid = -1;
        heavy.queue.forEach(p => {
          if (procs[p].priority > worstPri) { worstPri = procs[p].priority; pid = p; }
        });
        if (pid === -1) return;
        removePid(heavy, pid);
        light.queue.push(pid);
        procs[pid].core = light.id;
        procs[pid].migrations++;
        migrations++;
        log('migrate', `P${pid} (${procs[pid].name})  Core${heavy.id}→Core${light.id}  [queues ${heavy.queue.length}:${light.queue.length}]`);
      });
    });
  }

  /* ── ALGORITHM 4 — Priority Aging ──────────────────── */
  function applyAging() {
    if (!flags.age) return;
    procs.forEach(p => {
      if (p.state === 'ready' && p.priority > 1) {
        p.priority--;
        ageBoosts++;
        log('age', `P${p.id} (${p.name})  priority ${p.priority+1}→${p.priority}`);
      }
    });
  }

  /* ── Per-core scheduling (Priority Round-Robin) ─────── */
  function scheduleCores() {
    cores.forEach(c => {
      c.total++;

      /* tick the running process */
      if (c.running !== -1) {
        const p = procs[c.running];
        p.rem--;
        c.qLeft--;
        c.busy++;

        if (p.rem <= 0) {
          // DONE
          p.state   = 'done';
          p.endTick = tick;
          p.tat     = tick - p.arrive;
          p.wt      = Math.max(0, p.tat - p.burst);
          doneCount++;
          log('done', `P${p.id} (${p.name})  TAT=${p.tat}  WT=${p.wt}  migr=${p.migrations}`);
          c.running = -1;

        } else if (c.qLeft <= 0) {
          // PREEMPT
          p.state = 'ready';
          c.queue.push(c.running);
          log('preempt', `P${p.id} (${p.name})  Core${c.id}  rem=${p.rem}`);
          c.running = -1;
        }
      }

      /* dispatch if idle */
      if (c.running === -1 && c.queue.length > 0) {
        const pid = popBest(c);
        const p   = procs[pid];
        p.state   = 'running';
        p.core    = c.id;
        c.running = pid;
        c.qLeft   = QUANTUM;
        if (p.startTick < 0) p.startTick = tick;
        log('dispatch', `P${pid} (${p.name}) → Core${c.id}  [pri=${p.priority} rem=${p.rem}]`);
      }
    });
  }

  /* ── Record Gantt history ─────────────────────────── */
  function recordGantt() {
    procs.forEach(p => {
      if (!ganttHistory[p.id]) ganttHistory[p.id] = [];
      ganttHistory[p.id].push(p.state === 'running' ? p.core : -1);
    });
  }

  /* ── PUBLIC API ────────────────────────────────────── */
  return {

    init(numCores = 4) {
      const nc = Math.min(Math.max(numCores, 2), 6);
      procs     = DEFAULT_JOBS.map((j, i) => makeProcess(i, j.name, j.burst, j.priority, j.arrive));
      pidCounter= procs.length;
      cores     = Array.from({ length: nc }, (_, i) => makeCore(i));
      tick = 0; doneCount = 0; steals = 0; migrations = 0; ageBoosts = 0;
      ganttHistory = {};
      events.length = 0;
    },

    addProcess(name, burst, priority) {
      const p = makeProcess(pidCounter++, name, burst, priority, tick);
      procs.push(p);
      ganttHistory[p.id] = new Array(tick).fill(-1);
    },

    setFlag(key, val) { flags[key] = val; },

    isFinished() { return doneCount >= procs.length; },

    /* Run one simulation tick */
    tick() {
      if (this.isFinished()) return;
      tick++;
      admitNew();
      if (tick % AGING_EVERY === 0) applyAging();
      if (tick % 5 === 0)           migrate();
      workSteal();
      scheduleCores();
      recordGantt();
    },

    /* Snapshot of state for the renderer */
    snapshot() {
      return {
        tick,
        procs:   procs.map(p => ({ ...p })),
        cores:   cores.map(c => ({
          id: c.id, queue: [...c.queue], running: c.running,
          qLeft: c.qLeft, busy: c.busy, total: c.total
        })),
        steals, migrations, ageBoosts,
        doneCount,
        totalProcs: procs.length,
        ganttHistory,
        events: [...events],
        coreColors: CORE_COLORS,
      clearEvents() { events.length = 0; },
      };
    },
  };
})();
