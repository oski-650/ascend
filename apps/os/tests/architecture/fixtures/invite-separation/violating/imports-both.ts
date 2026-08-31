// FIXTURE · deliberately violates F58's whole-repository sweep. Not imported by anything.
//
// One file holding both primitives at once. They are not variants of one idea, and a module that
// treats them as interchangeable is where the conflation becomes permanent.
import { createInvitation } from "@/core/auth/invitations";
import { findInviteByToken } from "@/lib/portal";

export const both = { createInvitation, findInviteByToken };
