import Link from "next/link";
import { listProductionStates } from "@/lib/production";
import { listProspects } from "@/lib/sales";
import {
  summarizeByClient,
  secondsInWindow,
  dailyActivityWindow,
  currentStreak,
} from "@/lib/timeLog";
import { getClientRevenue, computeEhr } from "@/lib/ehr";
import { listCareClients } from "@/core/finance";
import { computeHealthScore } from "@/lib/healthScore";
import { computeKpis } from "@/lib/forecast";
import { getConfig } from "@/lib/config";
import { detectFirings } from "@/lib/automations";
import { KpiCard } from "@/components/KpiCard";
import { MissionTile } from "@/components/MissionTile";
import { ActivityHeatmap } from "@/components/ActivityHeatmap";
import { ScoreBar } from "@/components/ScoreBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { JarvisHero } from "@/components/JarvisHero";
import { DashboardEntry } from "@/components/DashboardEntry";
import { ScrambleTitle } from "@/components/ScrambleTitle";
import { getActivityFeed, assembleHealthOverview, buildKpiSummary, buildGreeting, assembleFiringSignals, assembleNotifications } from "@/mission-control";
import { assembleInsights } from "@/mission-control/insights";
import { assembleForecast } from "@/mission-control/forecast";
import { assembleCompliance } from "@/mission-control/compliance";
import { assembleApprovals } from "@/mission-control/approvals";
import { assembleSiteQuality } from "@/mission-control/site-quality";
import { assembleEffort } from "@/mission-control/effort";
import { assemblePipeline } from "@/mission-control/pipeline";
import { assembleDocuments } from "@/mission-control/documents";
import { APPROVAL_KIND_LABEL } from "@/domain";
import { PriorityFeed } from "@/components/PriorityFeed";
import { ActivityStream } from "@/components/ActivityStream";
import { HealthTiles } from "@/components/HealthTiles";
import { NotificationInbox } from "@/components/NotificationInbox";
import { rank } from "@/engines/decision-engine";
import { dismissNotification, viewNotification, snoozeNotification } from "@/core/notifications";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function dismissNotificationAction(formData: FormData) {
  "use server";
  const signalKey = String(formData.get("signalKey") ?? "");
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (signalKey) await dismissNotification(signalKey, fingerprint);
  revalidatePath("/dashboard");
}

// Fixed snooze durations (D-3.6b.4) — no reminders, no scheduler, no background wake.
const SNOOZE_MS: Record<string, number> = { "1h": 3_600_000, "1d": 86_400_000, "1w": 604_800_000 };

async function viewNotificationAction(formData: FormData) {
  "use server";
  const signalKey = String(formData.get("signalKey") ?? "");
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (signalKey) await viewNotification(signalKey, fingerprint);
  revalidatePath("/dashboard");
}

async function snoozeNotificationAction(formData: FormData) {
  "use server";
  const signalKey = String(formData.get("signalKey") ?? "");
  const fingerprint = String(formData.get("fingerprint") ?? "");
  const ms = SNOOZE_MS[String(formData.get("duration") ?? "")];
  // `until` is computed HERE (surface), never in the engine — the engine only compares an injected `now`.
  if (signalKey && ms) await snoozeNotification(signalKey, fingerprint, new Date(Date.now() + ms).toISOString());
  revalidatePath("/dashboard");
}

export default async function DashboardPage() {
  const config = await getConfig();
  const [
    states,
    prospects,
    summaries,
    weekSeconds,
    monthSeconds,
    days,
    streak,
    financeKpis,
    firings,
    firing,
    activity,
    healthTiles,
    careClients,
  ] = await Promise.all([
    listProductionStates(),
    listProspects(),
    summarizeByClient(),
    secondsInWindow(7),
    secondsInWindow(30),
    dailyActivityWindow(30),
    currentStreak(),
    computeKpis(config.monthly_target_usd),
    detectFirings(),
    assembleFiringSignals(),
    getActivityFeed(),
    assembleHealthOverview(),
    listCareClients(),
  ]);

  // MC-4: the shared firing signals are distributed to two independent consumers with no
  // recomputation — Decision (rank → priority feed) and Notification (reconcile → inbox).
  const priorityItems = rank(firing);
  const notifications = await assembleNotifications(firing);
  // Phase 6 — read-only historical insights (Intelligence Engine). MC gathers + injects now; renders only.
  const insights = await assembleInsights();
  // Phase 6.1 — read-only forward-looking forecasts (Intelligence · sibling of Insights). Extrapolation only.
  const forecasts = await assembleForecast();
  // Phase 7 — read-only production-template compliance (SOP Engine). Facts only; no writes/events.
  const compliance = await assembleCompliance();
  // Phase 8 — read-only approvals awareness (blocking status). MC gathers + injects now; renders only.
  const approvals = await assembleApprovals();
  // Phase 9 — read-only site quality (measured external quality of shipped sites). Facts only; clock-free.
  const siteQuality = await assembleSiteQuality();
  // Phase 10 — read-only effort distribution (where delivery time goes). Facts only; clock-free.
  const effort = await assembleEffort();
  // Phase 11 — read-only sales pipeline funnel (structure only). Facts only; clock-free; no ranking.
  const pipeline = await assemblePipeline();
  // Phase 12 — read-only document lifecycle (deal paperwork state). Facts only; clock-free; no revenue.
  const documents = await assembleDocuments();

  const enriched = await Promise.all(
    states.map(async (s) => {
      const totalSeconds = summaries[s.clientSlug]?.total_seconds ?? 0;
      const revenue = await getClientRevenue(s.clientSlug);
      const ehr = computeEhr(revenue, totalSeconds);
      const hoursLast7 = (await secondsInWindow(7, s.clientSlug)) / 3600;
      const health = computeHealthScore(s, hoursLast7);
      return { state: s, totalSeconds, revenue, ehr, health };
    })
  );

  const inFlight = enriched.filter((e) => e.state.activePhaseIndex !== null);

  const activeProspects = prospects.filter((p) => p.frontmatter.status !== "closed-lost");
  const topProspects = activeProspects.slice(0, 3);
  const pendingFirings = firings.pending.length;

  // Jarvis briefing — pure presentation of Decision's ranked PriorityItems + raw owned status facts.
  const jarvisGreeting = buildGreeting({
    priorityItems,
    status: {
      streak,
      yesterdaySeconds: days[days.length - 2]?.seconds ?? 0,
      pendingAutomations: pendingFirings,
      overdue: { count: financeKpis.overdueCount, amount: financeKpis.overdueAmount },
    },
  });

  return (
    <DashboardEntry>
      {/* ─── 1. Page header ─────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">mission control</p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
            <ScrambleTitle text="JARVIS  HUD" prefix={<></>} suffix={<></>} />
          </h1>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* ─── 2. JARVIS hero — full-width centerpiece ───────────────────── */}
      <JarvisHero briefing={jarvisGreeting} />

      {/* ─── 2b. Priority feed — Decision Engine ranked ────────────────── */}
      <section className="glass scanlines mb-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-[var(--color-danger)] shadow-[0_0_6px_var(--color-danger)] hud-pulse" />
            priorities · what needs you now
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {priorityItems.length} ranked
          </span>
        </header>
        <PriorityFeed items={priorityItems} />
      </section>

      {/* ─── 2c. Notification inbox — persisted lifecycle over the shared firing signals ─── */}
      <section className="glass scanlines mb-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-[var(--color-system)] shadow-[0_0_6px_var(--color-system)] hud-pulse" />
            inbox · awaiting you
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {notifications.filter((n) => n.status === "raised").length} open
          </span>
        </header>
        <NotificationInbox
          notifications={notifications}
          dismissAction={dismissNotificationAction}
          viewAction={viewNotificationAction}
          snoozeAction={snoozeNotificationAction}
        />
      </section>

      {/* ─── 3. Executive KPIs · owned read-models, render-only (MC-1) ──── */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {buildKpiSummary({
          finance: financeKpis,
          hours7dSeconds: weekSeconds,
          activeCarePlans: careClients.length,
        }).map((k) => (
          <KpiCard key={k.key} label={k.label} value={k.value} sub={k.sub} />
        ))}
      </section>

      {/* ─── 4. Active projects — full width ───────────────────────────── */}
      <section className="glass scanlines mb-6 rounded-xl p-4 sm:p-5">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] hud-pulse" />
            active projects · {inFlight.length}
          </h2>
          <Link href="/production" className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 hover:text-[var(--color-accent)]">
            all →
          </Link>
        </header>
        {inFlight.length === 0 ? (
          <p className="rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-6 text-sm text-zinc-500">
            No projects in flight. All clients are launched / in maintenance.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {inFlight.map((e) => (
              <MissionTile
                key={e.state.clientSlug}
                state={e.state}
                health={e.health}
                totalSeconds={e.totalSeconds}
                revenue={e.revenue}
                ehr={e.ehr}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── 4b. Portfolio health · all projects, least-healthy first ────── */}
      <section className="glass scanlines mb-6 rounded-xl p-4 sm:p-5">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] hud-pulse" />
            portfolio health · {healthTiles.length}
          </h2>
          <Link href="/production" className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 hover:text-[var(--color-accent)]">
            all →
          </Link>
        </header>
        <HealthTiles tiles={healthTiles} />
      </section>

      {/* ─── 5. Hit list snapshot + activity heatmap ───────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="glass scanlines rounded-xl p-4 sm:p-5">
          <header className="mb-3 flex items-end justify-between">
            <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
              <span className="size-1.5 rounded-full bg-[var(--color-system)] shadow-[0_0_6px_var(--color-system)] hud-pulse" />
              hit list snapshot
            </h2>
            <Link href="/sales" className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 hover:text-[var(--color-accent)]">
              all targets →
            </Link>
          </header>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Mini label="Active" value={activeProspects.length} />
            <Mini label="Priority" value={activeProspects.filter((p) => p.score.tier === "priority").length} accent />
            <Mini label="Hot" value={activeProspects.filter((p) => p.score.tier === "hot").length} />
          </div>

          {topProspects.length > 0 && (
            <>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">top 3 by score</p>
              <ul className="flex flex-col gap-2">
                {topProspects.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/sales/${p.slug}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-zinc-800/50 bg-zinc-950/40 p-2 transition-colors hover:border-[var(--color-accent)]/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-200">{p.frontmatter.name ?? p.slug}</p>
                        <p className="truncate font-mono text-[10px] text-zinc-500">
                          {[p.frontmatter.business_type, p.frontmatter.location].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <StatusBadge status={p.frontmatter.status} />
                      <ScoreBar result={p.score} />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {pendingFirings > 0 && (
            <div className="mt-4 flex items-center justify-between rounded-md border border-[var(--color-system)]/30 bg-[var(--color-system)]/5 px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-system)]">
                ⏵ {pendingFirings} automation{pendingFirings === 1 ? "" : "s"} pending
              </span>
              <Link href="/automations" className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-system)] hover:text-[var(--color-system-hi)]">
                review →
              </Link>
            </div>
          )}
        </section>

        <ActivityHeatmap days={days} streak={streak} totalSeconds={monthSeconds} />
      </div>

      {/* ─── 6. Activity stream — the event spine, newest-first ────────────── */}
      <section className="glass scanlines mt-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            activity · recent events
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {activity.length} event{activity.length === 1 ? "" : "s"}
          </span>
        </header>
        <ActivityStream events={activity} />
      </section>

      <section className="glass scanlines mt-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            intelligence · what changed
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {insights.length} insight{insights.length === 1 ? "" : "s"}
          </span>
        </header>
        <ul className="flex flex-col gap-2">
          {insights.map((it) => {
            const mark = it.direction === "up" ? "text-emerald-400" : it.direction === "down" ? "text-rose-400" : "text-zinc-500";
            return (
              <li key={it.id} className="flex items-start gap-2.5 rounded-md border border-zinc-800/50 bg-zinc-950/40 p-3">
                <span aria-hidden className={`mt-0.5 font-mono text-xs ${mark}`}>
                  {it.direction === "up" ? "▲" : it.direction === "down" ? "▼" : "▬"}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">{it.statement}</p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-zinc-600">{it.rule}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="glass scanlines mt-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            outlook · forecast
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {forecasts.length} projection{forecasts.length === 1 ? "" : "s"}
          </span>
        </header>
        <ul className="flex flex-col gap-2">
          {forecasts.map((f) => {
            const tone =
              f.confidence === "high" ? "text-emerald-400" : f.confidence === "medium" ? "text-amber-400" : "text-zinc-500";
            return (
              <li key={f.id} className="flex items-start justify-between gap-3 rounded-md border border-zinc-800/50 bg-zinc-950/40 p-3">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">{f.statement}</p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-zinc-600">{f.metric}</p>
                </div>
                <span className={`shrink-0 font-mono text-[9px] uppercase tracking-widest ${tone}`}>
                  {f.confidence} confidence
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="glass scanlines mt-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            process · template compliance
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {compliance.length} project{compliance.length === 1 ? "" : "s"}
          </span>
        </header>
        <ul className="flex flex-col gap-2">
          {compliance.map((r) => {
            const missing = r.phases.reduce((sum, p) => sum + p.missingSteps.length, 0);
            const tone =
              !r.hasTemplate
                ? "text-zinc-500"
                : (r.overallCoverage ?? 0) >= 90
                  ? "text-emerald-400"
                  : (r.overallCoverage ?? 0) >= 60
                    ? "text-amber-400"
                    : "text-rose-400";
            return (
              <li key={r.clientSlug} className="rounded-md border border-zinc-800/50 bg-zinc-950/40 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-zinc-200">{r.clientSlug}</span>
                  <span className={`shrink-0 font-mono text-[10px] uppercase tracking-widest ${tone}`}>
                    {r.hasTemplate ? `${r.overallCoverage}% · ${r.industryTemplate}` : "no template"}
                  </span>
                </div>
                {r.hasTemplate && missing > 0 && (
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-zinc-600">
                    {missing} canonical step{missing === 1 ? "" : "s"} missing
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="glass scanlines mt-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            waiting on client · approvals
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {approvals.counts.overdue} overdue · {approvals.counts.pending} pending
          </span>
        </header>
        {approvals.counts.overdue + approvals.counts.pending === 0 ? (
          <p className="text-sm text-zinc-500">No client approvals outstanding.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...approvals.overdue, ...approvals.pending].map((a) => {
              const tone = a.status === "overdue" ? "text-rose-400" : "text-amber-400";
              return (
                <li key={a.id} className="flex items-start justify-between gap-3 rounded-md border border-zinc-800/50 bg-zinc-950/40 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-200">{a.title}</p>
                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-zinc-600">
                      {a.clientSlug} · {APPROVAL_KIND_LABEL[a.kind]}
                    </p>
                  </div>
                  <span className={`shrink-0 font-mono text-[9px] uppercase tracking-widest ${tone}`}>
                    {a.status}
                    {a.due ? ` · due ${a.due.slice(0, 10)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="glass scanlines mt-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            site quality · shipped sites
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {siteQuality.counts.poor} poor · {siteQuality.counts.needsImprovement} need work
          </span>
        </header>
        {siteQuality.sites.length === 0 ? (
          <p className="text-sm text-zinc-500">No audits recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {siteQuality.sites.map((s) => {
              const tone =
                s.worstBand === "poor"
                  ? "text-rose-400"
                  : s.worstBand === "needs-improvement"
                    ? "text-amber-400"
                    : s.worstBand === "good"
                      ? "text-emerald-400"
                      : "text-zinc-500";
              return (
                <li key={`${s.clientSlug}:${s.strategy}`} className="rounded-md border border-zinc-800/50 bg-zinc-950/40 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-zinc-200">
                      {s.clientSlug} <span className="text-zinc-600">· {s.strategy}</span>
                    </span>
                    <span className={`shrink-0 font-mono text-[9px] uppercase tracking-widest ${tone}`}>{s.worstBand}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[9px] uppercase tracking-widest text-zinc-600">
                    {s.categories.map((c) => (
                      <span key={c.category}>
                        {c.category.replace("_", " ")} {c.score ?? "—"}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="glass scanlines mt-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            effort distribution · where time goes
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {(effort.totalSeconds / 3600).toFixed(1)}h total
          </span>
        </header>
        {effort.totalSeconds === 0 ? (
          <p className="text-sm text-zinc-500">No time logged.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {effort.byPhase.map((p) => (
              <li key={p.phase} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate font-mono text-[10px] uppercase tracking-widest text-zinc-400">{p.phase}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800/60">
                  <span className="block h-full rounded-full bg-[var(--color-accent)]/60" style={{ width: `${p.share}%` }} />
                </span>
                <span className="w-20 shrink-0 text-right font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  {p.hours}h · {p.share}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass scanlines mt-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            sales pipeline · funnel
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {pipeline.openCount} open · {pipeline.totalCount} total
          </span>
        </header>
        {pipeline.totalCount === 0 ? (
          <p className="text-sm text-zinc-500">No prospects.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {pipeline.stages.map((s) => (
              <li key={s.status} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate font-mono text-[10px] uppercase tracking-widest text-zinc-400">{s.label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800/60">
                  <span className="block h-full rounded-full bg-[var(--color-accent)]/60" style={{ width: `${s.share}%` }} />
                </span>
                <span className="w-28 shrink-0 text-right font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  {s.count}
                  {s.avgScore !== null ? ` · avg ${s.avgScore}` : ""}
                  {s.hotCount > 0 ? ` · ${s.hotCount}🔥` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass scanlines mt-6 rounded-xl p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-500" />
            documents · deal paperwork
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {documents.counts.total} docs
            {documents.counts.paperworkInProgressUsd > 0
              ? ` · $${documents.counts.paperworkInProgressUsd.toLocaleString()} in progress`
              : ""}
          </span>
        </header>
        {documents.counts.total === 0 ? (
          <p className="text-sm text-zinc-500">No documents.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-wrap gap-1.5">
              {documents.byStatus.map((s) => (
                <li
                  key={s.status}
                  className="rounded-md border border-zinc-800/50 bg-zinc-950/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400"
                >
                  {s.label} · <span className="tabular-nums text-zinc-200">{s.count}</span>
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-1.5">
              {documents.documents.map((d) => (
                <li key={d.docId} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                    {d.client}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
                    {d.title} <span className="text-zinc-500">· {d.typeLabel} v{d.version}</span>
                  </span>
                  <span className="w-28 shrink-0 text-right font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    {d.statusLabel}
                    {d.amountUsd !== null ? ` · $${d.amountUsd.toLocaleString()}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {documents.lineages.length > 0 && (
              <ul className="flex flex-col gap-1 border-t border-zinc-800/50 pt-2">
                {documents.lineages.map((l) => (
                  <li
                    key={`${l.client}:${l.type}:${l.chain[0].docId}`}
                    className="font-mono text-[10px] uppercase tracking-widest text-zinc-500"
                  >
                    <span className="text-zinc-400">{l.client}</span> ·{" "}
                    {l.chain.map((c) => `${c.typeLabel} v${c.version}`).join(" → ")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </DashboardEntry>
  );
}

function Mini({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-md border border-zinc-800/50 bg-zinc-950/40 p-2">
      <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">{label}</p>
      <p
        className={`mt-0.5 font-mono text-base font-bold tabular-nums ${
          accent ? "text-[var(--color-accent)]" : "text-zinc-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
