// FIXTURE · deliberately violates F54. Not imported by anything.
//
// Subtler: it decides nothing today, but holding a principal is one `if` away from deciding — which
// is why `requirePagePrincipal` is in the forbidden surface while it still has no consumers.
import { requirePagePrincipal } from "@/lib/page-principal";

export async function ResolvesAPrincipal() {
  const principal = await requirePagePrincipal();
  return <p>{principal.role}</p>;
}
