"use client";
import { useEffect, useRef, useState } from "react";
import type {
  ConversationMessage,
  IntakeFormData,
  ProjectBriefV1,
} from "@/types/onboarding";

const GOAL_LABELS: Record<string, string> = {
  calls: "Phone Calls",
  bookings: "Bookings / Appointments",
  leads: "Lead Generation",
  visits: "In-Store Visits",
  sales: "Online Sales",
};

interface Props {
  intake: IntakeFormData;
  messages: ConversationMessage[];
  startedAt: number;
  brief: ProjectBriefV1 | null;
  onBriefReady: (brief: ProjectBriefV1) => void;
  onApproved: (brief: ProjectBriefV1) => void;
  onStartOver: () => void;
}

type SubmitState = "idle" | "submitting" | "error";

export default function StepSummary({
  intake,
  messages,
  startedAt,
  brief: initialBrief,
  onBriefReady,
  onApproved,
  onStartOver,
}: Props) {
  const [brief, setBrief] = useState<ProjectBriefV1 | null>(initialBrief);
  const [loading, setLoading] = useState(!initialBrief);
  const [loadError, setLoadError] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const hasFetched = useRef(false);

  useEffect(() => {
    if (initialBrief || hasFetched.current) return;
    hasFetched.current = true;
    generateBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateBrief() {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/onboarding/generate-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake, messages, startedAt }),
      });
      if (!res.ok) throw new Error("Generation failed");
      const { brief: generated } = (await res.json()) as { brief: ProjectBriefV1 };
      setBrief(generated);
      onBriefReady(generated);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!brief) return;
    setSubmitState("submitting");
    try {
      const res = await fetch("/api/onboarding/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, intake }),
      });
      if (!res.ok) throw new Error("Submit failed");
      onApproved(brief);
    } catch {
      setSubmitState("error");
    }
  }

  if (loading) {
    return (
      <div className="ob-card ob-card--loading">
        <div className="ob-loading">
          <div className="ob-loading__spinner" />
          <p className="ob-loading__text">Building your project brief…</p>
          <p className="ob-loading__sub">
            Reviewing your answers and generating a structured brief.
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="ob-card">
        <div className="ob-error-state">
          <i className="ph ph-warning-circle ob-error-state__icon" />
          <h3>Something went wrong</h3>
          <p>We couldn&apos;t generate your brief. Please try again.</p>
          <button
            className="ob-btn ob-btn--primary"
            onClick={() => {
              hasFetched.current = false;
              generateBrief();
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!brief) return null;

  return (
    <div className="ob-card">
      <div className="ob-card__header">
        <p className="ob-eyebrow">Step 3 of 3</p>
        <h2 className="ob-heading">Your project brief</h2>
        <p className="ob-subtext">
          Review what we&apos;ve put together. If something looks off, let us know below.
        </p>
        {brief.review_state === "required" && (
          <div className="ob-review-flag">
            <i className="ph ph-warning" />
            Some fields may need clarification — Oscar will follow up before work begins.
          </div>
        )}
      </div>

      <div className="ob-brief">
        {/* Business */}
        <div className="ob-brief__section">
          <h3 className="ob-brief__title">Business</h3>
          <div className="ob-brief__grid">
            <BriefRow label="Name" value={brief.business.name} />
            <BriefRow label="Industry" value={brief.business.industry} />
            <BriefRow label="Location" value={brief.business.location} />
            <BriefRow label="Email" value={brief.business.email} />
            {brief.business.phone && (
              <BriefRow label="Phone" value={brief.business.phone} />
            )}
          </div>
        </div>

        {/* Services */}
        <div className="ob-brief__section">
          <h3 className="ob-brief__title">Services</h3>
          <div className="ob-brief__grid">
            <BriefRow label="Primary" value={brief.services.primary} />
            {brief.services.secondary && (
              <BriefRow
                label="Secondary"
                value={brief.services.secondary.join(", ")}
              />
            )}
          </div>
        </div>

        {/* Audience & Goals */}
        <div className="ob-brief__section">
          <h3 className="ob-brief__title">Audience & Goals</h3>
          <div className="ob-brief__grid">
            <BriefRow
              label="Target customer"
              value={brief.audience.target_customer}
              wide
            />
            <BriefRow label="Service area" value={brief.audience.service_area} />
            <BriefRow
              label="Primary goal"
              value={GOAL_LABELS[brief.goals.primary_goal] || brief.goals.primary_goal}
            />
            {brief.goals.secondary_goals && (
              <BriefRow
                label="Secondary goals"
                value={brief.goals.secondary_goals.join(", ")}
                wide
              />
            )}
          </div>
        </div>

        {/* Positioning */}
        <div className="ob-brief__section">
          <h3 className="ob-brief__title">Brand Positioning</h3>
          <div className="ob-brief__grid">
            <div className="ob-brief__row ob-brief__row--wide">
              <span className="ob-brief__label">Tone</span>
              <div className="ob-chip-row">
                <span className="ob-chip ob-chip--accent">
                  {brief.positioning.tone.primary}
                </span>
                {(brief.positioning.tone.secondary || []).map((t) => (
                  <span key={t} className="ob-chip ob-chip--accent">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="ob-brief__row ob-brief__row--wide">
              <span className="ob-brief__label">Keywords</span>
              <div className="ob-chip-row">
                {brief.positioning.brand_keywords.map((k) => (
                  <span key={k} className="ob-chip">
                    {k}
                  </span>
                ))}
              </div>
            </div>
            <div className="ob-brief__row ob-brief__row--full">
              <span className="ob-brief__label">Differentiators</span>
              <ul className="ob-brief__list">
                {brief.positioning.differentiators.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Website Direction */}
        <div className="ob-brief__section">
          <h3 className="ob-brief__title">Website Direction</h3>
          <div className="ob-brief__grid">
            <div className="ob-brief__row ob-brief__row--full">
              <p className="ob-brief__summary">{brief.website_direction.summary}</p>
            </div>
            <BriefRow label="Style" value={brief.website_direction.suggested_style} wide />
            {brief.website_direction.inspiration_notes && (
              <BriefRow
                label="Inspiration"
                value={brief.website_direction.inspiration_notes}
                wide
              />
            )}
          </div>
        </div>

        {/* Assets */}
        <div className="ob-brief__section">
          <h3 className="ob-brief__title">Assets</h3>
          <div className="ob-brief__grid">
            <BriefRow
              label="Logo"
              value={brief.assets.logo_provided ? "Provided" : "Not yet"}
            />
            <BriefRow
              label="Photos"
              value={brief.assets.photos_provided ? "Provided" : "Not yet"}
            />
            {brief.assets.notes && (
              <BriefRow label="Notes" value={brief.assets.notes} wide />
            )}
          </div>
        </div>

        {/* Meta bar */}
        <div className="ob-brief__meta">
          <span>
            Completion <strong>{brief.meta.completion_rate}%</strong>
          </span>
          <span>
            Confidence <strong>{brief.meta.confidence_score}%</strong>
          </span>
          <span>
            Duration <strong>{Math.round(brief.meta.duration_seconds / 60)} min</strong>
          </span>
        </div>
      </div>

      {/* Feedback escape hatch */}
      {!feedbackOpen && (
        <button
          className="ob-link ob-link--sm"
          onClick={() => setFeedbackOpen(true)}
        >
          <i className="ph ph-pencil-simple" /> Something looks off
        </button>
      )}

      {feedbackOpen && (
        <div className="ob-feedback">
          <p className="ob-feedback__label">
            What should we change? (Oscar will review this before reaching out.)
          </p>
          <textarea
            className="ob-input ob-textarea"
            rows={3}
            placeholder="e.g. The service area is wrong — we actually serve all of Fresno County, not just the city."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="ob-feedback__actions">
            <button
              className="ob-btn ob-btn--ghost ob-btn--sm"
              onClick={() => setFeedbackOpen(false)}
            >
              Cancel
            </button>
            <button
              className="ob-btn ob-btn--primary ob-btn--sm"
              onClick={() => {
                if (!brief) return;
                const updated: ProjectBriefV1 = {
                  ...brief,
                  review_state: "required",
                  website_direction: {
                    ...brief.website_direction,
                    inspiration_notes: feedback
                      ? `${brief.website_direction.inspiration_notes ?? ""}\n\nClient note: ${feedback}`.trim()
                      : brief.website_direction.inspiration_notes,
                  },
                };
                setBrief(updated);
                onBriefReady(updated);
                setFeedbackOpen(false);
                setFeedback("");
              }}
            >
              Save note
            </button>
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="ob-summary-actions">
        {submitState === "error" && (
          <p className="ob-error ob-error--center">
            Submission failed — please try again.
          </p>
        )}
        <button
          className="ob-btn ob-btn--primary ob-btn--large"
          onClick={handleApprove}
          disabled={submitState === "submitting"}
        >
          {submitState === "submitting" ? (
            <>
              <span className="ob-spinner" /> Submitting…
            </>
          ) : (
            <>
              Looks good — submit
              <i className="ph-bold ph-arrow-right" />
            </>
          )}
        </button>
        <button
          className="ob-link ob-link--sm"
          onClick={onStartOver}
          disabled={submitState === "submitting"}
        >
          Start over
        </button>
      </div>
    </div>
  );
}

function BriefRow({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`ob-brief__row ${wide ? "ob-brief__row--wide" : ""}`}>
      <span className="ob-brief__label">{label}</span>
      <span className="ob-brief__value">{value}</span>
    </div>
  );
}
