import { Resend } from "resend";
import { NextRequest, NextResponse } from "next/server";
import type { ProjectBriefV1, IntakeFormData } from "@/types/onboarding";

const resend = new Resend(process.env.RESEND_API_KEY);

const GOAL_LABELS: Record<string, string> = {
  calls: "Phone Calls",
  bookings: "Bookings / Appointments",
  leads: "Lead Generation",
  visits: "In-Store Visits",
  sales: "Online Sales",
};

function buildEmailHtml(brief: ProjectBriefV1): string {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const chips = (items: string[], accent = false) =>
    items
      .map(
        (item) =>
          `<span style="display:inline-block;font-size:12px;padding:3px 10px;border-radius:20px;margin:2px;font-weight:600;background:${accent ? "#e6f4ed" : "#f4f5f7"};color:${accent ? "#006B40" : "#585858"};">${item}</span>`
      )
      .join("");

  const row = (label: string, value: string) =>
    value
      ? `<tr><td style="padding:6px 0;font-size:13px;color:#838383;width:140px;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:13px;color:#161616;font-weight:500;">${value}</td></tr>`
      : "";

  const card = (title: string, body: string) => `
    <div style="background:#ffffff;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #e0dddb;">
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#006B40;margin:0 0 16px;">${title}</p>
      ${body}
    </div>`;

  const reviewBanner =
    brief.review_state === "required"
      ? `<div style="background:#fff8f0;border:1px solid #ffd599;border-radius:8px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#c47a00;">
          <strong>⚠️ Review Required</strong> — Confidence score is below threshold. Some fields may need clarification before the project starts.
         </div>`
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf7f6;font-family:'Helvetica Neue',Arial,sans-serif;color:#161616;">
<div style="max-width:680px;margin:0 auto;padding:40px 24px;">

  <h1 style="font-size:26px;font-weight:800;margin:0 0 4px;">New Project Brief</h1>
  <p style="font-size:13px;color:#838383;margin:0 0 32px;">Submitted via Ascend Onboarding · ${date}</p>

  ${reviewBanner}

  ${card(
    "Business",
    `<table style="width:100%;border-collapse:collapse;">
      ${row("Name", brief.business.name)}
      ${row("Industry", brief.business.industry)}
      ${row("Location", brief.business.location)}
      ${row("Email", brief.business.email)}
      ${brief.business.phone ? row("Phone", brief.business.phone) : ""}
    </table>`
  )}

  ${card(
    "Services",
    `<table style="width:100%;border-collapse:collapse;">
      ${row("Primary", brief.services.primary)}
      ${brief.services.secondary ? row("Secondary", brief.services.secondary.join(", ")) : ""}
      ${row("No secondary", brief.services.explicit_no_secondary ? "Confirmed" : "—")}
    </table>`
  )}

  ${card(
    "Audience & Goals",
    `<table style="width:100%;border-collapse:collapse;">
      ${row("Target Customer", brief.audience.target_customer)}
      ${row("Service Area", brief.audience.service_area)}
      ${row("Primary Goal", GOAL_LABELS[brief.goals.primary_goal] || brief.goals.primary_goal)}
      ${brief.goals.secondary_goals ? row("Secondary Goals", brief.goals.secondary_goals.join(", ")) : ""}
    </table>`
  )}

  ${card(
    "Brand Positioning",
    `<table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#838383;width:140px;vertical-align:top;">Tone</td>
        <td style="padding:6px 0;">${chips([brief.positioning.tone.primary, ...(brief.positioning.tone.secondary || [])], true)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#838383;vertical-align:top;">Brand Keywords</td>
        <td style="padding:6px 0;">${chips(brief.positioning.brand_keywords)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#838383;vertical-align:top;">Differentiators</td>
        <td style="padding:6px 0;font-size:13px;color:#161616;">${brief.positioning.differentiators.map((d) => `• ${d}`).join("<br>")}</td>
      </tr>
    </table>`
  )}

  ${card(
    "Website Direction",
    `<p style="font-size:14px;color:#303030;line-height:1.65;margin:0 0 12px;">${brief.website_direction.summary}</p>
    <table style="width:100%;border-collapse:collapse;">
      ${row("Style", brief.website_direction.suggested_style)}
      ${brief.website_direction.inspiration_notes ? row("Inspiration", brief.website_direction.inspiration_notes) : ""}
    </table>`
  )}

  ${card(
    "Assets",
    `<table style="width:100%;border-collapse:collapse;">
      ${row("Logo", brief.assets.logo_provided ? "✅ Provided" : "❌ Not provided")}
      ${row("Photos", brief.assets.photos_provided ? "✅ Provided" : "❌ Not provided")}
      ${brief.assets.notes ? row("Notes", brief.assets.notes) : ""}
    </table>`
  )}

  <div style="display:flex;gap:24px;background:#f4f5f7;border-radius:10px;padding:14px 18px;margin-bottom:32px;flex-wrap:wrap;">
    <span style="font-size:12px;color:#838383;">Completion <strong style="color:#161616;">${brief.meta.completion_rate}%</strong></span>
    <span style="font-size:12px;color:#838383;">Confidence <strong style="color:#161616;">${brief.meta.confidence_score}%</strong></span>
    <span style="font-size:12px;color:#838383;">Duration <strong style="color:#161616;">${Math.round(brief.meta.duration_seconds / 60)} min</strong></span>
    <span style="font-size:12px;color:#838383;">Status <strong style="color:#161616;">${brief.review_state === "required" ? "⚠️ Review Required" : "✅ Ready"}</strong></span>
  </div>

  <p style="font-size:12px;color:#b2aead;text-align:center;">Ascend Web Solutions · Onboarding System</p>
</div>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  const { brief, intake } = (await req.json()) as {
    brief: ProjectBriefV1;
    intake: IntakeFormData;
  };

  const reviewFlag = brief.review_state === "required" ? " ⚠️" : "";
  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "onboarding@ascendwebsolutions.com";

  try {
    await resend.emails.send({
      from: `Ascend Onboarding <${fromEmail}>`,
      to: "ascendweb1@gmail.com",
      subject: `New Brief: ${brief.business.name}${reviewFlag}`,
      html: buildEmailHtml(brief),
      replyTo: brief.business.email,
    });

    // Confirmation email to client
    await resend.emails.send({
      from: `Ascend Web Solutions <${fromEmail}>`,
      to: intake.email,
      subject: `We received your project brief — ${brief.business.name}`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#faf7f6;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:48px 24px;">
  <h1 style="font-size:24px;font-weight:800;color:#161616;margin:0 0 8px;">You&rsquo;re all set, ${intake.contactName.split(" ")[0]}.</h1>
  <p style="font-size:15px;color:#585858;line-height:1.6;margin:0 0 32px;">
    We received your project brief for <strong>${brief.business.name}</strong>. Oscar will review it and reach out within <strong>1–2 business days</strong> to schedule a quick intro call.
  </p>
  <div style="background:#ffffff;border-radius:12px;padding:20px 24px;border:1px solid #e0dddb;margin-bottom:32px;">
    <p style="font-size:13px;color:#838383;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Your goal</p>
    <p style="font-size:15px;color:#161616;font-weight:600;margin:0;">${GOAL_LABELS[brief.goals.primary_goal] || brief.goals.primary_goal} for ${brief.business.name}</p>
  </div>
  <p style="font-size:13px;color:#838383;line-height:1.6;margin:0 0 4px;">Questions before then? Reply to this email.</p>
  <p style="font-size:13px;color:#838383;margin:0;">— Oscar &amp; the Ascend team</p>
  <p style="font-size:12px;color:#b2aead;margin-top:40px;">Ascend Web Solutions · ascendwebsolutions.com</p>
</div>
</body>
</html>`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Resend submit error:", err);
    return NextResponse.json(
      { error: "Failed to send confirmation" },
      { status: 500 }
    );
  }
}
