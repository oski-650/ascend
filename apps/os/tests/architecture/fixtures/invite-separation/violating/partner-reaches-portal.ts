// FIXTURE · deliberately violates F58. Not imported by anything.
//
// A partner-invitation surface reaching the CLIENT PORTAL token mechanism — the realistic accident
// §28.8 names: somebody reaches for the invite helper that autocompletes first.
import { findInviteByToken } from "@/lib/portal";

export const lookup = findInviteByToken;
