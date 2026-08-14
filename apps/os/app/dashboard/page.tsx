// app/dashboard — RETIRED.
//
// The 647-line, 12-stacked-panel HUD was replaced by the Neural Core at `/`. The route is kept as a
// permanent redirect so existing links and bookmarks keep working.
//
// Retiring it also removed the recorded F14 violation: this file value-imported `rank` from
// @/engines/decision-engine and called it directly, bypassing mission-control.assemblePriorityFeed.
// The Neural Core goes through Mission Control, so the exemption in tests/architecture/fitness.test.ts
// was deleted rather than carried forward.

import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/");
}