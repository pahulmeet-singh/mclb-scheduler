/*
 * Multi-Core Load Balancing Scheduler
 * CSE316 - Operating Systems | 2025-26
 *
 * Algorithms implemented:
 *  1. Priority Round-Robin per core
 *  2. Work Stealing  (idle core pulls from busiest)
 *  3. Dynamic Migration (periodic rebalance)
 *  4. Priority Aging (starvation prevention)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ── Tunable constants ─────────────────────────────── */
#define CORES          4
#define QUANTUM        4
#define IMBAL_THRESH   2
#define AGING_EVERY   10

/* ── Process states ────────────────────────────────── */
#define NEW        0
#define READY      1
#define RUNNING    2
#define DONE       3

/* ── PCB ───────────────────────────────────────────── */
typedef struct {
    int  id;
    char name[12];
    int  burst;        /* total CPU needed          */
    int  rem;          /* remaining CPU             */
    int  priority;     /* 1=highest, 10=lowest      */
    int  arrive;       /* arrival tick              */
    int  state;
    /* stats */
    int  core;
    int  migrations;
    int  start_tick;   /* first time on CPU         */
    int  end_tick;
    int  wait_time;
    int  tat;          /* turnaround time           */
} PCB;

/* ── Per-core ready queue ──────────────────────────── */
typedef struct {
    int  q[64];        /* queue of PCB ids          */
    int  n;            /* current count             */
    int  running;      /* id of running process, -1 */
    int  qleft;        /* quantum ticks left        */
    long busy;         /* ticks spent executing     */
    long total;        /* total ticks elapsed       */
} Core;

/* ── Scheduler state ───────────────────────────────── */
static PCB  procs[64];
static int  nprocs;
static Core cores[CORES];
static long tick;
static int  done_count;
static long steals, migrations;

/* ──────────────────────────────────────────────────── */
/*  HELPER: push pid onto core queue                   */
/* ──────────────────────────────────────────────────── */
static void push(Core *c, int id) {
    c->q[c->n++] = id;
}

/* Pop highest-priority pid from core queue */
static int pop_best(Core *c) {
    if (c->n == 0) return -1;
    int bi = 0;
    for (int i = 1; i < c->n; i++)
        if (procs[c->q[i]].priority < procs[c->q[bi]].priority)
            bi = i;
    int pid = c->q[bi];
    c->q[bi] = c->q[--c->n];  /* swap with last, shrink */
    return pid;
}

/* Remove a specific pid from a queue (for migration) */
static int remove_pid(Core *c, int pid) {
    for (int i = 0; i < c->n; i++) {
        if (c->q[i] == pid) {
            c->q[i] = c->q[--c->n];
            return 1;
        }
    }
    return 0;
}

/* Total load on a core (queue + running) */
static int load(int ci) {
    return cores[ci].n + (cores[ci].running != -1 ? 1 : 0);
}

/* ──────────────────────────────────────────────────── */
/*  ALGORITHM 1 — Assign newly arrived processes       */
/* ──────────────────────────────────────────────────── */
static void admit_new(void) {
    for (int i = 0; i < nprocs; i++) {
        PCB *p = &procs[i];
        if (p->state != NEW || p->arrive > tick) continue;

        /* pick least-loaded core */
        int best = 0;
        for (int c = 1; c < CORES; c++)
            if (load(c) < load(best)) best = c;

        p->state = READY;
        p->core  = best;
        push(&cores[best], i);
        printf("[%4ld] ARRIVE   P%-2d %-8s → Core%d  "
               "(burst=%d pri=%d)\n",
               tick, p->id, p->name, best, p->burst, p->priority);
    }
}

/* ──────────────────────────────────────────────────── */
/*  ALGORITHM 2 — Work Stealing                        */
/*  Idle core steals from the busiest core's queue     */
/* ──────────────────────────────────────────────────── */
static void work_steal(void) {
    for (int idle = 0; idle < CORES; idle++) {
        if (cores[idle].running != -1 || cores[idle].n > 0) continue;

        /* find busiest core with ≥2 queued */
        int src = -1;
        for (int c = 0; c < CORES; c++) {
            if (c == idle) continue;
            if (src == -1 || cores[c].n > cores[src].n) src = c;
        }
        if (src == -1 || cores[src].n < 2) continue;

        /* steal lowest-priority process (won't hurt src much) */
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
        printf("[%4ld] STEAL    P%-2d %-8s  Core%d→Core%d  "
               "(src queue: %d→%d)\n",
               tick, pid, procs[pid].name, src, idle,
               cores[src].n + 1, cores[src].n);
    }
}

/* ──────────────────────────────────────────────────── */
/*  ALGORITHM 3 — Dynamic Migration                    */
/*  Rebalance when any two cores differ by > threshold */
/* ──────────────────────────────────────────────────── */
static void migrate(void) {
    for (int h = 0; h < CORES; h++) {
        for (int l = 0; l < CORES; l++) {
            if (h == l) continue;
            if (cores[h].n - cores[l].n <= IMBAL_THRESH) continue;

            /* move the lowest-priority waiting process */
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
            printf("[%4ld] MIGRATE  P%-2d %-8s  Core%d→Core%d  "
                   "(queues %d:%d)\n",
                   tick, pid, procs[pid].name, h, l,
                   cores[h].n, cores[l].n);
        }
    }
}

/* ──────────────────────────────────────────────────── */
/*  ALGORITHM 4 — Priority Aging                       */
/*  Boost waiting processes so they never starve       */
/* ──────────────────────────────────────────────────── */
static void age_priorities(void) {
    for (int i = 0; i < nprocs; i++) {
        PCB *p = &procs[i];
        if (p->state == READY && p->priority > 1) {
            p->priority--;
            printf("[%4ld] AGING    P%-2d %-8s  pri %d→%d\n",
                   tick, p->id, p->name, p->priority + 1, p->priority);
        }
    }
}

/* ──────────────────────────────────────────────────── */
/*  SCHEDULE — one tick per core (Priority Round-Robin)*/
/* ──────────────────────────────────────────────────── */
static void schedule_all(void) {
    for (int ci = 0; ci < CORES; ci++) {
        Core *c = &cores[ci];
        c->total++;

        /* tick the running process */
        if (c->running != -1) {
            PCB *p = &procs[c->running];
            p->rem--;
            c->qleft--;
            c->busy++;

            if (p->rem == 0) {
                /* finished */
                p->state    = DONE;
                p->end_tick = (int)tick;
                p->tat      = p->end_tick - p->arrive;
                p->wait_time = p->tat - p->burst;
                if (p->wait_time < 0) p->wait_time = 0;
                done_count++;
                printf("[%4ld] DONE     P%-2d %-8s  Core%d  "
                       "TAT=%d WT=%d migr=%d\n",
                       tick, p->id, p->name, ci,
                       p->tat, p->wait_time, p->migrations);
                c->running = -1;
            } else if (c->qleft == 0) {
                /* quantum expired — preempt */
                p->state = READY;
                push(c, c->running);
                printf("[%4ld] PREEMPT  P%-2d %-8s  Core%d  rem=%d\n",
                       tick, p->id, p->name, ci, p->rem);
                c->running = -1;
            }
        }

        /* dispatch next if idle */
        if (c->running == -1 && c->n > 0) {
            int pid    = pop_best(c);
            PCB *p     = &procs[pid];
            p->state   = RUNNING;
            p->core    = ci;
            c->running = pid;
            c->qleft   = QUANTUM;
            if (p->start_tick < 0) p->start_tick = (int)tick;
            printf("[%4ld] DISPATCH P%-2d %-8s → Core%d  "
                   "(pri=%d rem=%d)\n",
                   tick, pid, p->name, ci, p->priority, p->rem);
        }
    }
}

/* ──────────────────────────────────────────────────── */
/*  PRINT FINAL REPORT                                 */
/* ──────────────────────────────────────────────────── */
static void print_report(void) {
    printf("\n");
    printf("╔═══════════════════════════════════════════════════╗\n");
    printf("║          FINAL STATISTICS                         ║\n");
    printf("╠═══════════════════════════════════════════════════╣\n");
    printf("║ %-6s %-10s %5s %5s %5s %6s ║\n",
           "PID","Name","Burst","TAT","WT","Migr.");
    printf("╠═══════════════════════════════════════════════════╣\n");

    double tot_tat = 0, tot_wt = 0;
    for (int i = 0; i < nprocs; i++) {
        PCB *p = &procs[i];
        printf("║ P%-5d %-10s %5d %5d %5d %6d ║\n",
               p->id, p->name, p->burst, p->tat, p->wait_time, p->migrations);
        tot_tat += p->tat;
        tot_wt  += p->wait_time;
    }
    printf("╠═══════════════════════════════════════════════════╣\n");
    printf("║  Avg TAT : %-8.2f   Avg WT : %-8.2f           ║\n",
           tot_tat/nprocs, tot_wt/nprocs);
    printf("║  Total ticks: %-6ld  Steals: %-4ld  Migrations: %-3ld║\n",
           tick, steals, migrations);
    printf("╠═══════════════════════════════════════════════════╣\n");
    printf("║  Core  Utilization                                ║\n");
    for (int i = 0; i < CORES; i++) {
        double u = cores[i].total ? 100.0*cores[i].busy/cores[i].total : 0;
        printf("║  Core%d  %5.1f%%                                    ║\n", i, u);
    }
    printf("╚═══════════════════════════════════════════════════╝\n");
}

/* ──────────────────────────────────────────────────── */
/*  MAIN                                               */
/* ──────────────────────────────────────────────────── */
int main(void) {
    /* define processes */
    struct { char name[12]; int burst, priority, arrive; } jobs[] = {
        {"Alpha",  12, 3, 0}, {"Beta",   8, 1, 0},
        {"Gamma",  20, 5, 1}, {"Delta",  6, 2, 2},
        {"Epsilon",15, 4, 3}, {"Zeta",  10, 3, 4},
        {"Eta",     7, 1, 5}, {"Theta", 18, 6, 6},
        {"Iota",    5, 2, 7}, {"Kappa", 11, 4, 8},
    };

    nprocs = sizeof(jobs)/sizeof(jobs[0]);
    for (int i = 0; i < nprocs; i++) {
        procs[i] = (PCB){
            .id=i, .burst=jobs[i].burst, .rem=jobs[i].burst,
            .priority=jobs[i].priority, .arrive=jobs[i].arrive,
            .state=NEW, .core=-1, .start_tick=-1
        };
        strncpy(procs[i].name, jobs[i].name, 11);
    }

    for (int i = 0; i < CORES; i++)
        cores[i].running = -1;

    printf("Multi-Core Load Balancing Scheduler\n");
    printf("Cores: %d  Quantum: %d  Processes: %d\n\n", CORES, QUANTUM, nprocs);

    /* main loop */
    while (done_count < nprocs) {
        tick++;
        admit_new();
        if (tick % AGING_EVERY == 0) age_priorities();
        if (tick % 5 == 0)          migrate();
        work_steal();
        schedule_all();

        if (tick > 5000) { printf("Tick limit hit.\n"); break; }
    }

    print_report();
    return 0;
}
