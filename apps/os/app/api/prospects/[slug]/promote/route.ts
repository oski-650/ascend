import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { promoteProspect } from "@/core/crm";
import { createProject } from "@/core/production";

export const dynamic = "force-dynamic";

const VALID_TEMPLATES = ["generic", "hvac", "plumbing", "cleaning"];

// Orchestrates two independent core modules (neither imports the other, Decision 2):
//   core/crm.promoteProspect  → Client + prospect (client.created, prospect.promoted)
//   core/production.createProject → production_state.md + project.created (idempotent)
// The Phase-2.2 temporary production_state route write is now REMOVED (2.3 debt discharged).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
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

    // 1. CRM promotion — Client + CRM events.
    const promo = await promoteProspect(slug, {
      clientSlug: body.client_slug,
      packageTier: body.package_tier,
      revenueUsd: body.revenue_usd,
      launchTarget: body.launch_target,
    });
    if (!promo.ok) {
      const status = promo.code === "prospect_not_found" ? 404 : 409;
      return NextResponse.json({ error: promo.message }, { status });
    }

    // 2. Project initialization — production owns this now (idempotent + project.created).
    //    Best-effort (Decision 4): a rare failure leaves a client without a project, surfaced by
    //    reconcile-on-read later; createProject is idempotent so it can be safely re-run to heal.
    const proj = await createProject(promo.clientSlug, { template, launchTarget: body.launch_target });

    return NextResponse.json({
      ok: true,
      client_slug: promo.clientSlug,
      template,
      project_scaffolded: proj.ok,
      ...(proj.ok ? {} : { project_warning: proj.message }),
      links: {
        crm: `/crm/${promo.clientSlug}`,
        production: `/production/${promo.clientSlug}`,
        portal: `/crm/${promo.clientSlug}/portal`,
      },
      promotion_id: randomUUID(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
