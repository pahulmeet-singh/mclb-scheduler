# STUDY GUIDE — Multi-Core Load Balancing Scheduler
### Everything you need to know to defend this project like you built it yourself

---

> **How to use this file:**
> Read it top to bottom once. Then re-read only the sections that match what your examiner asks.
> Every section ends with **"What to say in viva"** — memorise those lines.

---

# PART 1 — OPERATING SYSTEM FUNDAMENTALS
*(Why any of this exists)*

---

## 1.1 What is an Operating System?

An Operating System (OS) is software that sits between your hardware and your applications. It manages resources — CPU, memory, disk, network — and gives each program the illusion that it owns the whole machine.

Think of it like a hotel manager:
- The hotel = your computer hardware
- The rooms = CPU cores and memory
- The guests = your programs (processes)
- The manager = the OS

The manager decides who gets which room, for how long, and what happens when the hotel is full.

**Core functions of an OS:**
1. **Process Management** — creating, scheduling, killing processes
2. **Memory Management** — allocating RAM, handling virtual memory
3. **File System** — organizing data on disk
4. **I/O Management** — talking to hardware devices
5. **Security & Protection** — keeping processes isolated

**What to say in viva:**
> "The OS manages hardware resources on behalf of processes. The scheduler is the part of the OS responsible for deciding which process runs on which CPU core at any given moment."

---

## 1.2 What is a Process?

A **process** is a program in execution. When you double-click Chrome, the OS creates a process for it.

A process is NOT just code. It has:
- The program's machine code instructions
- Its own memory space (stack, heap, data, code segments)
- CPU register values
- A list of open files
- Its current state (is it running? waiting? done?)

The OS tracks all of this in a data structure called the **Process Control Block (PCB)**.

---

## 1.3 The Process Control Block (PCB)

The PCB is the OS's record of a process. Every process has exactly one PCB. When the OS wants to know anything about a process, it reads the PCB.

In our project, the PCB is this C struct:

```c
typedef struct {
    int  id;           // unique process ID
    char name[12];     // human-readable name (e.g., "Alpha")
    int  burst;        // total CPU time this process needs (ticks)
    int  rem;          // how much CPU time is still remaining
    int  priority;     // 1 = highest urgency, 10 = lowest urgency
    int  arrive;       // which tick this process arrives
    int  state;        // NEW, READY, RUNNING, or DONE
    int  core;         // which core it is assigned to
    int  migrations;   // how many times it was moved between cores
    int  start_tick;   // tick when it first got CPU access
    int  end_tick;     // tick when it finished
    int  wait_time;    // total time spent waiting (not running)
    int  tat;          // turnaround time = end_tick - arrive
} PCB;
```

**What to say in viva:**
> "The PCB is the data structure that the OS uses to store all information about a process. In my implementation, each PCB stores the process ID, burst time, remaining time, priority, state, and all timing statistics needed to compute turnaround time and waiting time."

---

## 1.4 Process States

A process transitions through states during its lifetime. Understanding this is critical.

```
   NEW ──────────────────────────► READY
   (process created,                (waiting for CPU)
    waiting to be admitted)              │
                                         │ scheduler picks it
                                         ▼
                                      RUNNING ──────► DONE
                                      (on CPU)        (finished)
                                         │
                                         │ quantum expires / preemption
                                         ▼
                                       READY (again)
```

In our project we use 4 states: `new`, `ready`, `running`, `done`.

Real OSes also have a `WAITING` (or `BLOCKED`) state — when a process is waiting for I/O (like reading from disk). We don't implement this because we're only simulating CPU scheduling.

**What to say in viva:**
> "A process starts in the NEW state. When its arrival time is reached, it becomes READY and joins a core's queue. When the scheduler picks it, it becomes RUNNING. If its time quantum expires before it finishes, it goes back to READY. When remaining time hits zero, it becomes DONE."

---

## 1.5 Threads vs Processes

A **process** is a full independent program with its own memory space.
A **thread** is a lightweight unit of execution inside a process. Threads within the same process share memory.

Example: Chrome is one process, but it runs many threads — one for rendering, one for network, one for JavaScript, etc.

In our project we simulate processes, not threads. The concepts of scheduling apply equally to both.

---

# PART 2 — CPU SCHEDULING
*(The core topic of this project)*

---

## 2.1 Why CPU Scheduling Exists

A modern computer runs dozens or hundreds of processes "simultaneously." But a single CPU core can only execute one instruction at a time. So the OS rapidly switches between processes, giving each one a small slice of time.

This switching is so fast (milliseconds) that it feels simultaneous to users. The part of the OS that decides which process runs next is the **CPU scheduler**.

**Scheduling goals:**
- **Maximize CPU utilization** — CPU should never be idle if work exists
- **Maximize throughput** — complete as many processes per unit time as possible
- **Minimize turnaround time** — processes should finish quickly
- **Minimize waiting time** — processes shouldn't sit in queue too long
- **Minimize response time** — processes should get their first CPU access quickly
- **Fairness** — no process should be ignored indefinitely

These goals often conflict. Maximizing throughput might mean short jobs always cut ahead of long jobs. Our project balances all of them.

---

## 2.2 Scheduling Criteria (Metrics)

These are the exact formulas you need to know:

### Turnaround Time (TAT)
```
TAT = Completion Time - Arrival Time
```
Total time from when the process arrived until it finished. Includes waiting time.

### Waiting Time (WT)
```
WT = TAT - Burst Time
```
Time the process spent sitting in the ready queue NOT running.

### Response Time (RT)
```
RT = First CPU Access Time - Arrival Time
```
Time until the process first got on a CPU. Important for interactive systems.

### CPU Utilization
```
Utilization = (Busy Ticks / Total Ticks) × 100%
```
What percentage of time a core was actually running a process.

### Throughput
```
Throughput = Completed Processes / Total Ticks
```
How many processes finish per unit time.

**Example calculation** (from our simulation):
- Process Alpha: burst=12, arrives=tick 0, finishes=tick 19
- TAT = 19 - 0 = 19
- WT  = 19 - 12 = 7

**What to say in viva:**
> "Turnaround time measures the total time a process spends in the system. Waiting time removes the actual execution time to show how long it was just sitting and waiting. We want both to be as low as possible."

---

## 2.3 Types of Scheduling

### Non-Preemptive Scheduling
Once a process starts running, it runs until it finishes or voluntarily gives up the CPU. The scheduler only makes a decision at process completion. Simple but unfair — one long process can block everyone.

### Preemptive Scheduling
The OS can forcibly stop a running process and give the CPU to another. This is what all modern OSes do. Our project is preemptive.

---

## 2.4 Classic Scheduling Algorithms

You need to know these because the examiner will compare them to your implementation.

### FCFS — First Come First Served
- Run processes in order of arrival
- Non-preemptive
- Simple but terrible for short jobs if a long job arrives first
- **Convoy Effect**: short processes stuck behind one long process
- No priority consideration

### SJF — Shortest Job First
- Run the process with the smallest burst time first
- Optimal for minimizing average waiting time
- Problem: you can't know burst times in advance in real systems
- Can starve long processes

### Round Robin (RR)
- Give each process a fixed time slice (quantum)
- When quantum expires, preempt and move to back of queue
- Fair — everyone gets a turn
- Performance depends heavily on quantum size:
  - Too small: too much context switching overhead
  - Too large: degenerates to FCFS

### Priority Scheduling
- Each process has a priority number
- Always run the highest-priority process
- Problem: **starvation** — low priority processes may never run
- Solution: **aging** (what we implement)

### Multilevel Feedback Queue (MLFQ)
- Multiple queues, each with different priority and quantum
- Processes move between queues based on behavior
- Used in real OSes like Linux and Windows
- Complex but powerful

**Our project implements Priority Round-Robin** — a combination of Priority Scheduling and Round Robin, which is what real OSes actually use.

---

## 2.5 Priority Round-Robin (Our Algorithm)

This is Algorithm 1 in our project. It combines the best of both worlds.

**How it works:**
1. Each core has its own ready queue
2. When the core is free, pick the process with the **lowest priority number** (= highest urgency)
3. Run it for up to QUANTUM = 4 ticks
4. If it finishes before 4 ticks: mark DONE, pick next
5. If quantum expires before finishing: put it back in the queue, pick next

In the C code:

```c
// Pop the highest-priority (lowest number) pid from queue
static int pop_best(Core *c) {
    if (c->n == 0) return -1;
    int bi = 0;
    for (int i = 1; i < c->n; i++)
        if (procs[c->q[i]].priority < procs[c->q[bi]].priority)
            bi = i;
    int pid = c->q[bi];
    c->q[bi] = c->q[--c->n];  // swap with last, shrink array
    return pid;
}
```

This scans the queue, finds the process with the smallest priority number, removes it and returns it. O(n) but for small queues this is fine.

The scheduling itself happens in `schedule_all()`:

```c
// tick the running process
p->rem--;        // one tick of CPU consumed
c->qleft--;      // one tick of quantum consumed

if (p->rem == 0) {
    // Process finished — compute TAT and WT
    p->tat = p->end_tick - p->arrive;
    p->wait_time = p->tat - p->burst;
} else if (c->qleft == 0) {
    // Quantum expired — preempt, put back in queue
    push(c, c->running);
    c->running = -1;
}
```

**What to say in viva:**
> "Priority Round-Robin is my base scheduling policy. Each core independently picks the highest-priority process from its queue and runs it for up to 4 ticks. If the quantum expires, the process is preempted and goes back to the queue. This prevents any single process from monopolizing a core, while still respecting priorities."

---

# PART 3 — MULTI-CORE SCHEDULING
*(What makes this project different from basic scheduling)*

---

## 3.1 Why Multi-Core Changes Everything

On a single-core system, scheduling is simple: maintain one queue, pick the best process, run it.

On a multi-core system, you have N cores that can all execute simultaneously. New problems emerge:

1. **How do you distribute processes across cores?** If you put them all on one core, the others sit idle.
2. **What if some cores get overloaded while others are empty?**
3. **How do you move processes between cores without causing problems?**
4. **Should each core have its own queue, or share one global queue?**

These are the problems our project solves.

---

## 3.2 Global Queue vs Per-Core Queue

**Global queue approach:** All cores share one single queue. Any idle core picks the next process.
- Pros: automatically balanced, simpler
- Cons: the queue becomes a bottleneck (needs a lock), cache performance is poor

**Per-core queue approach (what we use):** Each core has its own ready queue. Processes are assigned to a specific core.
- Pros: no contention on the queue, better cache locality
- Cons: can become imbalanced — one core might have 5 processes while another has 0

Because we use per-core queues, we need active load balancing. That's why algorithms 2, 3, and 4 exist.

**What to say in viva:**
> "I chose per-core queues because they avoid lock contention and improve cache performance. The tradeoff is that load imbalance can occur, which I address through Work Stealing and Dynamic Migration."

---

## 3.3 Load Imbalance — The Problem

Imagine 4 cores and 8 processes all arriving at tick 0:
- Initial assignment might give Core 0: [P0, P1, P2, P3, P4, P5, P6, P7]
- Cores 1, 2, 3 sit completely idle

This is terrible. 75% of your CPU capacity is wasted. This is called **load imbalance**.

Even with a perfect initial assignment, imbalance develops over time because:
- Processes have different burst times — some finish early, some run long
- New processes arrive at different times
- Processes get preempted and re-queued unevenly

Our three load balancing algorithms fix this.

---

# PART 4 — THE FOUR ALGORITHMS IN DETAIL
*(Know every line of every algorithm)*

---

## 4.1 Algorithm 1 — Process Admission (Initial Assignment)

Before any balancing, we need to assign incoming processes to a core.

**Rule:** Assign to the core with the minimum current load.

```c
static void admit_new(void) {
    for (int i = 0; i < nprocs; i++) {
        PCB *p = &procs[i];
        if (p->state != NEW || p->arrive > tick) continue;

        int best = 0;
        for (int c = 1; c < CORES; c++)
            if (load(c) < load(best)) best = c;  // pick least loaded

        p->state = READY;
        p->core  = best;
        push(&cores[best], i);
    }
}
```

`load(c)` = `queue size + (1 if a process is currently running)`.

This is called every tick. As soon as a process's arrival time is reached, it gets admitted to the lightest core.

**What to say in viva:**
> "When a process arrives, I assign it to the core with the minimum load. Load is defined as the number of processes in the queue plus one if a process is currently running. This gives us a reasonable initial distribution."

---

## 4.2 Algorithm 2 — Work Stealing

**Problem it solves:** A core becomes completely idle (nothing running, nothing in queue) while other cores are still busy.

**How it works:**
1. Find any core with 0 processes (idle core)
2. Find the busiest core (most processes in its queue)
3. If the busiest has ≥ 2 queued processes, steal one
4. The stolen process moves to the idle core's queue

**Why steal from the tail?** We steal the lowest-priority process. It hurts the source core least (it would have run last anyway) and gives the idle core something to do.

```c
static void work_steal(void) {
    for (int idle = 0; idle < CORES; idle++) {
        // only act if this core is truly idle
        if (cores[idle].running != -1 || cores[idle].n > 0) continue;

        // find busiest core
        int src = -1;
        for (int c = 0; c < CORES; c++) {
            if (c == idle) continue;
            if (src == -1 || cores[c].n > cores[src].n) src = c;
        }
        if (src == -1 || cores[src].n < 2) continue;

        // steal the lowest priority process from src
        int worst_pri = -1, pid = -1;
        for (int i = 0; i < cores[src].n; i++) {
            int pp = procs[cores[src].q[i]].priority;
            if (pp > worst_pri) { worst_pri = pp; pid = cores[src].q[i]; }
        }
        remove_pid(&cores[src], pid);
        push(&cores[idle], pid);
        procs[pid].core = idle;
        procs[pid].migrations++;
        steals++;
    }
}
```

**Real world:** Work stealing is used by:
- Java's ForkJoinPool (used in parallel streams)
- Go runtime's goroutine scheduler
- Intel's Threading Building Blocks (TBB)
- Chrome's task scheduler

**What to say in viva:**
> "Work Stealing activates whenever a core has nothing to do — no running process and an empty queue. It finds the busiest core and takes one of its waiting processes. This immediately puts the idle core to work instead of wasting CPU cycles. The condition of needing ≥ 2 processes ensures we don't steal the only job from a core that's about to finish its current process."

---

## 4.3 Algorithm 3 — Dynamic Migration

**Problem it solves:** Work stealing only helps when a core is completely idle. Dynamic Migration handles the subtler case: all cores are busy but load is uneven. Example: Core 0 has 6 queued, Core 1 has 1 queued.

**How it works (every 5 ticks):**
1. Compare every pair of cores (i, j)
2. If `core_i.queue - core_j.queue > IMBAL_THRESH (= 2)`, migrate
3. Move the lowest-priority waiting process from heavy to light

```c
static void migrate(void) {
    for (int h = 0; h < CORES; h++) {
        for (int l = 0; l < CORES; l++) {
            if (h == l) continue;
            if (cores[h].n - cores[l].n <= IMBAL_THRESH) continue;

            // find lowest-priority process in heavy queue
            int worst_pri = -1, pid = -1;
            for (int i = 0; i < cores[h].n; i++) {
                int pp = procs[cores[h].q[i]].priority;
                if (pp > worst_pri) { worst_pri = pp; pid = cores[h].q[i]; }
            }
            if (pid == -1) continue;
            remove_pid(&cores[h], pid);
            push(&cores[l], pid);
            procs[pid].core = l;
            procs[pid].migrations++;
            migrations++;
        }
    }
}
```

**Why every 5 ticks?** Migrating too frequently causes overhead (migration itself takes time) and thrashing (processes keep bouncing between cores). Every 5 ticks is a balance.

**Why IMBAL_THRESH = 2?** A difference of 1 or 2 is acceptable — migration overhead isn't worth it. Only at 3+ does migration pay off.

**Why move the lowest-priority process?** It's the least urgent, so it can afford the delay of moving. The high-priority processes on the heavy core get to run sooner.

**What to say in viva:**
> "Dynamic Migration runs every 5 ticks. It scans all core pairs and if any two cores differ by more than 2 processes in their queue, it moves the lowest-priority waiting process from the heavier core to the lighter one. This maintains active balance even when no core is completely idle. I chose every 5 ticks and a threshold of 2 to avoid the overhead of migrating too aggressively."

---

## 4.4 Algorithm 4 — Priority Aging

**Problem it solves:** Starvation.

**What is starvation?** In a priority scheduler, low-priority processes might wait forever if high-priority processes keep arriving. The low-priority process sits in the queue, never getting CPU time. This is starvation.

Example:
- Priority 1 process arrives → runs
- Priority 1 process arrives → runs
- Priority 1 process arrives → runs
- Priority 5 process from tick 0 is still waiting at tick 100...

**How aging fixes it:**
Every AGING_EVERY = 10 ticks, the priority number of every waiting (READY) process is decremented by 1. Lower number = higher priority. So a priority-5 process waiting for 30 ticks becomes priority-2, and will now compete with high-priority processes.

Eventually, every process gets a high enough priority to run. **Starvation is structurally impossible** with aging.

```c
static void age_priorities(void) {
    for (int i = 0; i < nprocs; i++) {
        PCB *p = &procs[i];
        if (p->state == READY && p->priority > 1) {
            p->priority--;  // boost: lower number = higher priority
        }
    }
}
```

**What to say in viva:**
> "Priority Aging prevents starvation. Every 10 ticks, any process that is still waiting gets its priority number decreased by 1, making it more urgent. Without aging, a stream of high-priority processes could completely block low-priority ones indefinitely. With aging, even the lowest priority process will eventually reach priority 1 and be guaranteed to run."

---

# PART 5 — THE CODE EXPLAINED
*(Walk the examiner through your code confidently)*

---

## 5.1 Data Structures

### The Queue (`Core.q[]`)
We use a **simple array as a queue**, not a circular buffer or linked list. This is intentional — for small queues (max ~16 elements), array scanning is fast and simple.

```c
typedef struct {
    int  q[64];     // array holding process IDs waiting for this core
    int  n;         // current number of processes in queue
    int  running;   // ID of currently running process (-1 if idle)
    int  qleft;     // how many ticks left in current quantum
    long busy;      // total ticks this core was executing
    long total;     // total ticks elapsed (for utilization calc)
} Core;
```

Three key queue operations:

**push** — add a process to the end:
```c
static void push(Core *c, int id) {
    c->q[c->n++] = id;
}
```

**pop_best** — remove and return the highest-priority process:
```c
// finds minimum priority number in the array, removes it
// swaps with last element (O(1) removal from unsorted array)
int pid = c->q[bi];
c->q[bi] = c->q[--c->n];
return pid;
```

**remove_pid** — remove a specific process by ID (used in migration):
```c
static int remove_pid(Core *c, int pid) {
    for (int i = 0; i < c->n; i++) {
        if (c->q[i] == pid) {
            c->q[i] = c->q[--c->n];  // swap with last, shrink
            return 1;
        }
    }
    return 0;
}
```

---

## 5.2 The Main Loop

Every tick, these 5 steps happen in this exact order:

```c
while (done_count < nprocs) {
    tick++;
    admit_new();                               // step 1: new processes enter
    if (tick % AGING_EVERY == 0) age_priorities(); // step 2: boost starving
    if (tick % 5 == 0)           migrate();    // step 3: rebalance
    work_steal();                              // step 4: help idle cores
    schedule_all();                            // step 5: run one tick on each core
}
```

**Why this order matters:**
- New processes must be admitted before scheduling so they can run immediately
- Aging and migration happen before work stealing so the stolen process might already have a better priority
- Work stealing before schedule_all so the idle core has something to run this tick

---

## 5.3 The JavaScript Engine (engine.js)

The web UI doesn't call the C code. It re-implements the same algorithms in JavaScript. Both produce identical results.

Key design: **the engine is a pure module with no DOM access**. It only processes data. The renderer reads the engine's snapshot and updates the screen. This separation means:
- Engine can be tested independently
- Renderer can be swapped without touching algorithm logic
- Makes the code easier to explain and reason about

```javascript
const Engine = (() => {
    // private state
    let procs = [], cores = [], tick = 0, ...

    // private functions (algorithms)
    function admitNew() { ... }
    function workSteal() { ... }
    function migrate() { ... }
    function applyAging() { ... }
    function scheduleCores() { ... }

    // public API — only what the UI needs
    return {
        init(numCores),       // reset everything
        tick(),               // advance one tick
        addProcess(...),      // inject a process mid-simulation
        setFlag(key, val),    // toggle algorithms on/off
        isFinished(),         // are all processes done?
        snapshot(),           // return a copy of state for rendering
        clearEvents(),        // clear the log
    };
})();
```

This pattern is called the **Module Pattern** (or IIFE — Immediately Invoked Function Expression). It creates a private scope so the internal state can't be accidentally modified from outside.

---

## 5.4 The Renderer (renderer.js)

The renderer reads a snapshot (a plain data object) and generates HTML strings that replace the DOM content. It never touches the engine's internal state.

```javascript
function render(s) {
    renderHeader(s);    // tick counter, done count
    renderPills(s);     // algorithm pill counters
    renderCores(s);     // the 4 core cards
    renderTable(s);     // process table
    renderGantt(s);     // gantt chart
    renderLog(s);       // event log
    renderFooter(s);    // stats + util bars
    flashRows(s);       // animate rows for steal/migrate events
}
```

Each render function generates an HTML string and sets `.innerHTML`. This is simple and works well for the simulation's update rate.

---

# PART 6 — PROCESS SYNCHRONIZATION
*(Related topic you might be asked about)*

---

## 6.1 The Critical Section Problem

When multiple processes share a resource (like a shared queue), we have a problem: if two processes try to modify it simultaneously, the data gets corrupted.

The **Critical Section** is the code that accesses shared data. Rules for a correct solution:
1. **Mutual Exclusion** — only one process in the critical section at a time
2. **Progress** — if no one is in the critical section, someone who wants in can enter
3. **Bounded Waiting** — a process waiting to enter will eventually get in (no starvation)

**In our project:** Since our C program is single-threaded (one process simulating everything), we don't need actual synchronization. But in a real multi-core OS kernel, the per-core queues would each need a lock (mutex) to prevent two cores from modifying the same queue simultaneously.

---

## 6.2 Semaphores

A semaphore is an integer variable with two atomic operations:
- **wait(S)** (also called P): if S > 0, decrement. Otherwise block.
- **signal(S)** (also called V): increment S, wake up a waiting process.

**Binary semaphore (mutex):** S ∈ {0, 1}. Used like a lock.
**Counting semaphore:** S ≥ 0. Used to manage N resources.

---

## 6.3 Classical Synchronization Problems

### Producer-Consumer Problem
- Producer generates items, puts them in a buffer
- Consumer takes items from the buffer
- Problem: buffer overflow (producer too fast) or underflow (consumer too fast)
- Solution: semaphores for full/empty slots + mutex for buffer access

### Reader-Writer Problem
- Multiple readers can read simultaneously
- Only one writer at a time, no readers allowed while writing
- Solution: priority to readers or writers depending on requirement

### Dining Philosophers Problem
- 5 philosophers sit at a table, each needs 2 forks to eat
- Classic deadlock scenario: all pick up left fork, wait for right forever
- Solution: asymmetric solution (one philosopher picks right fork first), or semaphores

---

# PART 7 — DEADLOCK
*(Another topic you might be asked about)*

---

## 7.1 What is Deadlock?

Deadlock occurs when a set of processes are all waiting for resources held by each other, and none can proceed.

**Four necessary conditions (Coffman conditions):**
1. **Mutual Exclusion** — resources are non-shareable (only one process at a time)
2. **Hold and Wait** — process holds a resource while waiting for another
3. **No Preemption** — resources can't be forcibly taken away
4. **Circular Wait** — P1 waits for P2, P2 waits for P3, P3 waits for P1

All four must hold simultaneously for deadlock to occur.

**Deadlock Handling Methods:**
1. **Prevention** — eliminate one of the four conditions by design
2. **Avoidance** — Banker's Algorithm: only grant resources if state remains "safe"
3. **Detection** — let deadlock happen, detect it, then recover
4. **Ignorance** — pretend deadlock doesn't exist (used by Windows and Linux for some cases — "ostrich algorithm")

**What to say in viva:**
> "In our scheduler, deadlock isn't a concern because processes only need CPU time — they don't compete for other shared resources. But in a real system, if processes needed to acquire locks, deadlock prevention would be necessary."

---

# PART 8 — MEMORY MANAGEMENT
*(Context for the full OS course)*

---

## 8.1 Logical vs Physical Address

The CPU generates **logical (virtual) addresses**. The **Memory Management Unit (MMU)** hardware translates these to **physical addresses** in RAM.

This separation lets:
- Each process think it has its own private address space
- The OS move processes in memory without the process knowing
- The OS implement virtual memory (using disk as an extension of RAM)

---

## 8.2 Paging

Memory is divided into fixed-size blocks:
- **Frames** — physical memory blocks
- **Pages** — logical memory blocks (same size as frames)

The OS maintains a **page table** per process that maps page numbers to frame numbers.

**Advantages:** No external fragmentation. Any free frame can be used.
**Disadvantage:** Internal fragmentation (last page might not be fully used). Page table overhead.

---

## 8.3 Virtual Memory and Demand Paging

Not all pages of a process need to be in RAM at once. The OS keeps only **active pages in RAM**, storing the rest on disk.

When a process accesses a page not in RAM: **page fault** occurs. OS loads the page from disk (slow!) and resumes the process.

**Page replacement algorithms** decide which page to evict when RAM is full:
- **FIFO** — evict the oldest page
- **LRU** — evict the least recently used page
- **Optimal** — evict the page not needed for longest time (theoretical best)

---

# PART 9 — VIVA PREPARATION
*(The actual questions and answers)*

---

## 9.1 Questions You Will Definitely Be Asked

**Q: Explain your project in one sentence.**
> "My project simulates a multi-core CPU scheduler that uses four algorithms — Priority Round-Robin, Work Stealing, Dynamic Migration, and Priority Aging — to efficiently distribute processes across multiple CPU cores while preventing starvation and minimizing idle time."

---

**Q: What is the difference between process and thread?**
> "A process is an independent program with its own memory space. A thread is a lighter unit of execution inside a process that shares the process's memory. Multiple threads in the same process can run in parallel on different cores."

---

**Q: What is preemptive scheduling? Is your scheduler preemptive?**
> "Preemptive scheduling means the OS can forcibly stop a running process and give the CPU to another. Yes, my scheduler is preemptive — when a process's 4-tick quantum expires, it is stopped and put back in the ready queue even if it hasn't finished."

---

**Q: What is the time quantum and how did you choose 4?**
> "The quantum is the maximum time a process gets on the CPU before being preempted. I chose 4 ticks as a reasonable balance — small enough to give all processes turns regularly, but large enough to avoid constant context switching overhead. In real OSes, a typical quantum is 10–100ms."

---

**Q: What is Work Stealing and why is it useful?**
> "Work Stealing is triggered when a core becomes completely idle — nothing running and nothing queued. Instead of wasting those CPU cycles, the idle core looks for the busiest other core and takes one of its waiting processes. This prevents the situation where one core is overloaded and another is doing nothing."

---

**Q: What is Dynamic Migration?**
> "Dynamic Migration runs every 5 ticks. It compares all pairs of cores and if any two cores differ in queue size by more than 2, it moves the lowest-priority waiting process from the heavier core to the lighter one. This actively corrects imbalances even when no core is completely idle."

---

**Q: What is starvation and how do you prevent it?**
> "Starvation is when a low-priority process waits so long that it never gets CPU time because high-priority processes keep arriving. I prevent it with Priority Aging: every 10 ticks, any waiting process gets its priority number decreased by 1, making it more urgent. Eventually every process reaches priority 1 and is guaranteed to run."

---

**Q: What is turnaround time and waiting time? Calculate for a process.**
> "Turnaround time is the total time from when a process arrives until it finishes: TAT = finish - arrive. Waiting time is the time spent not running: WT = TAT - burst. For example, if Alpha arrives at tick 0, has burst 12, and finishes at tick 19: TAT = 19-0 = 19, WT = 19-12 = 7."

---

**Q: Why did you use per-core queues instead of one global queue?**
> "Per-core queues avoid lock contention — in a real OS, a global queue needs a lock that all cores must acquire before accessing it, which becomes a bottleneck. Per-core queues let each core work independently. The tradeoff is potential imbalance, which I handle with Work Stealing and Dynamic Migration."

---

**Q: What is the Critical Section Problem?**
> "The Critical Section Problem asks how to ensure that when multiple processes access shared data, only one can be in the critical section at a time, ensuring data consistency. The three requirements are mutual exclusion, progress, and bounded waiting."

---

**Q: What is Deadlock?**
> "Deadlock occurs when processes are circularly waiting for resources held by each other, and none can proceed. It requires four conditions simultaneously: mutual exclusion, hold and wait, no preemption, and circular wait. In our scheduler, deadlock doesn't occur because we only schedule CPU access."

---

**Q: What scheduling algorithm does Linux use?**
> "Linux uses the Completely Fair Scheduler (CFS). It doesn't use fixed time quanta — instead it tracks how much CPU time each process has used and always runs the process with the least CPU time. It uses a red-black tree sorted by virtual runtime for O(log n) scheduling decisions."

---

**Q: What is context switching?**
> "Context switching is the process of saving the state (registers, program counter, stack pointer) of the currently running process into its PCB, and loading the saved state of the next process. It's the mechanism that enables preemptive multitasking. It has overhead — real context switches take microseconds."

---

**Q: Can you explain your Gantt chart?**
> "The Gantt chart shows time on the horizontal axis and processes on the vertical axis. Each colored cell shows which core ran that process at that tick. Blue = Core 0, Green = Core 1, Amber = Core 2, Purple = Core 3. Grey means the process was idle/waiting that tick. By hovering over a cell, you can see the exact tick and core."

---

**Q: Why is your project better than simple Round Robin?**
> "Simple Round Robin uses one queue for all processes and ignores priorities. My scheduler adds: (1) priority-awareness so urgent processes run first, (2) multi-core support with per-core queues, (3) Work Stealing and Dynamic Migration to prevent load imbalance, and (4) Priority Aging to prevent starvation. Together these improve throughput, response time, and fairness."

---

**Q: If you had more time, what would you add?**
> "I would add I/O simulation — processes that block waiting for disk reads, which would trigger the WAITING state and make the scheduler more realistic. I would also implement NUMA-awareness, where the scheduler prefers assigning processes to the core closest to the memory that process is using."

---

## 9.2 Things to Point at During Demo

When showing the web UI:

1. **Point at the core cards** — "Each card shows the currently running process, how much quantum it has left, and the queue of waiting processes below it."

2. **Toggle Work Stealing OFF** — wait a few ticks — show a core going idle. Toggle back ON — show it immediately steal a process.

3. **Click Step mode** — walk through tick by tick during viva.

4. **Point at the Gantt chart** — "Each colored row is a process. You can see exactly which core ran it at each tick and when it was waiting."

5. **Point at the Event Log** — "Every scheduling decision is logged here. Green = steal, amber = migration, purple = aging boost, cyan = dispatch."

6. **Show the footer stats** — "Average turnaround time, average waiting time, total steals and migrations."

---

## 9.3 Numbers to Remember

| Constant | Value | Why |
|---|---|---|
| QUANTUM | 4 ticks | Balance between fairness and context-switch overhead |
| IMBAL_THRESH | 2 | Migration only when difference is significant |
| AGING_EVERY | 10 ticks | Frequent enough to prevent starvation, rare enough to not disrupt priority order |
| Default processes | 10 | Enough to show load balancing without being overwhelming |
| Default cores | 4 | Mirrors a typical modern processor |

---

## 9.4 One-Line Summaries of Everything

- **OS** = software that manages hardware resources for programs
- **Process** = a running program with its own memory and state
- **PCB** = data structure storing everything the OS knows about a process
- **Scheduler** = part of OS that decides which process runs on which core when
- **Preemption** = forcibly stopping a running process
- **Round Robin** = give everyone equal time slices in rotation
- **Priority scheduling** = always run the most urgent process first
- **Starvation** = a process waiting forever because higher priority always jump ahead
- **Aging** = gradually boosting priority of waiting processes to prevent starvation
- **Work Stealing** = idle core pulls work from busiest core
- **Migration** = moving a process from overloaded core to underloaded core
- **Load balancing** = keeping all cores roughly equally busy
- **TAT** = total time from arrival to completion
- **WT** = time spent waiting (TAT minus burst)
- **Throughput** = processes completed per unit time
- **Context switch** = saving one process's state and loading another's
- **Semaphore** = counter used to coordinate access to shared resources
- **Deadlock** = circular waiting where no process can proceed
- **Paging** = dividing memory into fixed-size pages for flexible allocation
- **Virtual memory** = using disk as extension of RAM via page faults

---

*Good luck. You've got this.*
