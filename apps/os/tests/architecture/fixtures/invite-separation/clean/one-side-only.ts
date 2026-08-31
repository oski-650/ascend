// FIXTURE · the same shape written correctly. Not imported by anything.
//
// Reaches the OPERATOR invitation primitive and nothing else. Without this, a matcher that flagged
// every file would make the control above pass while proving nothing.
import { createInvitation } from "@/core/auth/invitations";

export const issue = createInvitation;
