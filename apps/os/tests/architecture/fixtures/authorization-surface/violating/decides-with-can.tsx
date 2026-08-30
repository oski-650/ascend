// FIXTURE · deliberately violates F54. Not imported by anything.
//
// The shape the rule exists to prevent: a page that resolves a principal and makes the
// authorization decision itself, instead of letting the data boundary make it.
import { can } from "@/core/auth/capabilities";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { OrganizationId, UserId } from "@/domain";

export default async function DecidesWithCan() {
  const principal = __unsafePrincipalForTests("owner", "org" as OrganizationId, "user" as UserId);
  if (!can(principal, "finance:*")) return <p>denied</p>;
  return <p>finance</p>;
}
