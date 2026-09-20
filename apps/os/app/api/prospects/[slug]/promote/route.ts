import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { promoteProspect, type PromotionOutcome } from "@/core/crm";
import { createProject } from "@/core/production";
import { routeForEntity } from "@/navigation/routing";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

const VALID_TEMPLATES = ["generic", "hvac", "plumbing", "cleaning"];

/**
 * Orchestrates two independent core modules (neither imports the other, Decision 2):
 *   core/crm.promoteProspect     → the client and the prospect mark, in whichever store owns each
 *   core/production.createProject → production_state.md + project.created (idempotent)
 *
 * ─── D1a · THE RESPONSE STATES WHAT HAPPENED, PER EFFECT ───────────────────────────────────────
 *
 * This route used to answer `{ ok: true }` whenever a client was created, whatever became of the
 * prospect — and the prospect marking ran inside a bare `catch {}` one layer down, so "the client
 * exists but the prospect is untouched" and "everything worked" were the same response. They are
 * now different outcomes with different status codes, because an operator who is told a prospect
 * was promoted will not go looking for the half that silently did not happen.
 *
 *   200  promoted | already_promoted   both effects hold
 *   202  incomplete                    one landed, one did not; `retry` says whether to retry
 *   404 / 409  refused                 nothing was written anywhere
 *
 * The project step keeps its own state in the body. It is best-effort and idempotent, and a failure
 * there does not make the promotion incomplete — but it is never hidden either.
 */
const STATUS: Record<PromotionOutcome["outcome"], number> = {
  promoted: 200,
  already_promoted: 200,
  incomplete: 202,
  refused: 409,
};

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return authorize(req, "promote", async () => {
    try {
      const { slug } = await params;
      const body = (await req.json().catch(() => ({}))) as {
        template?: string;
        client_slug?: string;
        launch_target?: string;
        package_tier?: string;
        revenue_usd?: number;
      };

      const template = body.template ?? "generic";
      if (!VALID_TEMPLATES.includes(template)) {
        return NextResponse.json({ error: `template must be one of ${VALID_TEMPLATES.join(", ")}` }, { status: 400 });
      }

      // 1 · CRM promotion — the client, and the prospect mark in the store that owns prospects.
      const promo = await promoteProspect(slug, {
        clientSlug: body.client_slug,
        packageTier: body.package_tier,
        revenueUsd: body.revenue_usd,
        launchTarget: body.launch_target,
      });

      if (promo.outcome === "refused") {
        const status = promo.refusal?.code === "prospect_not_found" ? 404 : 409;
        return NextResponse.json({ ...promo, error: promo.refusal?.message }, { status });
      }

      // 2 · Project initialization — production owns this; idempotent, so it can be safely re-run.
      //     Only attempted once a client exists to attach it to.
      const proj = await createProject(promo.client.slug!, { template, launchTarget: body.launch_target });
      const clientHref = routeForEntity("client", promo.client.slug!);

      return NextResponse.json({
        ...promo,
        template,
        project: proj.ok
          ? { state: "scaffolded" as const }
          : { state: "failed" as const, reason: proj.message },
        links: {
          client: clientHref,
          production: `/production/${promo.client.slug}`,
          ...(clientHref ? { portal: `${clientHref}/portal` } : {}),
        },
      }, { status: STATUS[promo.outcome] });
    } catch (e) {
      return serverErrorResponse("prospects/[slug]/promote", e);
    }
  });
}
