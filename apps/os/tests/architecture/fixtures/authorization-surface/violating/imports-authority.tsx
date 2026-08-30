// FIXTURE · deliberately violates F54. Not imported by anything.
//
// Proves the pin: `@/core/auth/authority` is importable by the denial handler and by nothing else.
// A second importer must FAIL rather than be added to a list.
import { CapabilityDenied } from "@/core/auth/authority";

export function isDenial(e: unknown): boolean {
  return e instanceof CapabilityDenied;
}
