#!/usr/bin/env node
// Ascend OS — vault scaffold script
// Creates the Obsidian vault tree at the iCloud Drive path (or a user-specified one)
// and seeds a `_template` client + a real Decoraciones Pilar client.
// Idempotent: existing files are NEVER overwritten (skipped with a log line).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const DEFAULT_VAULT = path.join(
  os.homedir(),
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/Ascend"
);

const VAULT = process.env.ASCEND_VAULT_PATH || DEFAULT_VAULT;

function log(kind, msg) {
  const tag = {
    info: "\x1b[36mℹ\x1b[0m",
    ok: "\x1b[32m✓\x1b[0m",
    skip: "\x1b[90m–\x1b[0m",
    warn: "\x1b[33m!\x1b[0m",
    err: "\x1b[31m✗\x1b[0m",
  }[kind];
  console.log(`${tag} ${msg}`);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeIfMissing(filePath, content) {
  try {
    await fs.access(filePath);
    log("skip", `exists ${path.relative(VAULT, filePath)}`);
    return false;
  } catch {
    await fs.writeFile(filePath, content, "utf8");
    log("ok", `wrote  ${path.relative(VAULT, filePath)}`);
    return true;
  }
}

// ─── Templates ─────────────────────────────────────────────────────────────

const TEMPLATE_BUSINESS = `---
name: New Client
business: New Client LLC
industry: ""
location: ""
contact_name: ""
contact_email: ""
contact_phone: ""
website: ""
languages: ["English"]
---

## Overview
Short description of what this business does, who it serves, and what makes it distinct.

## Goals
- Primary business goal
- Secondary goal

## Notes
Loose qualitative details — communication preferences, scheduling quirks, etc.
`;

const TEMPLATE_BRAND = `---
primary_color: "#000000"
secondary_color: "#ffffff"
accent_color: ""
fonts:
  heading: ""
  body: ""
voice: "professional, warm, direct"
logo_assets: []
photography_style: ""
---

## Brand Voice
How this brand should sound in writing.

## Visual Notes
Anything about the look & feel that isn't captured in colors/fonts.
`;

const TEMPLATE_SCOPE = `---
phase: onboarding
package: ""
deliverables: []
launch_target: ""
status: active
---

## Scope Summary
What we're building, in plain language.

## Out of Scope
Explicit list of things we are NOT doing.

## Decisions Log
- YYYY-MM-DD — decision made and why
`;

const TEMPLATE_META = (slug) => ({
  client_id: slug,
  organization_id: "ascend",
  status: "active",
  tier: "starter",
  created_at: new Date().toISOString(),
  source: "manual",
});

// ─── Seed: Decoraciones Pilar ───────────────────────────────────────────────

const PILAR_BUSINESS = `---
name: Decoraciones Pilar
business: Decoraciones Pilar
industry: Event Planning / Catering
location: Central Valley, CA
contact_name: Pilar Rodriguez
contact_email: ""
contact_phone: ""
website: https://decorpilar.com
languages: ["English", "Spanish"]
retainer_active: true
retainer_started: "2026-03-01"
---

## Overview
Wedding planning and event design firm with 25+ years of experience, serving the Central Valley. Recognized for excellence in delivering elegant, meticulously planned weddings, with services spanning event design, catering, and rentals.

## Goals
- Communicate the scale and elegance of their events online without losing personal warmth
- Guide couples smoothly from inspiration to inquiry
- Reinforce trust and professionalism through high-quality visuals

## Notes
- Prefers Spanish for in-person conversations; bilingual site copy preferred.
- Owner (Pilar) handles inquiries personally — keep contact path simple.
`;

const PILAR_BRAND = `---
primary_color: "#2a1f1a"
secondary_color: "#f5efe6"
accent_color: "#c9a96e"
fonts:
  heading: "Serif (elegant, editorial)"
  body: "Humanist sans-serif"
voice: "warm, elegant, personal, trustworthy"
logo_assets: []
photography_style: "Natural light, candid, romantic. Real events over stock."
---

## Brand Voice
Speaks the way Pilar would speak to a bride in person — gracious, attentive, and confident. Avoid corporate jargon. Bilingual tone matters: English copy should feel as warm as the Spanish would.

## Visual Notes
Editorial wedding-magazine feel. Generous whitespace. Slow, considered pacing. Photography is the hero.
`;

const PILAR_SCOPE = `---
phase: launched
package: growth
revenue_usd: 2497          # explicit override (matches Growth tier; could differ for custom scope)
deliverables:
  - Marketing site (delivered)
  - Service pages (delivered)
  - Inquiry funnel (delivered)
launch_target: "2025-07"
status: maintenance
---

## Scope Summary
Delivered a clean, visually-driven site that emphasizes elegance and trust. Navigation simplified, services highlighted, inquiry funnel guided couples naturally from inspiration to outreach.

## Out of Scope
- E-commerce
- Online booking calendar (Phase 0 — would revisit)

## Decisions Log
- 2025-07-01 — Site launched. Owner reported increased inquiry quality.
`;

const PILAR_META = {
  client_id: "decoraciones-pilar",
  organization_id: "ascend",
  status: "maintenance",
  tier: "growth",
  created_at: "2025-07-01T00:00:00.000Z",
  source: "seed",
  website: "https://decorpilar.com",
};

// ─── Seed: Hit List prospects ───────────────────────────────────────────────

const TEMPLATE_PROSPECT = `---
name: New Prospect LLC
business_type: ""
location: ""
status: lead              # lead | contacted | proposal | closed-won | closed-lost
website: ""               # leave empty if none
website_quality: none     # none | outdated | acceptable | modern  ( none|outdated → +30 )
decision_maker_access: false   # true → +25
project_urgency: low      # low | medium | high  ( high → +25 )
niche_alignment: false    # true → +20
contact_name: ""
contact_phone: ""
contact_email: ""
source: ""
first_contact: ""
last_contact: ""
---

## Call Log
- YYYY-MM-DD — what happened

## Friction / Notes
Open questions, objections, gatekeepers, anything qualitative.
`;

const PROSPECT_PRIORITY = `---
name: Valley Roofing Pros
business_type: Roofing
location: Modesto, CA
status: lead
website: ""
website_quality: none
decision_maker_access: true
project_urgency: high
niche_alignment: true
contact_name: Marco Alvarez
contact_phone: "(209) 555-0142"
contact_email: marco@valleyroofingpros.example
source: GBP cold-search
first_contact: ""
last_contact: ""
---

## Call Log
- 2026-06-15 — GBP listing has 4.9★ over 60 reviews but no website. Owner answered directly; said his "Facebook page is the website" and wants something "real" before storm season.

## Friction / Notes
- Active intent — explicitly mentioned losing leads to competitors with sites.
- Bilingual (English/Spanish) requested.
- Decision-maker is the owner; no committee.
`;

const PROSPECT_HOT = `---
name: Modesto HVAC Co
business_type: HVAC
location: Modesto, CA
status: contacted
website: https://example-modestohvac.com
website_quality: outdated
decision_maker_access: true
project_urgency: medium
niche_alignment: true
contact_name: Linda Chen
contact_phone: "(209) 555-0188"
contact_email: linda@modestohvac.example
source: Referral — Tapia Tile
first_contact: "2026-06-10"
last_contact: "2026-06-14"
---

## Call Log
- 2026-06-10 — Intro call. Site is from ~2014, mobile-broken. Booking happens entirely over phone.
- 2026-06-14 — Sent over Tapia case study. Linda wants to "think on it" before scheduling a discovery call.

## Friction / Notes
- Concern: doesn't want to commit to a redesign mid-summer (peak service season).
- Opportunity: offer phased rollout — landing page + booking now, full site in Q4.
`;

const PROSPECT_WARM = `---
name: Central Coast Cleaning
business_type: Residential Cleaning
location: San Luis Obispo, CA
status: lead
website: https://example-cccleaning.com
website_quality: acceptable
decision_maker_access: false
project_urgency: low
niche_alignment: true
contact_name: ""
contact_phone: "(805) 555-0119"
contact_email: ""
source: Outbound list
first_contact: ""
last_contact: ""
---

## Call Log
- 2026-06-18 — Receptionist said the owner "isn't taking sales calls right now." Asked for a callback window — none offered.

## Friction / Notes
- Gatekeeper blocking. Need a warm intro or a different angle (email to a verified address).
- Site is acceptable — angle would have to be SEO / care plan rather than rebuild.
`;

// ─── Seed: Tapia Tile & Marble (CRM + mid-design production) ────────────────

const TAPIA_BUSINESS = `---
name: Tapia Tile & Marble Co.
business: Tapia Tile & Marble Co.
industry: Tile Installation / Construction
location: Central Valley, CA
contact_name: Eligio Tapia
contact_email: ""
contact_phone: ""
website: https://tapiatilemarbleco.com
languages: ["English", "Spanish"]
---

## Overview
High-quality tile and marble installation, serving homeowners and contractors. Craftsmanship-first, with a portfolio that justifies premium pricing.

## Goals
- Showcase precision craftsmanship through real project photography
- Make services scannable for both homeowners and contractors
- Drive qualified inquiries — not casual browsers

## Notes
- Owner (Eligio) prefers texts over email.
- Bilingual site copy preferred.
`;

const TAPIA_BRAND = `---
primary_color: "#1a1a1a"
secondary_color: "#f8f5f0"
accent_color: "#a07a4b"
fonts:
  heading: "Modern serif"
  body: "Neutral sans-serif"
voice: "confident, precise, understated"
logo_assets: []
photography_style: "Detail shots of finished work, in-process craftsmanship, before/after"
---

## Brand Voice
Lets the work speak. Avoid superlatives. Specific over flowery.

## Visual Notes
Tight cropping, high contrast, material textures front and center.
`;

const TAPIA_SCOPE = `---
phase: design
package: growth
deliverables:
  - Marketing site
  - Portfolio gallery
  - Contact / quote funnel
launch_target: "2026-08-15"
status: active
---

## Scope Summary
Premium marketing site with a portfolio gallery as the centerpiece. Clear paths for homeowner inquiries vs contractor partnerships.

## Out of Scope
- Online booking
- Materials e-commerce

## Decisions Log
- 2026-06-08 — Sitemap approved. Going with a portfolio-first homepage layout.
- 2026-06-15 — Design phase kicked off. Homepage mockup v1 in review.
`;

const TAPIA_META = {
  client_id: "tapia-tile-marble",
  organization_id: "ascend",
  status: "active",
  tier: "growth",
  created_at: "2026-06-01T00:00:00.000Z",
  source: "referral",
  website: "https://tapiatilemarbleco.com",
};

// ─── Seed: Production states ────────────────────────────────────────────────

const PILAR_PRODUCTION = `---
industry_template: events
launch_target: "2025-07-01"
phases:
  onboarding:
    status: complete
    started: "2025-05-15"
    completed: "2025-05-22"
  strategy:
    status: complete
    started: "2025-05-22"
    completed: "2025-06-05"
  design:
    status: complete
    started: "2025-06-05"
    completed: "2025-06-18"
  dev:
    status: complete
    started: "2025-06-18"
    completed: "2025-06-28"
  launch:
    status: complete
    started: "2025-06-28"
    completed: "2025-07-01"
---

## Phase: Onboarding
- [x] Discovery call
- [x] Deposit collected
- [x] Brand assets received
- [x] Bilingual content directions captured

## Phase: Strategy
- [x] Sitemap approved
- [x] Copy outline approved (EN + ES)
- [x] Photography plan finalized

## Phase: Design
- [x] Homepage mockup
- [x] Inner pages
- [x] Mobile mockups
- [x] Client sign-off

## Phase: Dev
- [x] Repo + scaffold
- [x] Page builds
- [x] Inquiry form (Formspree)
- [x] Bilingual switcher
- [x] Performance pass

## Phase: Launch
- [x] Pre-launch QA
- [x] DNS cutover to decorpilar.com
- [x] Post-launch monitoring (7 days)
- [x] Handoff docs sent
`;

const TAPIA_PRODUCTION = `---
industry_template: contractor
launch_target: "2026-08-15"
phases:
  onboarding:
    status: complete
    started: "2026-06-01"
    completed: "2026-06-08"
  strategy:
    status: complete
    started: "2026-06-08"
    completed: "2026-06-15"
  design:
    status: in_progress
    started: "2026-06-15"
  dev:
    status: not_started
  launch:
    status: not_started
---

## Phase: Onboarding
- [x] Discovery call scheduled
- [x] Deposit collected
- [x] Brand assets received
- [x] Bilingual direction captured

## Phase: Strategy
- [x] Sitemap approved
- [x] Portfolio-first homepage decision logged
- [x] Service taxonomy finalized

## Phase: Design
- [x] Homepage mockup v1
- [x] Portfolio gallery v1
- [ ] Homepage mockup v2 (after feedback)
- [ ] Inner page mockups (services, about, contact)
- [ ] Mobile mockups
- [ ] Client sign-off

## Phase: Dev
- [ ] Repo + scaffold
- [ ] Component library
- [ ] Page builds
- [ ] Inquiry / quote form
- [ ] Bilingual switcher
- [ ] Performance pass

## Phase: Launch
- [ ] Pre-launch QA (cross-browser + mobile)
- [ ] DNS cutover to tapiatilemarbleco.com
- [ ] Post-launch monitoring (7 days)
- [ ] Handoff docs sent
`;

// ─── Production templates (industry-flavored starters) ──────────────────────

function productionTemplate(industry, extras = {}) {
  const checklists = {
    onboarding: [
      "Discovery call scheduled",
      "Deposit collected",
      "Brand assets received",
      ...(extras.onboarding ?? []),
    ],
    strategy: [
      "Sitemap approved",
      "Copy outline approved",
      ...(extras.strategy ?? []),
    ],
    design: [
      "Homepage mockup v1",
      "Inner page mockups",
      "Mobile mockups",
      "Client sign-off",
      ...(extras.design ?? []),
    ],
    dev: [
      "Repo + scaffold",
      "Page builds",
      "Inquiry form",
      "Performance pass",
      ...(extras.dev ?? []),
    ],
    launch: [
      "Pre-launch QA",
      "DNS cutover",
      "Post-launch monitoring (7 days)",
      "Handoff docs sent",
      ...(extras.launch ?? []),
    ],
  };

  const phases = Object.entries(checklists)
    .map(([key, items]) => `## Phase: ${key[0].toUpperCase() + key.slice(1)}\n` + items.map((i) => `- [ ] ${i}`).join("\n"))
    .join("\n\n");

  return `---
industry_template: ${industry}
launch_target: ""
phases:
  onboarding: { status: not_started }
  strategy:   { status: not_started }
  design:     { status: not_started }
  dev:        { status: not_started }
  launch:     { status: not_started }
---

${phases}
`;
}

const PRODUCTION_TEMPLATE_GENERIC = productionTemplate("generic");

const PRODUCTION_TEMPLATE_HVAC = productionTemplate("hvac", {
  strategy: ["Service area map confirmed", "Emergency call CTA placement decided"],
  design: ["Service area map mockup", "After-hours / emergency banner design"],
  dev: ["Click-to-call wired (mobile)", "Service area schema markup"],
});

const PRODUCTION_TEMPLATE_PLUMBING = productionTemplate("plumbing", {
  strategy: ["Service area map confirmed", "Emergency vs scheduled service split"],
  design: ["Service area map mockup", "24/7 callout banner"],
  dev: ["Click-to-call wired (mobile)", "Quote request form"],
});

const PRODUCTION_TEMPLATE_CLEANING = productionTemplate("cleaning", {
  strategy: ["Recurring vs one-time service split", "Quote calculator scope decision"],
  design: ["Service tiers comparison table", "Booking flow mockup"],
  dev: ["Booking / quote form", "Service area validation in form"],
});

// ─── Automation rules (Pillar 10) ───────────────────────────────────────────

const AUTOMATION_TEMPLATE = `---
id: example-rule
name: Example rule (rename me)
description: Describe what this rule does and when it should fire.

# Trigger types: invoice.paid · production.phase_completed · production.launch_buffer_in · prospect.status_is
trigger:
  type: invoice.paid
  match:
    label_contains: deposit
    # client: tapia-tile-marble
    # amount_gte: 500

clipboard_label: Copy welcome email prompt
---

Write a warm welcome email to {{client_name}} confirming we received their {{amount}} deposit.
Match their brand voice (see Brand Identity). Set expectations for the next 48 hours.

# Available context variables per trigger type:
#   invoice.paid                → client_slug, client_name, label, amount, paid_date, due_date
#   production.phase_completed  → client_slug, client_name, phase_key, phase_label, overall_progress
#   production.launch_buffer_in → client_slug, client_name, days_to_launch, launch_target, overall_progress
#   prospect.status_is          → prospect_slug, prospect_name, status, score, tier, business_type, location
`;

const AUTOMATION_WELCOME_DEPOSIT = `---
id: welcome-on-deposit
name: Send welcome email when deposit paid
description: Fires when any invoice with "deposit" in the label is marked paid. Compiles a warm welcome email prompt scoped to that client.
trigger:
  type: invoice.paid
  match:
    label_contains: deposit
clipboard_label: Welcome email prompt
---

Write a warm welcome email to {{client_name}} confirming we received their {{amount}} deposit on {{paid_date}}.

The email should:
- Thank them and acknowledge the project is officially underway
- Set expectations: we'll send a project kickoff doc within 48 hours
- Mention the first thing we'll need from them (brand assets, content directions, photography access)
- Match their brand voice — look at the Brand Identity context I'll paste next

Keep it under 150 words. Sign as Oscar Robles · Ascend Web Solutions.
`;

const AUTOMATION_PHASE_COMPLETE = `---
id: phase-complete-celebration
name: Acknowledge each completed phase
description: Fires for every phase marked complete in production_state.md. Generates a quick client-facing update.
trigger:
  type: production.phase_completed
clipboard_label: Phase completion update
---

Write a quick (~80 words) client-facing update for {{client_name}} announcing that we've completed the {{phase_label}} phase.

- Lead with what's now done
- Mention what we're moving into next (whatever phase comes after {{phase_label}} in a 5-phase: Onboarding → Strategy → Design → Dev → Launch flow)
- End with one specific thing they can expect from us this week

Tone: confident, warm, low-jargon. Match the brand voice in the context I'll paste next.
`;

const AUTOMATION_HOT_LEAD = `---
id: hot-lead-prompt
name: Cold pitch when prospect is hot or priority
description: Fires for every prospect at status=lead with score >= 55. Generates a tailored cold outreach script.
trigger:
  type: prospect.status_is
  match:
    status: lead
    score_gte: 55
clipboard_label: Cold outreach script
---

Write a 90-word cold outreach pitch to {{prospect_name}}, a {{business_type}} in {{location}}.

Their score is {{score}} ({{tier}}). Lead with what makes them a strong fit (you'll see their score breakdown in the prospect context below). Plain English, no agency jargon, end with a low-friction CTA — either a 5-minute call or a specific question they can text back.
`;

const AUTOMATION_LAUNCH_BUFFER = `---
id: launch-buffer-qa
name: Schedule pre-launch QA when ≤7 days out
description: Fires when an active project is between 0 and 7 days from launch_target. Compiles a QA punch list prompt.
trigger:
  type: production.launch_buffer_in
  match:
    min_days: 0
    max_days: 7
clipboard_label: Pre-launch QA punch list
---

We are {{days_to_launch}} day(s) from launching {{client_name}}'s site (target {{launch_target}}, currently at {{overall_progress}}% overall).

Generate a tight pre-launch QA punch list covering:
- Cross-browser smoke check (Chrome, Safari, Firefox, iOS Safari)
- Mobile layout audit (320px, 375px, 768px breakpoints)
- Forms: every submission path, every honeypot, every confirmation state
- Performance: Lighthouse desktop + mobile (target 90+)
- SEO: meta titles/descriptions present, schema markup, sitemap.xml accessible
- Analytics: tracking confirmed firing
- 404 and offline states

Output as a checklist I can paste straight into the production_state.md Launch phase.
`;

// ─── Sidecar: time log seed ─────────────────────────────────────────────────

const SIDECAR_README = `# .ascend-os/

This hidden directory is written by the Ascend OS web app (port 3001).
Don't edit it by hand unless you know what you're doing.

- \`time_log.jsonl\` — one JSON object per line, append-only by convention.
  Active sessions have \`ended: null\`. Stopping fills \`ended\` and \`duration_seconds\`.
- \`invoices.jsonl\` — one invoice per line. \`paid_at: null\` means unpaid.
- \`config.json\` — app-wide config (monthly revenue target, etc).
`;

const CONFIG_SEED = JSON.stringify({ monthly_target_usd: 4000 }, null, 2) + "\n";

function invoice({ id, client, amount, label, issued, due, paid = null, note = "" }) {
  return JSON.stringify({
    id,
    client,
    amount_usd: amount,
    label,
    issued_at: new Date(issued).toISOString(),
    due_at: new Date(due).toISOString(),
    paid_at: paid ? new Date(paid).toISOString() : null,
    note,
  });
}

const INVOICES_SEED = [
  // Decoraciones Pilar — fully paid ($1248 deposit + $1249 final = $2497)
  invoice({ id: "seed-inv-pilar-01", client: "decoraciones-pilar", amount: 1248, label: "Initial deposit",
            issued: "2025-05-15", due: "2025-05-29", paid: "2025-05-28" }),
  invoice({ id: "seed-inv-pilar-02", client: "decoraciones-pilar", amount: 1249, label: "Final payment on launch",
            issued: "2025-07-01", due: "2025-07-15", paid: "2025-07-10" }),

  // Tapia Tile & Marble — deposit paid, final not yet issued
  invoice({ id: "seed-inv-tapia-01", client: "tapia-tile-marble", amount: 1248, label: "Initial deposit",
            issued: "2026-06-01", due: "2026-06-15", paid: "2026-06-12" }),

  // A historical paid invoice from earlier in the year to give the chart depth
  invoice({ id: "seed-inv-2026-03", client: "decoraciones-pilar", amount: 199, label: "Care plan · Mar 2026",
            issued: "2026-03-01", due: "2026-03-15", paid: "2026-03-12" }),
  invoice({ id: "seed-inv-2026-04", client: "decoraciones-pilar", amount: 199, label: "Care plan · Apr 2026",
            issued: "2026-04-01", due: "2026-04-15", paid: "2026-04-09" }),
  invoice({ id: "seed-inv-2026-05", client: "decoraciones-pilar", amount: 199, label: "Care plan · May 2026",
            issued: "2026-05-01", due: "2026-05-15", paid: "2026-05-11" }),
  // One UNPAID overdue invoice so the mark-paid flow is demoable on first visit
  invoice({ id: "seed-inv-2026-06", client: "decoraciones-pilar", amount: 199, label: "Care plan · Jun 2026",
            issued: "2026-06-01", due: "2026-06-15", paid: null }),
].join("\n") + "\n";

function timeEntry({ id, client, phase, task, startedISO, durationHours, note = "" }) {
  const start = new Date(startedISO);
  const end = new Date(start.getTime() + durationHours * 3600 * 1000);
  return JSON.stringify({
    id,
    client,
    phase,
    task,
    started: start.toISOString(),
    ended: end.toISOString(),
    duration_seconds: Math.round(durationHours * 3600),
    note,
  });
}

// Seed Decoraciones Pilar with realistic historical entries summing to ~18h
// so EHR computes to $2497 / 18h ≈ $138.7/hr — a believable result.
const TIME_LOG_SEED = [
  timeEntry({ id: "seed-pilar-01", client: "decoraciones-pilar", phase: "onboarding", task: "Discovery call",                 startedISO: "2025-05-16T17:00:00Z", durationHours: 1.0 }),
  timeEntry({ id: "seed-pilar-02", client: "decoraciones-pilar", phase: "onboarding", task: "Brand assets received",           startedISO: "2025-05-19T15:00:00Z", durationHours: 0.5 }),
  timeEntry({ id: "seed-pilar-03", client: "decoraciones-pilar", phase: "strategy",   task: "Sitemap approved",                startedISO: "2025-05-26T17:00:00Z", durationHours: 1.5 }),
  timeEntry({ id: "seed-pilar-04", client: "decoraciones-pilar", phase: "strategy",   task: "Copy outline approved (EN + ES)", startedISO: "2025-05-29T16:00:00Z", durationHours: 2.0 }),
  timeEntry({ id: "seed-pilar-05", client: "decoraciones-pilar", phase: "design",     task: "Homepage mockup",                 startedISO: "2025-06-09T15:00:00Z", durationHours: 3.0 }),
  timeEntry({ id: "seed-pilar-06", client: "decoraciones-pilar", phase: "design",     task: "Inner pages",                     startedISO: "2025-06-12T16:00:00Z", durationHours: 2.5 }),
  timeEntry({ id: "seed-pilar-07", client: "decoraciones-pilar", phase: "dev",        task: "Page builds",                     startedISO: "2025-06-20T15:00:00Z", durationHours: 4.0 }),
  timeEntry({ id: "seed-pilar-08", client: "decoraciones-pilar", phase: "dev",        task: "Inquiry form (Formspree)",        startedISO: "2025-06-24T16:00:00Z", durationHours: 1.0 }),
  timeEntry({ id: "seed-pilar-09", client: "decoraciones-pilar", phase: "dev",        task: "Bilingual switcher",              startedISO: "2025-06-25T15:00:00Z", durationHours: 1.0 }),
  timeEntry({ id: "seed-pilar-10", client: "decoraciones-pilar", phase: "launch",     task: "DNS cutover to decorpilar.com",   startedISO: "2025-06-30T17:00:00Z", durationHours: 0.5 }),
  timeEntry({ id: "seed-pilar-11", client: "decoraciones-pilar", phase: "launch",     task: "Post-launch monitoring (7 days)", startedISO: "2025-07-01T18:00:00Z", durationHours: 1.0 }),
  // Tapia: a couple of design-phase entries so the in-flight client has tracked time too
  timeEntry({ id: "seed-tapia-01", client: "tapia-tile-marble", phase: "design",     task: "Homepage mockup v1",               startedISO: "2026-06-15T16:00:00Z", durationHours: 2.5 }),
  timeEntry({ id: "seed-tapia-02", client: "tapia-tile-marble", phase: "design",     task: "Portfolio gallery v1",             startedISO: "2026-06-17T15:00:00Z", durationHours: 1.5 }),
].join("\n") + "\n";

// ─── Portal seeds (Pillar 12) ───────────────────────────────────────────────

// Pre-baked invite token for Pilar so the demo URL is shareable immediately.
// Real production would always use randomBytes; this is fine for seed/demo.
const PORTAL_INVITES_SEED = JSON.stringify({
  id: "seed-invite-pilar",
  client_slug: "decoraciones-pilar",
  token: "demo-pilar-eK7Nq2R5tZpA9YxLcFvB",
  created_at: "2025-05-08T00:00:00.000Z",
  revoked_at: null,
  label: "Initial onboarding invite",
}) + "\n";

// Two approval requests for Pilar: one already signed (homepage design), one open (launch sign-off).
const APPROVAL_REQUESTS_SEED = [
  JSON.stringify({
    id: "seed-approval-pilar-design",
    client_slug: "decoraciones-pilar",
    kind: "design",
    title: "Approve homepage design v2",
    description:
      "We've revised the homepage mockup with the warmer photography and the bilingual switcher in the header. Please review the v2 mockups attached in our last email — if anything still feels off, type it in your reply before signing.",
    created_at: "2025-06-15T00:00:00.000Z",
    due_at: null,
    approved_at: "2025-06-17T00:00:00.000Z",
    approved_by_name: "Pilar Rodriguez",
    signature_text: "Pilar Rodriguez",
  }),
  JSON.stringify({
    id: "seed-approval-pilar-launch",
    client_slug: "decoraciones-pilar",
    kind: "launch",
    title: "Approve launch to decorpilar.com",
    description:
      "Site is built, QA'd on Chrome/Safari/Firefox + iPhone + Android, and Lighthouse mobile is at 89. Approving here authorizes the DNS cutover from your existing host to the new build. Please confirm you've notified anyone in your org who needs to know.",
    created_at: "2025-06-28T00:00:00.000Z",
    due_at: null,
    approved_at: "2025-06-30T00:00:00.000Z",
    approved_by_name: "Pilar Rodriguez",
    signature_text: "Pilar Rodriguez",
  }),
].join("\n") + "\n";

// ─── Document Vault seeds (Pillar 8) ────────────────────────────────────────

const DOCUMENTS_README = `# 04 - Documents

Client-facing artifacts — proposals, contracts, SOWs, change orders.

Structure: \`<client-slug>/<type>/<title>-vN.md\` — markdown with YAML frontmatter for metadata.

Edit freely in Obsidian; the Ascend OS app picks up changes on next view.

Doc types:
- proposals/
- contracts/
- sows/
- change-orders/
`;

const PILAR_PROPOSAL_V1 = `---
doc_id: seed-doc-pilar-prop-v1
type: proposal
client: decoraciones-pilar
version: 1
status: superseded
title: Website Build · Growth Package
summary: First proposal draft — superseded by v2 with adjusted scope.
amount_usd: 2997
created_at: 2025-05-08T00:00:00.000Z
sent_at: 2025-05-09T00:00:00.000Z
---

# Website Build · Growth Package

## Overview

A new bilingual marketing site for Decoraciones Pilar that showcases 25+ years of wedding planning excellence through clean visuals and a smooth inquiry path.

## Scope

- Homepage with editorial layout
- About / philosophy page
- Services overview (event planning, design, catering, rentals)
- Portfolio gallery (12 events)
- Bilingual EN/ES with site-wide language switcher
- Inquiry form (Formspree)
- Performance pass (Lighthouse mobile ≥90)

## Investment

**$2,997** — 50% deposit ($1,498.50) on signing, 50% on launch.

## Timeline

7 weeks total: 1 onboarding, 2 strategy, 2 design, 1 dev, 1 launch.
`;

const PILAR_PROPOSAL_V2 = `---
doc_id: seed-doc-pilar-prop-v2
type: proposal
client: decoraciones-pilar
version: 2
status: accepted
title: Website Build · Growth Package
summary: Revised proposal — descoped to 12 events to 6, adjusted pricing, signed.
amount_usd: 2497
created_at: 2025-05-12T00:00:00.000Z
sent_at: 2025-05-13T00:00:00.000Z
accepted_at: 2025-05-15T00:00:00.000Z
supersedes: seed-doc-pilar-prop-v1
---

# Website Build · Growth Package

## Overview

A new bilingual marketing site for Decoraciones Pilar that showcases 25+ years of wedding planning excellence through clean visuals and a smooth inquiry path.

## Scope

- Homepage with editorial layout
- About / philosophy page
- Services overview (event planning, design, catering, rentals)
- Portfolio gallery (**6 hero events** — narrower than v1)
- Bilingual EN/ES with site-wide language switcher
- Inquiry form (Formspree)
- Performance pass (Lighthouse mobile ≥90)

## Out of Scope

- Online booking calendar (Phase 2)
- E-commerce / payment processing
- Additional event photography sessions

## Investment

**$2,497** — 50% deposit ($1,248.50) on signing, 50% on launch.

_Reduction from v1 reflects the narrower portfolio scope (6 events vs 12)._

## Timeline

7 weeks total: 1 onboarding, 2 strategy, 2 design, 1 dev, 1 launch. Target launch: July 2025.
`;

const PILAR_CONTRACT_V1 = `---
doc_id: seed-doc-pilar-contract-v1
type: contract
client: decoraciones-pilar
version: 1
status: accepted
title: Website Build Services Agreement
summary: Signed services agreement for the Growth Package build.
amount_usd: 2497
created_at: 2025-05-15T00:00:00.000Z
sent_at: 2025-05-15T00:00:00.000Z
accepted_at: 2025-05-16T00:00:00.000Z
---

# Website Build Services Agreement

## Parties

This agreement is between **Ascend Web Solutions** (Provider, represented by Oscar Robles) and **Decoraciones Pilar** (Client, represented by Pilar Rodriguez).

## Scope

Provider will design and develop a bilingual marketing website per the accepted Proposal v2 dated 2025-05-13. Scope is bounded by the Proposal; any work beyond requires a Change Order.

## Payment Terms

- **Deposit:** $1,248.50 — due on signing (non-refundable)
- **Final:** $1,248.50 — due on launch
- Net 14 from invoice date
- Invoices generated by Provider; payment via bank transfer

## Ownership

Upon final payment, all custom code, copy, and design deliverables are transferred to Client. Template/framework code retains its original license.

## Termination

Either party may terminate with 14 days written notice. Client pays for work completed through termination date.

## Maintenance

Care plan available after launch at separate retainer (see Care Plan addendum).
`;

// ─── Lighthouse audit seeds ─────────────────────────────────────────────────

function audit({ id, client, url, strategy, run_at, perf, a11y, bp, seo, lcp_ms, cls, fcp_ms, ttfb_ms, opportunities = [] }) {
  return JSON.stringify({
    id,
    client,
    url,
    strategy,
    run_at: new Date(run_at).toISOString(),
    scores: { performance: perf, accessibility: a11y, best_practices: bp, seo },
    cwv: { lcp_ms, fcp_ms, cls, ttfb_ms, inp_ms: null },
    opportunities,
    source: "seed",
  });
}

// 6 monthly historical audits for Pilar showing a slight upward trend
// (matches the 3 paid care-plan invoices Mar-May 2026 + retainer continuing)
const AUDITS_SEED = [
  audit({ id: "seed-aud-pilar-2026-01-mob", client: "decoraciones-pilar", url: "https://decorpilar.com", strategy: "mobile",
          run_at: "2026-01-08T12:00:00Z", perf: 78, a11y: 92, bp: 95, seo: 89,
          lcp_ms: 2900, fcp_ms: 1900, cls: 0.12, ttfb_ms: 540,
          opportunities: [{ id: "unused-css-rules", title: "Reduce unused CSS", savings_ms: 450 }] }),
  audit({ id: "seed-aud-pilar-2026-02-mob", client: "decoraciones-pilar", url: "https://decorpilar.com", strategy: "mobile",
          run_at: "2026-02-08T12:00:00Z", perf: 81, a11y: 92, bp: 95, seo: 89,
          lcp_ms: 2700, fcp_ms: 1750, cls: 0.10, ttfb_ms: 510 }),
  audit({ id: "seed-aud-pilar-2026-03-mob", client: "decoraciones-pilar", url: "https://decorpilar.com", strategy: "mobile",
          run_at: "2026-03-15T12:00:00Z", perf: 84, a11y: 95, bp: 96, seo: 91,
          lcp_ms: 2500, fcp_ms: 1600, cls: 0.08, ttfb_ms: 470 }),
  audit({ id: "seed-aud-pilar-2026-04-mob", client: "decoraciones-pilar", url: "https://decorpilar.com", strategy: "mobile",
          run_at: "2026-04-15T12:00:00Z", perf: 85, a11y: 95, bp: 96, seo: 91,
          lcp_ms: 2400, fcp_ms: 1550, cls: 0.07, ttfb_ms: 450 }),
  audit({ id: "seed-aud-pilar-2026-05-mob", client: "decoraciones-pilar", url: "https://decorpilar.com", strategy: "mobile",
          run_at: "2026-05-15T12:00:00Z", perf: 87, a11y: 95, bp: 96, seo: 91,
          lcp_ms: 2300, fcp_ms: 1500, cls: 0.07, ttfb_ms: 440 }),
  audit({ id: "seed-aud-pilar-2026-06-mob", client: "decoraciones-pilar", url: "https://decorpilar.com", strategy: "mobile",
          run_at: "2026-06-10T12:00:00Z", perf: 89, a11y: 96, bp: 96, seo: 91,
          lcp_ms: 2150, fcp_ms: 1430, cls: 0.06, ttfb_ms: 420,
          opportunities: [{ id: "render-blocking-resources", title: "Eliminate render-blocking resources", savings_ms: 300 }] }),
  // Desktop snapshot — runs less often, but show one to fill the desktop card
  audit({ id: "seed-aud-pilar-2026-06-dsk", client: "decoraciones-pilar", url: "https://decorpilar.com", strategy: "desktop",
          run_at: "2026-06-10T12:05:00Z", perf: 96, a11y: 96, bp: 100, seo: 92,
          lcp_ms: 1200, fcp_ms: 700, cls: 0.04, ttfb_ms: 280 }),
].join("\n") + "\n";

// ─── Run ────────────────────────────────────────────────────────────────────

async function main() {
  log("info", `Vault root: ${VAULT}`);

  const parent = path.dirname(VAULT);
  try {
    await fs.access(parent);
  } catch {
    log("err", `Parent directory does not exist: ${parent}`);
    log("err", "If your iCloud Drive isn't initialized for Obsidian, open Obsidian and create a vault there first, then re-run.");
    process.exitCode = 1;
    return;
  }

  await ensureDir(VAULT);

  const crmDir = path.join(VAULT, "01 - CRM & Clients");
  const hitDir = path.join(VAULT, "02 - Sales & Hit List");
  const sopDir = path.join(VAULT, "03 - SOP Library");
  await ensureDir(crmDir);
  await ensureDir(hitDir);
  await ensureDir(sopDir);

  // _template client
  const tpl = path.join(crmDir, "_template");
  await ensureDir(tpl);
  await writeIfMissing(path.join(tpl, "business_context.md"), TEMPLATE_BUSINESS);
  await writeIfMissing(path.join(tpl, "brand_identity.md"), TEMPLATE_BRAND);
  await writeIfMissing(path.join(tpl, "project_scope.md"), TEMPLATE_SCOPE);
  await writeIfMissing(
    path.join(tpl, "structural_meta.json"),
    JSON.stringify(TEMPLATE_META("_template"), null, 2) + "\n"
  );

  // Seeded real client
  const pilar = path.join(crmDir, "decoraciones-pilar");
  await ensureDir(pilar);
  await writeIfMissing(path.join(pilar, "business_context.md"), PILAR_BUSINESS);
  await writeIfMissing(path.join(pilar, "brand_identity.md"), PILAR_BRAND);
  await writeIfMissing(path.join(pilar, "project_scope.md"), PILAR_SCOPE);
  await writeIfMissing(
    path.join(pilar, "structural_meta.json"),
    JSON.stringify(PILAR_META, null, 2) + "\n"
  );

  // Hit List: README + seeded prospects (Phase 1)
  await writeIfMissing(
    path.join(hitDir, "README.md"),
    "# Sales & Hit List\n\nOne markdown file per prospect, named `prospect-slug.md`. Frontmatter drives the lead-scoring engine; the body is your call log and notes.\n\nSee `_template.md` for the full frontmatter contract.\n"
  );
  await writeIfMissing(path.join(hitDir, "_template.md"), TEMPLATE_PROSPECT);

  // Three seeded prospects covering the scoring tiers
  await writeIfMissing(path.join(hitDir, "valley-roofing-pros.md"), PROSPECT_PRIORITY);
  await writeIfMissing(path.join(hitDir, "modesto-hvac-co.md"), PROSPECT_HOT);
  await writeIfMissing(path.join(hitDir, "central-coast-cleaning.md"), PROSPECT_WARM);

  await writeIfMissing(path.join(sopDir, "README.md"), "# SOP Library\n\nInternal checklists, copy scripts, and frameworks live here.\n");

  // Production templates (Phase 2 / Pillar 4)
  const tplDir = path.join(sopDir, "production-templates");
  await ensureDir(tplDir);
  await writeIfMissing(path.join(tplDir, "generic.md"), PRODUCTION_TEMPLATE_GENERIC);
  await writeIfMissing(path.join(tplDir, "hvac.md"), PRODUCTION_TEMPLATE_HVAC);
  await writeIfMissing(path.join(tplDir, "plumbing.md"), PRODUCTION_TEMPLATE_PLUMBING);
  await writeIfMissing(path.join(tplDir, "cleaning.md"), PRODUCTION_TEMPLATE_CLEANING);

  // Automation rules (Pillar 10)
  const autoDir = path.join(sopDir, "automations");
  await ensureDir(autoDir);
  await writeIfMissing(path.join(autoDir, "_template.md"), AUTOMATION_TEMPLATE);
  await writeIfMissing(path.join(autoDir, "welcome-on-deposit.md"), AUTOMATION_WELCOME_DEPOSIT);
  await writeIfMissing(path.join(autoDir, "phase-complete-celebration.md"), AUTOMATION_PHASE_COMPLETE);
  await writeIfMissing(path.join(autoDir, "hot-lead-prompt.md"), AUTOMATION_HOT_LEAD);
  await writeIfMissing(path.join(autoDir, "launch-buffer-qa.md"), AUTOMATION_LAUNCH_BUFFER);

  // Seed: Decoraciones Pilar production_state (launched / maintenance)
  await writeIfMissing(path.join(pilar, "production_state.md"), PILAR_PRODUCTION);

  // Seed: Tapia Tile & Marble (new CRM client, mid-design production state)
  const tapia = path.join(crmDir, "tapia-tile-marble");
  await ensureDir(tapia);
  await writeIfMissing(path.join(tapia, "business_context.md"), TAPIA_BUSINESS);
  await writeIfMissing(path.join(tapia, "brand_identity.md"), TAPIA_BRAND);
  await writeIfMissing(path.join(tapia, "project_scope.md"), TAPIA_SCOPE);
  await writeIfMissing(
    path.join(tapia, "structural_meta.json"),
    JSON.stringify(TAPIA_META, null, 2) + "\n"
  );
  await writeIfMissing(path.join(tapia, "production_state.md"), TAPIA_PRODUCTION);

  // Hidden sidecar for app-managed data (time log)
  const appDir = path.join(VAULT, ".ascend-os");
  await ensureDir(appDir);
  await writeIfMissing(path.join(appDir, "README.md"), SIDECAR_README);
  await writeIfMissing(path.join(appDir, "time_log.jsonl"), TIME_LOG_SEED);
  await writeIfMissing(path.join(appDir, "config.json"), CONFIG_SEED);
  await writeIfMissing(path.join(appDir, "invoices.jsonl"), INVOICES_SEED);
  await writeIfMissing(path.join(appDir, "audits.jsonl"), AUDITS_SEED);
  await writeIfMissing(path.join(appDir, "portal_invites.jsonl"), PORTAL_INVITES_SEED);
  await writeIfMissing(path.join(appDir, "approval_requests.jsonl"), APPROVAL_REQUESTS_SEED);

  // Client uploads dir — visible in Obsidian for the docs that come through the portal
  await ensureDir(path.join(VAULT, "05 - Client Uploads"));
  await writeIfMissing(
    path.join(VAULT, "05 - Client Uploads", "README.md"),
    "# 05 - Client Uploads\n\nFiles submitted through the client portal land here, per-client.\n"
  );

  // Document Vault (Pillar 8) — seeded proposals/contracts in 04 - Documents/
  const docsDir = path.join(VAULT, "04 - Documents");
  await ensureDir(docsDir);
  await writeIfMissing(path.join(docsDir, "README.md"), DOCUMENTS_README);
  // Pilar proposal v1 (superseded), v2 (accepted), and signed contract
  const pilarProposalsDir = path.join(docsDir, "decoraciones-pilar", "proposals");
  const pilarContractsDir = path.join(docsDir, "decoraciones-pilar", "contracts");
  await ensureDir(pilarProposalsDir);
  await ensureDir(pilarContractsDir);
  await writeIfMissing(path.join(pilarProposalsDir, "website-build-proposal-v1.md"), PILAR_PROPOSAL_V1);
  await writeIfMissing(path.join(pilarProposalsDir, "website-build-proposal-v2.md"), PILAR_PROPOSAL_V2);
  await writeIfMissing(path.join(pilarContractsDir, "website-build-contract-v1.md"), PILAR_CONTRACT_V1);

  log("info", "Done. Add your .env.local to apps/os and run `npm run dev` from apps/os.");
}

main().catch((e) => {
  log("err", e.stack || String(e));
  process.exitCode = 1;
});
