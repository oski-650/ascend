"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

/* ─── shared types ─── */
type SmsMsg   = { from: "lead" | "engine"; text: string };
type LogLine  = { text: string; type: "neutral" | "process" | "alert" | "success" };
type CalEvent = { topPct: number; heightPct: number; label: string; sub?: string; kind: "job" | "drive" | "dead" };
type CalDay   = { label: string; events: CalEvent[] };

/* ─── contractor dashboard type ─── */
interface DashboardData {
  project: {
    name: string; client: string;
    originalContract: string; currentTotal: string;
    timeline: string; status: string; completion: number;
  };
  changeOrder: {
    id: string; description: string; costAdded: string;
    previousTotal: string; newTotal: string;
    status: "approved" | "pending"; timestamp: string;
  };
  signature: { name: string; date: string; time: string; ip: string };
  photos: { label: string; tag: string }[];
  documents: { name: string; status: "signed" | "sent" | "pending" | "filed"; icon: string }[];
  activityLog: { time: string; action: string; type: "neutral" | "success" | "alert" }[];
  audit: { item: string; amount: string; linked: string; vendor: string }[];
}

interface PresetData {
  id: string; label: string; scenario: string;
  sms: SmsMsg[]; log: LogLine[];
  narration: string[]; /* one caption per SMS message */
  /* calendar presets */
  beforeStats?: { num: string; label: string }[];
  afterStats?:  { num: string; label: string }[];
  before?: CalDay[]; after?: CalDay[];
  /* contractor dashboard preset */
  dashboard?: DashboardData;
}

/* ══════════════════════════════════════════════════════════
   PRESET DATA
   ══════════════════════════════════════════════════════════ */
const PRESETS: Record<string, PresetData> = {

  hvac: {
    id: "hvac",
    label: "HVAC & Plumbing",
    scenario: "Emergency Furnace — After-Hours Dispatch",
    narration: [
      "A real customer just texted in. The Engine is reading it.",
      "Emergency classified in 0.4 seconds. Scanning techs nearby.",
      "Zip code received — routing engine checking 8 available techs.",
      "Closest tech found 4.2 miles away. Offer sent to customer.",
      "Confirmed. Job is being written to the calendar right now.",
      "Booked. Mike is notified. Customer gets live ETA updates.",
      "Start to finish: 6 seconds. No hold music. No missed revenue.",
    ],
    sms: [
      { from: "lead",   text: "My furnace stopped working, it's freezing in here" },
      { from: "engine", text: "Emergency detected — furnace failure. What's your zip code?" },
      { from: "lead",   text: "95123" },
      { from: "engine", text: "Nearest tech 4.2 miles away. Available in 22 min. Confirm?" },
      { from: "lead",   text: "Yes please!" },
      { from: "engine", text: "✓ Booked. Mike R. en route. SMS updates incoming." },
      { from: "engine", text: "Total response time: 6 seconds. No hold music. No voicemail." },
    ],
    log: [
      { text: "> INBOUND CALL — (408) 555-0192 — 11:48 PM",   type: "neutral" },
      { text: "> TRANSCRIBING AUDIO... COMPLETE",              type: "process" },
      { text: "> INTENT: EMERGENCY_HVAC — 98.4% CONFIDENCE",  type: "alert"   },
      { text: '> KEYWORDS: ["furnace", "no heat", "freezing"]', type: "neutral" },
      { text: "> PRIORITY SCORE: 9.4 / 10 — HIGH MARGIN",     type: "alert"   },
      { text: "> SCANNING TECHS IN TERRITORY 95123...",        type: "process" },
      { text: "> MATCH: MIKE R. — 4.2MI — AVAILABLE NOW",     type: "success" },
      { text: "> ETA: 22 MINUTES — SLOT: TONIGHT 12:10AM",    type: "neutral" },
      { text: "> BOOKING CONFIRMED",                           type: "success" },
      { text: "> CUSTOMER NOTIFIED VIA SMS",                   type: "success" },
      { text: "> EST. REVENUE: $2,400 – $3,800 CAPTURED",     type: "success" },
      { text: "> ✓ ZERO HUMAN INTERVENTIONS REQUIRED",        type: "success" },
    ],
    beforeStats: [
      { num: "11",      label: "Jobs / Week" },
      { num: "4.2 HRS", label: "Drive Time / Day" },
      { num: "31%",     label: "Calendar Used" },
      { num: "$8,200",  label: "Weekly Revenue" },
    ],
    afterStats: [
      { num: "16",      label: "Jobs / Week" },
      { num: "0.8 HRS", label: "Drive Time / Day" },
      { num: "94%",     label: "Calendar Used" },
      { num: "$21,400", label: "Weekly Revenue" },
    ],
    before: [
      { label: "MON", events: [
        { topPct: 4,  heightPct: 20, label: "HVAC — San Jose",  kind: "job"   },
        { topPct: 25, heightPct: 11, label: "45 min drive",      kind: "drive" },
        { topPct: 37, heightPct: 22, label: "Quote — Oakland",   kind: "job"   },
        { topPct: 60, heightPct: 37, label: "Unbooked",          kind: "dead"  },
      ]},
      { label: "TUE", events: [
        { topPct: 4,  heightPct: 26, label: "Roof — Fresno",     kind: "job"   },
        { topPct: 31, heightPct: 16, label: "1h 10m drive",       kind: "drive" },
        { topPct: 48, heightPct: 22, label: "Plumbing — SF",      kind: "job"   },
        { topPct: 71, heightPct: 26, label: "Unbooked",           kind: "dead"  },
      ]},
      { label: "WED", events: [
        { topPct: 4,  heightPct: 93, label: "Nothing scheduled", kind: "dead"  },
      ]},
      { label: "THU", events: [
        { topPct: 4,  heightPct: 22, label: "HVAC — Milpitas",   kind: "job"   },
        { topPct: 27, heightPct: 20, label: "1h 30m drive",       kind: "drive" },
        { topPct: 48, heightPct: 22, label: "Repair — Daly",      kind: "job"   },
        { topPct: 71, heightPct: 26, label: "Unbooked",           kind: "dead"  },
      ]},
      { label: "FRI", events: [
        { topPct: 4,  heightPct: 26, label: "Unbooked",           kind: "dead"  },
        { topPct: 31, heightPct: 22, label: "Follow-up — SJ",     kind: "job"   },
        { topPct: 54, heightPct: 13, label: "40 min drive",        kind: "drive" },
        { topPct: 68, heightPct: 22, label: "Quote — Oakland",    kind: "job"   },
      ]},
    ],
    after: [
      { label: "MON", events: [
        { topPct: 4,  heightPct: 30, label: "Zone A — HVAC #1", sub: "San Jose",   kind: "job" },
        { topPct: 35, heightPct: 30, label: "Zone A — HVAC #2", sub: "Campbell",   kind: "job" },
        { topPct: 66, heightPct: 30, label: "Zone A — Quote",   sub: "Milpitas",   kind: "job" },
      ]},
      { label: "TUE", events: [
        { topPct: 4,  heightPct: 30, label: "Zone B — Plumb.",  sub: "Oakland",    kind: "job" },
        { topPct: 35, heightPct: 30, label: "Zone B — Insp.",   sub: "Fremont",    kind: "job" },
        { topPct: 66, heightPct: 30, label: "Zone B — Repair",  sub: "Hayward",    kind: "job" },
      ]},
      { label: "WED", events: [
        { topPct: 4,  heightPct: 30, label: "Zone C — HVAC",    sub: "SF",         kind: "job" },
        { topPct: 35, heightPct: 30, label: "Zone C — Service", sub: "Daly City",  kind: "job" },
        { topPct: 66, heightPct: 30, label: "Zone C — Close",   sub: "Pacifica",   kind: "job" },
      ]},
      { label: "THU", events: [
        { topPct: 4,  heightPct: 45, label: "Zone D — Full Day",sub: "San Ramon",  kind: "job" },
        { topPct: 51, heightPct: 45, label: "Zone D — Install", sub: "Walnut Ck.", kind: "job" },
      ]},
      { label: "FRI", events: [
        { topPct: 4,  heightPct: 45, label: "Zone A — Batch",   sub: "San Jose",   kind: "job" },
        { topPct: 51, heightPct: 30, label: "Zone A — Wrap",    sub: "Milpitas",   kind: "job" },
      ]},
    ],
  },

  realestate: {
    id: "realestate",
    label: "Real Estate & Solar",
    scenario: "Cold Lead Reactivated — 31-Day Nurture Sequence",
    narration: [
      "Lead comes in warm — but not ready to commit. Most agents give up here.",
      "Engine responds naturally. Nurture sequence quietly activates.",
      "Lead goes cold. Engine doesn't panic — 31-day follow-up is already set.",
      "No pressure. Relationship maintained. Zero effort from the agent.",
      "31 days later — Engine fires the re-engagement trigger automatically.",
      "Cold lead just reactivated. The Engine kept the door open.",
      "Showing booked. A lead that would've been lost is now a commission.",
    ],
    sms: [
      { from: "lead",   text: "Interested in the Maple Ave listing" },
      { from: "engine", text: "Great! Happy to help. Are you looking to buy or just exploring?" },
      { from: "lead",   text: "Maybe next month... not sure yet" },
      { from: "engine", text: "No pressure at all. I'll keep you posted on Maple Ave." },
      { from: "engine", text: "[31 days later] Ready for Maple Ave? 3 buyers toured it this week." },
      { from: "lead",   text: "Actually yes — can we schedule a showing?" },
      { from: "engine", text: "✓ Showing booked — Saturday 11AM. Sarah will meet you there." },
    ],
    log: [
      { text: "> INBOUND LEAD — web form — 2:14 PM",           type: "neutral" },
      { text: "> INTENT: PROPERTY_INQUIRY — 91.2% CONFIDENCE", type: "process" },
      { text: "> SENTIMENT: BROWSING — NOT READY TO COMMIT",   type: "alert"   },
      { text: "> STRATEGY: LONG_TAIL_NURTURE — ACTIVATED",     type: "alert"   },
      { text: "> SEQUENCE: 6-TOUCH OVER 90 DAYS",              type: "neutral" },
      { text: "> DAY 1: INTRO SMS SENT",                       type: "success" },
      { text: "> DAY 7: MARKET UPDATE EMAIL SENT",             type: "success" },
      { text: "> DAY 31: RE-ENGAGEMENT TRIGGER FIRED",         type: "alert"   },
      { text: "> LEAD RESPONDED — INTENT UPGRADED: HIGH",      type: "success" },
      { text: "> SHOWING SLOT BOOKED — SATURDAY 11AM",         type: "success" },
      { text: "> AGENT SARAH NOTIFIED",                        type: "success" },
      { text: "> ✓ COLD LEAD → APPOINTMENT IN 31 DAYS",       type: "success" },
    ],
    beforeStats: [
      { num: "8",       label: "Showings / Month" },
      { num: "1 TOUCH", label: "Avg. Follow-Ups" },
      { num: "12%",     label: "Cold Lead Convert" },
      { num: "$14,000", label: "Monthly GCI" },
    ],
    afterStats: [
      { num: "31",      label: "Showings / Month" },
      { num: "6 TOUCH", label: "Avg. Follow-Ups" },
      { num: "61%",     label: "Cold Lead Convert" },
      { num: "$54,000", label: "Monthly GCI" },
    ],
    before: [
      { label: "MON", events: [
        { topPct: 4,  heightPct: 25, label: "Showing — Elm St",  kind: "job"  },
        { topPct: 30, heightPct: 67, label: "No follow-ups",      kind: "dead" },
      ]},
      { label: "TUE", events: [
        { topPct: 4,  heightPct: 93, label: "No appointments",   kind: "dead" },
      ]},
      { label: "WED", events: [
        { topPct: 4,  heightPct: 25, label: "Open House",         kind: "job"  },
        { topPct: 30, heightPct: 22, label: "Cold leads rotting", kind: "dead" },
        { topPct: 53, heightPct: 44, label: "Unbooked",           kind: "dead" },
      ]},
      { label: "THU", events: [
        { topPct: 4,  heightPct: 93, label: "No appointments",   kind: "dead" },
      ]},
      { label: "FRI", events: [
        { topPct: 4,  heightPct: 25, label: "Showing — Oak Ave", kind: "job"  },
        { topPct: 30, heightPct: 67, label: "Unbooked",           kind: "dead" },
      ]},
    ],
    after: [
      { label: "MON", events: [
        { topPct: 4,  heightPct: 28, label: "Showing #1",   sub: "Maple Ave",   kind: "job" },
        { topPct: 33, heightPct: 28, label: "Showing #2",   sub: "Elm St",      kind: "job" },
        { topPct: 62, heightPct: 28, label: "Consult",      sub: "New buyer",   kind: "job" },
      ]},
      { label: "TUE", events: [
        { topPct: 4,  heightPct: 28, label: "Showing #3",   sub: "Oak Ave",     kind: "job" },
        { topPct: 33, heightPct: 28, label: "Offer Review", sub: "Pine Rd",     kind: "job" },
        { topPct: 62, heightPct: 28, label: "Showing #4",   sub: "Reactivated", kind: "job" },
      ]},
      { label: "WED", events: [
        { topPct: 4,  heightPct: 45, label: "Open House",   sub: "Maple Ave",   kind: "job" },
        { topPct: 51, heightPct: 45, label: "Showing #5",   sub: "Walnut Ln",   kind: "job" },
      ]},
      { label: "THU", events: [
        { topPct: 4,  heightPct: 28, label: "Consult",      sub: "Nurture win", kind: "job" },
        { topPct: 33, heightPct: 28, label: "Showing #6",   sub: "Cedar St",    kind: "job" },
        { topPct: 62, heightPct: 28, label: "Showing #7",   sub: "Birch Ave",   kind: "job" },
      ]},
      { label: "FRI", events: [
        { topPct: 4,  heightPct: 45, label: "Closing",      sub: "Maple Ave",   kind: "job" },
        { topPct: 51, heightPct: 28, label: "New inquiry",  sub: "Auto-booked", kind: "job" },
      ]},
    ],
  },

  landscaping: {
    id: "landscaping",
    label: "Landscaping & Cleaning",
    scenario: "Route Optimization — New Booking Clustered to Existing Thursday Crew",
    narration: [
      "New lead looking for lawn care. Engine reads the request instantly.",
      "Asks for the address — route-matching is already running in the background.",
      "Address received. Checking against every active crew route.",
      "Match found on the existing Thursday route. Zero extra miles.",
      "Perfect fit. Engine slots them in without disrupting anything.",
      "Booked and invoiced. $480/month added. Zero added overhead.",
      "Pure margin — one new client, no extra driving, no dispatcher needed.",
    ],
    sms: [
      { from: "lead",   text: "Need weekly lawn care — 3BR house in Sunnyvale" },
      { from: "engine", text: "Got it! What's your address so I can check crew availability?" },
      { from: "lead",   text: "742 Evergreen Terrace, Sunnyvale" },
      { from: "engine", text: "Your address is on our existing Thursday route — zero extra drive time." },
      { from: "lead",   text: "That's perfect!" },
      { from: "engine", text: "✓ Added to Thursday crew. First visit next week. $120/visit." },
      { from: "engine", text: "Route efficiency: +1 job, +0 miles. Marginal cost: $0." },
    ],
    log: [
      { text: "> INBOUND SMS — (669) 555-0344 — 3:22 PM",   type: "neutral" },
      { text: "> INTENT: SERVICE_REQUEST — LAWN — 96.1%",   type: "process" },
      { text: "> ADDRESS PARSED: 742 EVERGREEN, SUNNYVALE", type: "neutral" },
      { text: "> SCANNING ACTIVE ROUTES...",                 type: "process" },
      { text: "> MATCH: THURSDAY ROUTE — 0.4MI DEVIATION",  type: "success" },
      { text: "> ROUTE DENSITY: OPTIMAL — SLOT AVAILABLE",  type: "success" },
      { text: "> PRICE CALCULATED: $120 / VISIT",           type: "neutral" },
      { text: "> BOOKING CONFIRMED — THURSDAY CREW",        type: "success" },
      { text: "> CUSTOMER NOTIFIED + INVOICE SENT",         type: "success" },
      { text: "> ROUTE EFFICIENCY DELTA: +8.3%",            type: "success" },
      { text: "> ADDED REVENUE: $480/MO — $0 ADDED COST",  type: "success" },
      { text: "> ✓ ZERO HUMAN INTERVENTIONS REQUIRED",     type: "success" },
    ],
    beforeStats: [
      { num: "18",      label: "Jobs / Week" },
      { num: "3.8 HRS", label: "Drive Time / Day" },
      { num: "42%",     label: "Route Efficiency" },
      { num: "$6,800",  label: "Weekly Revenue" },
    ],
    afterStats: [
      { num: "28",      label: "Jobs / Week" },
      { num: "0.9 HRS", label: "Drive Time / Day" },
      { num: "91%",     label: "Route Efficiency" },
      { num: "$11,200", label: "Weekly Revenue" },
    ],
    before: [
      { label: "MON", events: [
        { topPct: 4,  heightPct: 18, label: "Lawn — Palo Alto", kind: "job"   },
        { topPct: 23, heightPct: 14, label: "55 min drive",      kind: "drive" },
        { topPct: 38, heightPct: 18, label: "Clean — Oakland",   kind: "job"   },
        { topPct: 57, heightPct: 14, label: "45 min drive",      kind: "drive" },
        { topPct: 72, heightPct: 18, label: "Lawn — Fremont",    kind: "job"   },
      ]},
      { label: "TUE", events: [
        { topPct: 4,  heightPct: 93, label: "No jobs scheduled", kind: "dead"  },
      ]},
      { label: "WED", events: [
        { topPct: 4,  heightPct: 22, label: "Clean — SF",        kind: "job"   },
        { topPct: 27, heightPct: 18, label: "1h 20m drive",       kind: "drive" },
        { topPct: 46, heightPct: 50, label: "Unbooked",           kind: "dead"  },
      ]},
      { label: "THU", events: [
        { topPct: 4,  heightPct: 22, label: "Lawn — Sunnyvale",  kind: "job"   },
        { topPct: 27, heightPct: 14, label: "40 min drive",       kind: "drive" },
        { topPct: 42, heightPct: 22, label: "Lawn — San Jose",    kind: "job"   },
        { topPct: 65, heightPct: 32, label: "Unbooked",           kind: "dead"  },
      ]},
      { label: "FRI", events: [
        { topPct: 4,  heightPct: 93, label: "No jobs scheduled", kind: "dead"  },
      ]},
    ],
    after: [
      { label: "MON", events: [
        { topPct: 4,  heightPct: 28, label: "Zone A — Lawn #1", sub: "Sunnyvale",   kind: "job" },
        { topPct: 33, heightPct: 28, label: "Zone A — Lawn #2", sub: "Santa Clara", kind: "job" },
        { topPct: 62, heightPct: 28, label: "Zone A — Clean",   sub: "Cupertino",   kind: "job" },
      ]},
      { label: "TUE", events: [
        { topPct: 4,  heightPct: 28, label: "Zone B — Lawn",    sub: "San Jose N",  kind: "job" },
        { topPct: 33, heightPct: 28, label: "Zone B — Lawn",    sub: "San Jose S",  kind: "job" },
        { topPct: 62, heightPct: 28, label: "Zone B — Clean",   sub: "Campbell",    kind: "job" },
      ]},
      { label: "WED", events: [
        { topPct: 4,  heightPct: 45, label: "Zone C — Batch",   sub: "Palo Alto",   kind: "job" },
        { topPct: 51, heightPct: 45, label: "Zone C — Lawns",   sub: "Menlo Park",  kind: "job" },
      ]},
      { label: "THU", events: [
        { topPct: 4,  heightPct: 28, label: "Zone D — Lawn",    sub: "Fremont",     kind: "job" },
        { topPct: 33, heightPct: 28, label: "Zone D — Lawn",    sub: "Union City",  kind: "job" },
        { topPct: 62, heightPct: 28, label: "Zone D — Clean",   sub: "Newark",      kind: "job" },
      ]},
      { label: "FRI", events: [
        { topPct: 4,  heightPct: 45, label: "Zone A — Wrap",    sub: "Sunnyvale",   kind: "job" },
        { topPct: 51, heightPct: 28, label: "Zone A — New",     sub: "Auto-booked", kind: "job" },
      ]},
    ],
  },

  contractor: {
    id: "contractor",
    label: "General Contractors",
    scenario: "Change Order Signed — 17 Minutes, Start to Finish",
    narration: [
      "Client mentions a change over text. Engine detects it instantly.",
      "Change order drafted, priced, and sent for signature in 28 seconds.",
      "Client reviews it. E-signature request sent automatically.",
      "Signed and timestamped. Project total updates in real time.",
      "Invoice regenerated. Full audit trail logged. All automatic.",
      "Client is happy. All of this happened while you were on-site.",
      "Every document filed. Nothing fell through the cracks. No chasing.",
    ],
    sms: [
      { from: "lead",   text: "We want to add a deck out back, roughly 200 sq ft" },
      { from: "engine", text: "Got it. Drafting Change Order CO-003 — Deck Extension, 200 sq ft, +$4,800. Sending for signature now." },
      { from: "lead",   text: "Looks good to us" },
      { from: "engine", text: "✓ CO-003 signed by Marcus Lopez — 2:31 PM. Project total updated: $87,200." },
      { from: "engine", text: "Invoice #INV-2026-014 updated and resent. Audit trail logged." },
      { from: "lead",   text: "That was fast, thanks" },
      { from: "engine", text: "All docs stored. Lien waiver will be sent at project close." },
    ],
    log: [
      { text: "> CLIENT MSG RECEIVED — 2:14 PM",                type: "neutral" },
      { text: "> INTENT: CHANGE_ORDER_REQUEST — 97.1%",         type: "process" },
      { text: '> KEYWORDS: ["deck", "add", "200 sq ft"]',       type: "neutral" },
      { text: "> PRICING ENGINE: COMPOSITE DECK — $24/SQFT",    type: "process" },
      { text: "> CHANGE ORDER CO-003 DRAFTED — +$4,800",        type: "success" },
      { text: "> SENT TO CLIENT VIA SMS + EMAIL — 2:14 PM",     type: "success" },
      { text: "> CLIENT OPENED DOCUMENT — 2:28 PM",             type: "neutral" },
      { text: "> E-SIGNATURE RECEIVED — MARCUS LOPEZ",          type: "success" },
      { text: "> PROJECT TOTAL UPDATED: $82,400 → $87,200",     type: "success" },
      { text: "> INVOICE #INV-2026-014 REGENERATED + SENT",     type: "success" },
      { text: "> AUDIT TRAIL ENTRY CREATED — CO-003",           type: "success" },
      { text: "> ✓ ZERO PAPER. ZERO CHASING. 17 MINUTES.",     type: "success" },
    ],
    dashboard: {
      project: {
        name: "Riverside Kitchen & Addition",
        client: "Marcus & Diana Lopez",
        originalContract: "$82,400",
        currentTotal: "$87,200",
        timeline: "Mar 15 – Jun 30, 2026",
        status: "IN PROGRESS",
        completion: 67,
      },
      changeOrder: {
        id: "CO-003",
        description: "Client-requested rear deck extension — 200 sq ft composite decking, pressure-treated frame, stainless hardware",
        costAdded: "+$4,800",
        previousTotal: "$82,400",
        newTotal: "$87,200",
        status: "approved",
        timestamp: "Apr 8, 2026 — 2:31 PM",
      },
      signature: {
        name: "Marcus Lopez",
        date: "Apr 8, 2026",
        time: "2:31 PM",
        ip: "192.168.1.44",
      },
      photos: [
        { label: "Foundation footing — concrete pour Day 1",   tag: "PHASE 1" },
        { label: "Framing complete — rear addition structure",  tag: "PHASE 2" },
        { label: "Electrical rough-in — kitchen panel",        tag: "PHASE 3" },
        { label: "Original kitchen layout — before demo",      tag: "BEFORE"  },
        { label: "Drywall installed — ready for finish",       tag: "PHASE 4" },
      ],
      documents: [
        { name: "Original Contract",   status: "signed",  icon: "ph-file-text"    },
        { name: "Change Order #001",   status: "signed",  icon: "ph-file-plus"    },
        { name: "Change Order #002",   status: "signed",  icon: "ph-file-plus"    },
        { name: "Change Order #003",   status: "signed",  icon: "ph-file-plus"    },
        { name: "Invoice #INV-2026-014", status: "sent",  icon: "ph-receipt"      },
        { name: "Lien Waiver",         status: "pending", icon: "ph-seal"         },
        { name: "Preliminary Notice",  status: "filed",   icon: "ph-stamp"        },
      ],
      activityLog: [
        { time: "2:14 PM", action: "Change order CO-003 created by Engine",          type: "neutral" },
        { time: "2:14 PM", action: "CO-003 sent to client via SMS + email",          type: "success" },
        { time: "2:28 PM", action: "Client opened document",                         type: "neutral" },
        { time: "2:31 PM", action: "Client signed — Marcus Lopez (IP 192.168.1.44)", type: "success" },
        { time: "2:31 PM", action: "Project total updated: $82,400 → $87,200",       type: "success" },
        { time: "2:32 PM", action: "Invoice #INV-2026-014 regenerated and resent",   type: "success" },
        { time: "2:32 PM", action: "Audit trail entry logged — CO-003 approved",     type: "success" },
      ],
      audit: [
        { item: "Composite decking — 240 sq ft material", amount: "$1,840", linked: "CO-003", vendor: "Home Depot #4471 — Apr 8" },
        { item: "Pressure-treated frame lumber",           amount: "$620",   linked: "CO-003", vendor: "Ryder Lumber — Apr 9"    },
        { item: "Stainless fasteners + hardware kit",      amount: "$210",   linked: "CO-003", vendor: "Ace Hardware — Apr 9"    },
      ],
    },
  },

};

const DEFAULT_PRESET = PRESETS.hvac;

/* ══════════════════════════════════════════════════════════ */

interface Props { preset?: string; }

export default function SimulationLab({ preset }: Props) {
  const data = PRESETS[preset ?? ""] ?? DEFAULT_PRESET;

  const [smsPhase, setSmsPhase]     = useState<"idle" | "playing" | "done">("idle");
  const [visibleSms, setVisibleSms] = useState(0);
  const [smsTyping, setSmsTyping]   = useState(false);
  const smsTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [logPhase, setLogPhase]         = useState<"idle" | "playing" | "done">("idle");
  const [visibleLines, setVisibleLines] = useState(0);
  const logTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [calView, setCalView] = useState<"before" | "after">("before");

  /* narrator caption — tracks current SMS message */
  const narrator = data.narration[Math.max(0, visibleSms - 1)] ?? "";
  const calDays  = calView === "before" ? (data.before ?? [])       : (data.after ?? []);
  const calStats = calView === "before" ? (data.beforeStats ?? [])  : (data.afterStats ?? []);

  const runSMS = () => {
    if (smsPhase === "playing") return;
    smsTimers.current.forEach(clearTimeout);
    smsTimers.current = [];
    setVisibleSms(0);
    setSmsTyping(false);
    setSmsPhase("playing");
    const SMS = data.sms;
    const s = (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); smsTimers.current.push(t); };
    let cursor = 0;
    SMS.forEach((msg, i) => {
      const readDelay   = i === 0 ? 500 : 800;
      const typingDelay = msg.from === "engine" ? 1400 : 0;
      s(() => { if (msg.from === "engine") setSmsTyping(true); }, cursor + readDelay);
      s(() => {
        setSmsTyping(false);
        setVisibleSms(i + 1);
        if (i === SMS.length - 1) setSmsPhase("done");
      }, cursor + readDelay + typingDelay);
      cursor += readDelay + typingDelay + 200;
    });
  };

  const runLog = () => {
    if (logPhase === "playing") return;
    logTimers.current.forEach(clearTimeout);
    logTimers.current = [];
    setVisibleLines(0);
    setLogPhase("playing");
    data.log.forEach((_, i) => {
      const t = setTimeout(() => {
        setVisibleLines(i + 1);
        if (i === data.log.length - 1) setLogPhase("done");
      }, 300 + i * 260);
      logTimers.current.push(t);
    });
  };

  /* Auto-play on mount */
  useEffect(() => {
    const t = setTimeout(() => runSMS(), 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Chain: SMS done → start log */
  useEffect(() => {
    if (smsPhase !== "done") return;
    const t = setTimeout(() => runLog(), 900);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smsPhase]);

  /* Chain: log done → flip calendar to "after" */
  useEffect(() => {
    if (logPhase !== "done" || data.dashboard) return;
    const t = setTimeout(() => setCalView("after"), 1400);
    return () => clearTimeout(t);
  }, [logPhase, data.dashboard]);

  return (
    <section className="ae-sim" id="ae-sim-lab">

      {/* Broadcast header */}
      <div className="ae-sim__broadcast">
        <div className="mxd-container">
          <div className="ae-sim__broadcast-inner">
            <div className="ae-sim__broadcast-left">
              <span className="ae-sim__broadcast-dot" />
              <span className="ae-sim__broadcast-tag">SIMULATION LAB</span>
            </div>
            <div className="ae-sim__broadcast-center">
              <h2 className="ae-sim__title">
                See the Engine <span className="ae-sim__title-accent">Think.</span>
              </h2>
              <p className="ae-sim__sub">{data.label} — {data.scenario}</p>
            </div>
            <div className="ae-sim__broadcast-right">
              <div className="ae-sim__preset-tabs">
                {Object.values(PRESETS).map((p) => (
                  <Link
                    key={p.id}
                    href={`/ascend-engine/simulation?preset=${p.id}`}
                    className={`ae-sim__preset-tab${data.id === p.id ? " ae-sim__preset-tab--active" : ""}`}
                  >
                    {p.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mxd-container">
        <div className="mxd-block">

          {/* Row 1: SMS + Terminal */}
          <div className="ae-sim__row">

            {/* 01 SMS */}
            <div className="ae-sim__card">
              <div className="ae-sim__card-header">
                <span className="ae-sim__card-num">01</span>
                <div className="ae-sim__card-meta">
                  <p className="ae-sim__card-title">Watch the Engine respond to a real lead</p>
                  <p className="ae-sim__card-sub">{data.scenario}</p>
                </div>
              </div>
              <div className="ae-sim__phone">
                <div className="ae-sim__phone-chrome"><span className="ae-sim__phone-notch" /></div>
                <div className="ae-sim__phone-screen">
                  <div className="ae-sim__sms-header">
                    <span className="ae-sim__sms-avatar"><i className="ph-bold ph-robot" /></span>
                    <div>
                      <p className="ae-sim__sms-name">Ascend Engine</p>
                      <p className="ae-sim__sms-status"><span className="ae-sim__sms-dot" />online</p>
                    </div>
                  </div>
                  <div className="ae-sim__sms-feed">
                    {data.sms.slice(0, visibleSms).map((msg, i) => (
                      <div key={i} className={`ae-sim__bubble ae-sim__bubble--${msg.from}`}>{msg.text}</div>
                    ))}
                    {smsTyping && (
                      <div className="ae-sim__bubble ae-sim__bubble--typing">
                        <span className="ae-sim__typing-dot" />
                        <span className="ae-sim__typing-dot" />
                        <span className="ae-sim__typing-dot" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Narrator — plain-English caption */}
              {visibleSms > 0 && (
                <p className="ae-sim__narrator" key={narrator}>{narrator}</p>
              )}

              {smsPhase === "done" && (
                <button type="button" className="ae-sim__replay-btn" onClick={runSMS}>
                  <i className="ph-bold ph-arrow-counter-clockwise" /> Replay
                </button>
              )}
            </div>

            {/* 02 Terminal */}
            <div className="ae-sim__card">
              <div className="ae-sim__card-header">
                <span className="ae-sim__card-num">02</span>
                <div className="ae-sim__card-meta">
                  <p className="ae-sim__card-title">This is what the Engine is thinking — right now</p>
                  <p className="ae-sim__card-sub">Every decision logged in real time. No black box.</p>
                </div>
              </div>
              <div className="ae-sim__terminal">
                <div className="ae-sim__terminal-chrome">
                  <span className="ae-sim__tc-dot ae-sim__tc-dot--r" />
                  <span className="ae-sim__tc-dot ae-sim__tc-dot--y" />
                  <span className="ae-sim__tc-dot ae-sim__tc-dot--g" />
                  <span className="ae-sim__tc-label">engine_process.log</span>
                </div>
                <div className="ae-sim__terminal-body">
                  {logPhase === "idle" && (
                    <p className="ae-sim__terminal-idle"><span className="ae-sim__cursor">_</span> awaiting signal...</p>
                  )}
                  {data.log.slice(0, visibleLines).map((line, i) => (
                    <p key={i} className={`ae-sim__log-line ae-sim__log-line--${line.type}`}>{line.text}</p>
                  ))}
                  {logPhase === "playing" && visibleLines < data.log.length && <span className="ae-sim__cursor">_</span>}
                </div>
              </div>
              {logPhase === "done" && (
                <button type="button" className="ae-sim__replay-btn" onClick={runLog}>
                  <i className="ph-bold ph-arrow-counter-clockwise" /> Replay
                </button>
              )}
            </div>

          </div>

          {/* Row 2: Dashboard (contractor) OR Calendar (others) */}
          {data.dashboard ? (
            <ContractorDashboard db={data.dashboard} />
          ) : (
            <div className="ae-sim__card ae-sim__card--full">
              <div className="ae-sim__card-header ae-sim__card-header--space">
                <div className="ae-sim__card-header-left">
                  <span className="ae-sim__card-num">03</span>
                  <div className="ae-sim__card-meta">
                    <p className="ae-sim__card-title">Now look at what changes on your calendar</p>
                    <p className="ae-sim__card-sub">Same week. Same contractor. Engine running vs. not running.</p>
                  </div>
                </div>
                <div className="ae-sim__cal-toggle">
                  <button
                    type="button"
                    className={`ae-sim__cal-tab${calView === "before" ? " ae-sim__cal-tab--active ae-sim__cal-tab--before" : ""}`}
                    onClick={() => setCalView("before")}
                  >
                    <i className="ph-bold ph-warning" /> BEFORE
                  </button>
                  <button
                    type="button"
                    className={`ae-sim__cal-tab${calView === "after" ? " ae-sim__cal-tab--active ae-sim__cal-tab--after" : ""}`}
                    onClick={() => setCalView("after")}
                  >
                    <i className="ph-bold ph-lightning" /> AFTER
                  </button>
                </div>
              </div>
              <div className={`ae-sim__stats-bar ae-sim__stats-bar--${calView}`}>
                {calStats.map((s, i) => (
                  <div key={i} className="ae-sim__stat-item">
                    <span className={`ae-sim__stat-num ae-sim__stat-num--${calView}`}>{s.num}</span>
                    <span className="ae-sim__stat-label">{s.label}</span>
                  </div>
                ))}
              </div>
              <div className={`ae-sim__cal-grid ae-sim__cal-grid--${calView}`}>
                {calDays.map((day) => (
                  <div key={day.label} className="ae-sim__cal-col">
                    <div className="ae-sim__cal-day-label">{day.label}</div>
                    <div className="ae-sim__cal-day-body">
                      {day.events.map((ev, i) => (
                        <div
                          key={i}
                          className={`ae-sim__cal-event ae-sim__cal-event--${ev.kind}`}
                          style={{ top: `${ev.topPct}%`, height: `${ev.heightPct}%` }}
                        >
                          <span className="ae-sim__cal-event-label">{ev.label}</span>
                          {ev.sub && <span className="ae-sim__cal-event-sub">{ev.sub}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Back / deploy row */}
          <div className="ae-sim__back-row">
            <Link href="/ascend-engine" className="ae-sim__back-link">
              <i className="ph-bold ph-arrow-left" />
              Back to Ascend Engine
            </Link>
            <Link href="/ascend-engine#ae-presets" className="ae-sim__deploy-link">
              Ready to deploy?
              <i className="ph-bold ph-arrow-up-right" />
            </Link>
          </div>

        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════
   CONTRACTOR DASHBOARD WIDGET
   ══════════════════════════════════════════════════════════ */
const DOC_STATUS_LABELS: Record<string, string> = {
  signed: "SIGNED", sent: "SENT", pending: "PENDING", filed: "FILED",
};

function ContractorDashboard({ db }: { db: DashboardData }) {
  return (
    <div className="ae-sim__card ae-sim__card--full ae-dash">

      {/* Card header */}
      <div className="ae-sim__card-header">
        <span className="ae-sim__card-num">03</span>
        <div className="ae-sim__card-meta">
          <p className="ae-sim__card-title">Live Project Dashboard — Change Order Flow</p>
          <p className="ae-sim__card-sub">From client request to signed change order, updated invoice, and audit trail — fully automated.</p>
        </div>
      </div>

      {/* Row A: Project Overview + Change Order */}
      <div className="ae-dash__row">

        {/* Project Overview */}
        <div className="ae-dash__panel">
          <p className="ae-dash__panel-label">
            <i className="ph-bold ph-buildings" /> PROJECT OVERVIEW
          </p>
          <p className="ae-dash__project-name">{db.project.name}</p>
          <p className="ae-dash__project-client">{db.project.client}</p>

          <div className="ae-dash__kv-list">
            <div className="ae-dash__kv">
              <span className="ae-dash__kv-key">Original Contract</span>
              <span className="ae-dash__kv-val">{db.project.originalContract}</span>
            </div>
            <div className="ae-dash__kv ae-dash__kv--highlight">
              <span className="ae-dash__kv-key">Current Total</span>
              <span className="ae-dash__kv-val ae-dash__kv-val--green">{db.project.currentTotal}</span>
            </div>
            <div className="ae-dash__kv">
              <span className="ae-dash__kv-key">Timeline</span>
              <span className="ae-dash__kv-val">{db.project.timeline}</span>
            </div>
            <div className="ae-dash__kv">
              <span className="ae-dash__kv-key">Status</span>
              <span className="ae-dash__status-badge">{db.project.status}</span>
            </div>
          </div>

          <div className="ae-dash__progress-wrap">
            <div className="ae-dash__progress-header">
              <span className="ae-dash__progress-label">Completion</span>
              <span className="ae-dash__progress-pct">{db.project.completion}%</span>
            </div>
            <div className="ae-dash__progress-track">
              <div className="ae-dash__progress-fill" style={{ width: `${db.project.completion}%` }} />
            </div>
          </div>
        </div>

        {/* Change Order */}
        <div className="ae-dash__panel ae-dash__panel--co">
          <div className="ae-dash__panel-label-row">
            <p className="ae-dash__panel-label">
              <i className="ph-bold ph-file-plus" /> CHANGE ORDER
            </p>
            <span className={`ae-dash__co-badge ae-dash__co-badge--${db.changeOrder.status}`}>
              {db.changeOrder.status === "approved" ? "✓ APPROVED" : "PENDING"}
            </span>
          </div>
          <p className="ae-dash__co-id">{db.changeOrder.id}</p>
          <p className="ae-dash__co-desc">{db.changeOrder.description}</p>

          <div className="ae-dash__co-totals">
            <div className="ae-dash__co-total-row">
              <span>Previous Total</span>
              <span className="ae-dash__co-prev">{db.changeOrder.previousTotal}</span>
            </div>
            <div className="ae-dash__co-total-row ae-dash__co-total-row--added">
              <span>Cost Added</span>
              <span className="ae-dash__co-added">{db.changeOrder.costAdded}</span>
            </div>
            <div className="ae-dash__co-divider" />
            <div className="ae-dash__co-total-row ae-dash__co-total-row--new">
              <span>New Total</span>
              <span className="ae-dash__co-new">{db.changeOrder.newTotal}</span>
            </div>
          </div>

          {/* Signature block */}
          <div className="ae-dash__sig">
            <div className="ae-dash__sig-header">
              <i className="ph-bold ph-pen-nib" />
              <span>CLIENT SIGNATURE</span>
            </div>
            <div className="ae-dash__sig-name">{db.signature.name}</div>
            <div className="ae-dash__sig-meta">
              {db.signature.date} · {db.signature.time} · IP {db.signature.ip}
            </div>
          </div>
          <p className="ae-dash__co-ts">{db.changeOrder.timestamp}</p>
        </div>

      </div>

      {/* Row B: Activity Log + Documents */}
      <div className="ae-dash__row">

        {/* Activity Log */}
        <div className="ae-dash__panel">
          <p className="ae-dash__panel-label">
            <i className="ph-bold ph-activity" /> ACTIVITY LOG
          </p>
          <div className="ae-dash__log">
            {db.activityLog.map((entry, i) => (
              <div key={i} className="ae-dash__log-entry" style={{ animationDelay: `${i * 0.08}s` }}>
                <span className="ae-dash__log-time">{entry.time}</span>
                <span className={`ae-dash__log-dot ae-dash__log-dot--${entry.type}`} />
                <span className="ae-dash__log-action">{entry.action}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Documents */}
        <div className="ae-dash__panel">
          <p className="ae-dash__panel-label">
            <i className="ph-bold ph-folder-open" /> DOCUMENTS
          </p>
          <div className="ae-dash__docs">
            {db.documents.map((doc, i) => (
              <div key={i} className="ae-dash__doc-row">
                <i className={`ph-bold ${doc.icon} ae-dash__doc-icon`} />
                <span className="ae-dash__doc-name">{doc.name}</span>
                <span className={`ae-dash__doc-status ae-dash__doc-status--${doc.status}`}>
                  {DOC_STATUS_LABELS[doc.status]}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Row C: Audit Trail + Photo Docs */}
      <div className="ae-dash__row ae-dash__row--audit">

        {/* Audit Trail */}
        <div className="ae-dash__panel ae-dash__panel--wide">
          <p className="ae-dash__panel-label">
            <i className="ph-bold ph-receipt" /> FINANCIAL AUDIT TRAIL — {db.changeOrder.id}
          </p>
          <div className="ae-dash__audit-table">
            <div className="ae-dash__audit-head">
              <span>Item</span><span>Amount</span><span>Linked To</span><span>Vendor / Receipt</span>
            </div>
            {db.audit.map((row, i) => (
              <div key={i} className="ae-dash__audit-row">
                <span>{row.item}</span>
                <span className="ae-dash__audit-amount">{row.amount}</span>
                <span className="ae-dash__audit-linked">{row.linked}</span>
                <span className="ae-dash__audit-vendor">{row.vendor}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Photo Docs */}
        <div className="ae-dash__panel">
          <p className="ae-dash__panel-label">
            <i className="ph-bold ph-camera" /> PHOTO DOCUMENTATION
          </p>
          <div className="ae-dash__photos">
            {db.photos.map((photo, i) => (
              <div key={i} className="ae-dash__photo-row">
                <span className="ae-dash__photo-tag">{photo.tag}</span>
                <span className="ae-dash__photo-label">{photo.label}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
