// lib/paths.ts — MOVED to core/vault/paths (Phase 1 foundation).
// This re-export keeps every existing `@/lib/paths` import working during the
// strangler migration. New code should import from "@/core/vault/paths".

export * from "@/core/vault/paths";
