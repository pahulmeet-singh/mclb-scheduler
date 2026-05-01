/*
 * main.js — Controls & Glue
 */

let isPlaying = false;
let timer     = null;
let speed     = 500;

window.addEventListener('DOMContentLoaded', () => {
  Engine.init(4);
  Renderer.render(Engine.snapshot());

  /* ── Playback ───────────────────────────── */
  $('btnPlay').addEventListener('click',  togglePlay);
  $('btnStep').addEventListener('click',  stepOnce);
  $('btnReset').addEventListener('click', resetSim);

  /* ── Speed ──────────────────────────────── */
  const slider = $('speedRange');
  slider.addEventListener('input', () => {
    speed = +slider.value;
    $('speedVal').textContent = `${speed}ms`;
    if (isPlaying) { stopSim(); startSim(); }
  });

  /* ── Algorithm toggles ───────────────────── */
  $('tog-steal').addEventListener('change',   e => {
    Engine.setFlag('steal', e.target.checked);
    $('pill-steal').classList.toggle('active-off', !e.target.checked);
  });
  $('tog-migrate').addEventListener('change', e => {
    Engine.setFlag('migrate', e.target.checked);
    $('pill-migrate').classList.toggle('active-off', !e.target.checked);
  });
  $('tog-age').addEventListener('change',     e => {
    Engine.setFlag('age', e.target.checked);
    $('pill-age').classList.toggle('active-off', !e.target.checked);
  });

  /* ── Tabs ────────────────────────────────── */
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    });
  });

  /* ── Add process ─────────────────────────── */
  $('btnAdd').addEventListener('click', addProcess);
});

/* ── Helpers ──────────────────────────────────── */
function $(id) { return document.getElementById(id); }

function startSim() {
  isPlaying = true;
  $('btnPlay').textContent = '⏸ Pause';
  timer = setInterval(tick, speed);
}
function stopSim() {
  isPlaying = false;
  $('btnPlay').textContent = '▶ Start';
  clearInterval(timer);
}
function togglePlay() {
  if (Engine.isFinished()) resetSim();
  isPlaying ? stopSim() : startSim();
}
function stepOnce() {
  if (isPlaying) stopSim();
  tick();
}
function resetSim() {
  stopSim();
  Engine.init(4);
  /* re-sync toggle checkboxes */
  ['steal','migrate','age'].forEach(f => {
    const cb = document.getElementById(`tog-${f}`);
    cb.checked = true;
    Engine.setFlag(f, true);
  });
  Renderer.render(Engine.snapshot());
}
function tick() {
  if (Engine.isFinished()) { stopSim(); return; }
  Engine.tick();
  Renderer.render(Engine.snapshot());
}
function addProcess() {
  const name = $('pName').value.trim()       || 'Proc';
  const burst = parseInt($('pBurst').value)   || 8;
  const pri   = parseInt($('pPriority').value)|| 3;
  Engine.addProcess(name.slice(0,8), burst, Math.min(Math.max(pri,1),10));
  Renderer.render(Engine.snapshot());
}

/* called from HTML clear button */
function clearLog() {
  Engine.clearEvents && Engine.clearEvents();
  Renderer.render(Engine.snapshot());
}
