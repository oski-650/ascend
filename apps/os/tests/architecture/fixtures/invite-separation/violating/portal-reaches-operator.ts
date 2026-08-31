// FIXTURE · deliberately violates F58 in the OTHER direction. Not imported by anything.
//
// The client portal acquiring a dependency on operator invitations. Forbidden equally: a one-way
// rule would let the dependency form from this side and still be true.
import { createInvitation } from "@/core/auth/invitations";

export const issue = createInvitation;
