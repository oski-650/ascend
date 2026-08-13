// lib/timeLog.ts — MOVED to core/production/time (Phase 2.3). Re-export shim.
// New code: import from "@/core/production".

export {
  getAllEntries,
  getActiveEntry,
  startEntry,
  logEntry,
  stopEntry,
  stopActive,
  summarizeByClient,
  summaryFor,
  secondsInWindow,
  dailyActivityWindow,
  currentStreak,
  formatDuration,
  APP_DATA_DIRNAME,
} from "@/core/production";
export type { TimeEntry, ClientSummary } from "@/core/production";
