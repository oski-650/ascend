// onboarding — retroactive entity onboarding (docs/RETROACTIVE-ONBOARDING.md).
//
// NOT WIRED TO ANY SURFACE. A one-shot tool, run deliberately against a snapshot, reviewed, then
// against the live vault as a separate decision — the same posture as `migration/`.
//
//   plan → [HUMAN REVIEW] → apply → verify
//   ──────                  ─────────────────
//   reads only              requires { confirm: true }
//
// It records that an entity EXISTS. It never records that business activity happened, and every
// event it causes carries `actor: "system"` so §19's adoption measurement stays clean.

export { planOnboarding, renderOnboardingManifest, type OnboardingManifest, type OnboardingEntry } from "./plan";
export { applyOnboarding, verifyOnboarding, type OnboardingReport } from "./apply";
export { ONBOARDING_SUBJECTS, subjectFor, type OnboardingSubject, type OnboardingFact } from "./subjects";
