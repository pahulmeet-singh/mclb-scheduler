/*
 * renderer.js — DOM Rendering
 * Reads snapshots from Engine and updates the UI.
 * No scheduling logic here.
 */

const Renderer = (() => {

  const $ = id => document.getElementById(id);
  const COLORS = ['#4f9cf9', '#4fdd9a', '#f9a84f', '#c77dff', '#f96060', '#ffe066'];

  /* ── Top-bar numbers ──────────────────────────────── */
  function renderHeader(s) {
    $('hTick').textContent = s.tick;
    $('hDone').textContent = `${s.doneCount} / ${s.totalProcs}`;
  }

  /* ── Algorithm pill counters ──────────────────────── */
  function renderPills(s) {
    $('steal-count').textContent   = s.steals;
    $('migrate-count').textContent = s.migrations;
    $('age-count').textContent     = s.ageBoosts;
  }

  /* ── Balance badge ────────────────────────────────── */
  function renderBalance(s) {
    const loads = s.cores.map(c => c.queue.length + (c.running !== -1 ? 1 : 0));
    const diff  = Math.max(...loads) - Math.min(...loads);
    const b     = $('balanceBadge');
    if (diff === 0)     { b.textContent = '✓ Balanced';      b.className = 'balance-badge bal-ok'; }
    else if (diff <= 2) { b.textContent = '⚡ Slight skew';  b.className = 'balance-badge bal-warn'; }
    else                { b.textContent = '⚠ Rebalancing';   b.className = 'balance-badge bal-bad'; }
  }

  /* ── CPU Cores ────────────────────────────────────── */
  function renderCores(s) {
    $('coresGrid').innerHTML = s.cores.map(c => coreHTML(c, s)).join('');
    renderBalance(s);
  }

  function coreHTML(c, s) {
    const color   = COLORS[c.id % COLORS.length];
    const utilPct = c.total ? ((c.busy / c.total) * 100).toFixed(1) : '0.0';
    const isBusy  = c.running !== -1;

    /* Running process block */
    let bodyHTML;
    if (isBusy) {
      const p      = s.procs[c.running];
      const qPct   = Math.round((c.qLeft / 4) * 100);
      const remPct = Math.round((p.rem   / p.burst) * 100);
      bodyHTML = `
        <div class="proc-running">
          <div class="proc-running-top">
            <span class="proc-name">${p.name}</span>
            <span class="proc-pid">P${p.id}</span>
            <span class="proc-rem">${p.rem} / ${p.burst} rem</span>
          </div>
          <div class="quantum-track">
            <div class="quantum-fill" style="width:${qPct}%;background:${color}"></div>
          </div>
          <div class="quantum-label">Quantum: ${c.qLeft} / 4 ticks left</div>
        </div>
        <div class="queue-section">
          <div class="queue-label">Ready queue · ${c.queue.length} waiting</div>
          <div class="queue-chips">
            ${c.queue.length === 0
              ? '<span class="queue-empty">empty</span>'
              : c.queue.map(pid => {
                  const p = s.procs[pid];
                  return `<div class="chip" style="--cc:${color}"
                    title="${p.name} · burst:${p.burst} · rem:${p.rem} · pri:${p.priority}"
                  >${p.name}</div>`;
                }).join('')
            }
          </div>
        </div>`;
    } else {
      bodyHTML = `
        <div class="core-idle">idle</div>
        <div class="queue-section">
          <div class="queue-label">Ready queue · ${c.queue.length} waiting</div>
          <div class="queue-chips">
            ${c.queue.length === 0
              ? '<span class="queue-empty">empty</span>'
              : c.queue.map(pid => {
                  const p = s.procs[pid];
                  return `<div class="chip" style="--cc:${color}">${p.name}</div>`;
                }).join('')
            }
          </div>
        </div>`;
    }

    return `
      <div class="core-card ${isBusy ? 'is-busy' : ''}" style="--cc:${color}">
        <div class="core-stripe"></div>
        <div class="core-head">
          <span class="core-name">Core ${c.id}</span>
          <span class="core-util-pct">${utilPct}%</span>
        </div>
        <div class="core-util-track">
          <div class="core-util-fill" style="width:${utilPct}%;background:${color}"></div>
        </div>
        <div class="core-body">${bodyHTML}</div>
      </div>`;
  }

  /* ── Process Table ────────────────────────────────── */
  function renderTable(s) {
    $('procTbody').innerHTML = s.procs.map(p => {
      const color  = p.core >= 0 ? COLORS[p.core % COLORS.length] : 'var(--text3)';
      const priPct = ((10 - p.priority) / 9 * 100).toFixed(0);
      const isDone = p.state === 'done';
      return `
        <tr class="${isDone ? 'row-done' : ''}" id="tr-${p.id}">
          <td>P${p.id}</td>
          <td style="font-weight:600">${p.name}</td>
          <td>${badge(p.state)}</td>
          <td>${p.core >= 0 ? `<span style="color:${color};font-weight:700">C${p.core}</span>` : '–'}</td>
          <td>
            <div class="pri-row">
              ${p.priority}
              <div class="pri-track"><div class="pri-fill" style="width:${priPct}%"></div></div>
            </div>
          </td>
          <td>${p.burst}</td>
          <td style="color:${isDone ? 'var(--green)' : 'var(--amber)'}">${p.rem}</td>
          <td>${isDone ? p.wt  : '–'}</td>
          <td>${isDone ? p.tat : '–'}</td>
          <td style="color:var(--blue)">${p.migrations}</td>
        </tr>`;
    }).join('');
  }

  function badge(state) {
    const map = { running:'b-running', ready:'b-ready', done:'b-done', new:'b-new' };
    return `<span class="badge ${map[state]||'b-new'}">${state.toUpperCase()}</span>`;
  }

  /* ── Gantt Chart ──────────────────────────────────── */
  function renderGantt(s) {
    const MAX = 80;
    const start = Math.max(0, s.tick - MAX);
    $('ganttWrap').innerHTML = s.procs.map(p => {
      const hist  = s.ganttHistory[p.id] || [];
      const cells = hist.slice(start).map((cid, i) => {
        const t = start + i + 1;
        if (cid === -1)
          return `<div class="gcell gcell-idle" data-tip="T${t}: idle"></div>`;
        const color = COLORS[cid % COLORS.length];
        return `<div class="gcell" style="background:${color}"
          data-tip="T${t}: Core${cid}"></div>`;
      }).join('');
      return `
        <div class="gantt-row">
          <div class="gantt-lbl">P${p.id} ${p.name.slice(0,5)}</div>
          <div class="gantt-cells">${cells}</div>
        </div>`;
    }).join('');
  }

  /* ── Event Log ────────────────────────────────────── */
  const LTYPE = {
    arrive:'lt-arrive', dispatch:'lt-dispatch', preempt:'lt-preempt',
    steal:'lt-steal', migrate:'lt-migrate', done:'lt-done', age:'lt-age',
  };
  const LLABEL = {
    arrive:'ARRIVE  ', dispatch:'DISPATCH', preempt:'PREEMPT ',
    steal:'STEAL   ', migrate:'MIGRATE ', done:'DONE    ', age:'AGING   ',
  };
  function renderLog(s) {
    $('logWrap').innerHTML = [...s.events].reverse().map(e => `
      <div class="log-entry">
        <span class="log-tick">T${String(e.tick).padStart(3,'0')}</span>
        <span class="log-type ${LTYPE[e.type]||''}">${LLABEL[e.type]||e.type}</span>
        <span class="log-msg">${e.msg}</span>
      </div>`).join('');
  }

  /* ── Footer stats ─────────────────────────────────── */
  function renderFooter(s) {
    $('fSteals').textContent = s.steals;
    $('fMigr').textContent   = s.migrations;

    const done = s.procs.filter(p => p.state === 'done');
    if (done.length) {
      const avgTAT = (done.reduce((a, p) => a + p.tat, 0) / done.length).toFixed(1);
      const avgWT  = (done.reduce((a, p) => a + p.wt,  0) / done.length).toFixed(1);
      $('fAvgTAT').textContent = avgTAT;
      $('fAvgWT').textContent  = avgWT;
    }

    $('utilBars').innerHTML = s.cores.map(c => {
      const color = COLORS[c.id % COLORS.length];
      const pct   = c.total ? ((c.busy / c.total) * 100).toFixed(1) : '0.0';
      return `
        <div class="util-bar-item">
          <span class="util-bar-label" style="color:${color}">C${c.id}</span>
          <div class="util-bar-track">
            <div class="util-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="util-bar-pct" style="color:${color}">${pct}%</span>
        </div>`;
    }).join('');
  }

  /* ── Row flash on steal/migrate ───────────────────── */
  function flashRows(s) {
    s.events.slice(-6).forEach(e => {
      if (e.tick !== s.tick) return;
      const m = e.msg.match(/P(\d+)/);
      if (!m) return;
      const row = document.getElementById(`tr-${m[1]}`);
      if (!row) return;
      const cls = e.type === 'steal' ? 'flash-steal' : e.type === 'migrate' ? 'flash-migrate' : null;
      if (!cls) return;
      row.classList.remove(cls);
      void row.offsetWidth;
      row.classList.add(cls);
    });
  }

  /* ── Master render ────────────────────────────────── */
  function render(s) {
    renderHeader(s);
    renderPills(s);
    renderCores(s);
    renderTable(s);
    renderGantt(s);
    renderLog(s);
    renderFooter(s);
    flashRows(s);
  }

  return { render };
})();
