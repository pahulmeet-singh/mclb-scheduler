# Multi-Core Load Balancing Scheduler
### CSE316 — Operating Systems | CA2 Project | Session 2025-26

---

## What This Project Does

This project simulates how a modern operating system schedules processes across multiple CPU cores. It is not just one algorithm — it combines **four algorithms working together** to keep all cores busy, keep processes moving, and prevent any process from waiting forever.

The project has two parts:
1. **`scheduler.c`** — the actual scheduler written in C, runnable in your terminal
2. **`ui/`** — an interactive web dashboard that visualizes the same logic in real time

---

## File Structure

```
sched3/
├── scheduler.c          ← C implementation (compile & run this)
├── README.md            ← This file
├── STUDY_GUIDE.md       ← Deep explanation for viva preparation
└── ui/
    ├── index.html       ← Open this in your browser
    ├── css/
    │   └── style.css    ← All visual styling
    └── js/
        ├── engine.js    ← Scheduling algorithms (mirrors scheduler.c)
        ├── renderer.js  ← Draws everything on screen
        └── main.js      ← Wires buttons, tabs, toggles together
```

---

## How to Run

### C Scheduler (Terminal)
```bash
gcc -o scheduler scheduler.c -Wall
./scheduler
```
You will see every scheduling event printed tick by tick, then a final statistics table.

### Web UI (Browser)
Double-click `ui/index.html` — opens in Chrome, Firefox, or Safari.
No server, no installation needed.

---

## Algorithms Implemented

| Algorithm | What it does | When it runs |
|---|---|---|
| Priority Round-Robin | Dispatch highest-priority ready process; preempt after 4 ticks | Every tick, per core |
| Work Stealing | Idle core pulls a process from the busiest core | When a core becomes idle |
| Dynamic Migration | Move processes from overloaded cores to lighter ones | Every 5 ticks |
| Priority Aging | Boost priority of waiting processes | Every 10 ticks |

---

## Key Constants (tunable in `scheduler.c`)

```c
#define CORES         4    // number of CPU cores
#define QUANTUM       4    // round-robin time slice (ticks)
#define IMBAL_THRESH  2    // migration triggers when queue diff > this
#define AGING_EVERY  10    // ticks between aging boosts
```

---

## Metrics Explained

| Metric | Formula | What it means |
|---|---|---|
| Turnaround Time (TAT) | finish_tick − arrival_tick | Total time from arrival to completion |
| Waiting Time (WT) | TAT − burst_time | Time spent waiting, not executing |
| Response Time (RT) | first_run_tick − arrival_tick | Time until first CPU access |
| Core Utilization | busy_ticks / total_ticks × 100 | How busy each core was |

---

## Web UI Guide

- **Algorithm pills** (top bar) — click any pill to toggle that algorithm on/off live
- **Step button** — advance one tick at a time, great for explaining in viva
- **Gantt tab** — shows which core ran which process at each tick
- **Table tab** — full process details, updates live
- **Log tab** — every event with timestamp and type
- **Inject process** — add a new process during the simulation
- **Speed slider** — slow it down to 1200ms/tick for demo, fast at 80ms

---

## GitHub Commit Plan (minimum 7)

```
commit 1: Project structure and PCB data structures
commit 2: Core queue management (push, pop_best, remove_pid)
commit 3: Priority Round-Robin scheduling per core
commit 4: Work Stealing algorithm
commit 5: Dynamic Migration algorithm
commit 6: Priority Aging and final statistics output
commit 7: Web UI — engine.js and renderer.js
commit 8: Web UI — tabs, toggles, inject process
commit 9: Final cleanup, README, testing
```
