"use client";
import Link from "next/link";
import type { IntakeFormData, ProjectBriefV1 } from "@/types/onboarding";

const GOAL_LABELS: Record<string, string> = {
  calls: "more phone calls",
  bookings: "more bookings",
  leads: "more leads",
  visits: "more in-store visits",
  sales: "more online sales",
};

interface Props {
  intake: IntakeFormData;
  brief: ProjectBriefV1;
}

export default function StepConfirmation({ intake, brief }: Props) {
  const firstName = intake.contactName.split(" ")[0];
  const goalText = GOAL_LABELS[brief.goals.primary_goal] || "your goal";

  return (
    <div className="ob-card ob-card--confirmation">
      <div className="ob-confirm">
        <div className="ob-confirm__icon">
          <i className="ph-fill ph-check-circle" />
        </div>

        <h2 className="ob-confirm__heading">
          You&rsquo;re all set, {firstName}.
        </h2>
        <p className="ob-confirm__sub">
          Your brief for <strong>{brief.business.name}</strong> has been submitted.
          Oscar will review it and reach out within <strong>1–2 business days</strong> to
          schedule a quick intro call.
        </p>

        <div className="ob-confirm__summary">
          <div className="ob-confirm__row">
            <span className="ob-confirm__label">Business</span>
            <span className="ob-confirm__value">{brief.business.name}</span>
          </div>
          <div className="ob-confirm__row">
            <span className="ob-confirm__label">Goal</span>
            <span className="ob-confirm__value">{goalText}</span>
          </div>
          <div className="ob-confirm__row">
            <span className="ob-confirm__label">Confirmation sent to</span>
            <span className="ob-confirm__value">{intake.email}</span>
          </div>
          {brief.review_state === "required" && (
            <div className="ob-confirm__row">
              <span className="ob-confirm__label">Note</span>
              <span className="ob-confirm__value ob-confirm__value--flag">
                Oscar may follow up to clarify a few details before work begins.
              </span>
            </div>
          )}
        </div>

        <div className="ob-confirm__next">
          <h4 className="ob-confirm__next-title">What happens next</h4>
          <ol className="ob-confirm__steps">
            <li>
              <span className="ob-confirm__step-num">1</span>
              <span>Oscar reviews your brief</span>
            </li>
            <li>
              <span className="ob-confirm__step-num">2</span>
              <span>He reaches out to schedule a quick intro call</span>
            </li>
            <li>
              <span className="ob-confirm__step-num">3</span>
              <span>We present a tailored proposal for your project</span>
            </li>
          </ol>
        </div>

        <div className="ob-confirm__actions">
          <Link href="/" className="ob-btn ob-btn--primary">
            Back to Ascend
            <i className="ph-bold ph-arrow-right" />
          </Link>
          <Link href="/contact" className="ob-btn ob-btn--ghost">
            Have a question?
          </Link>
        </div>
      </div>
    </div>
  );
}
