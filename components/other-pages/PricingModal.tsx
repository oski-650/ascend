"use client";

import { useState, useEffect } from "react";

const FORMSPREE_ID = "mgoooqqb";

interface Props {
  open: boolean;
  packageName: string;
  onClose: () => void;
}

export default function PricingModal({ open, packageName, onClose }: Props) {
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [carePlan, setCarePlan] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState("");

  const isStarter = packageName === "Starter Site";

  // Reset on open
  useEffect(() => {
    if (open) {
      setName("");
      setBusiness("");
      setEmail("");
      setPhone("");
      setZip("");
      setCarePlan(false);
      setDone(false);
      setFormError("");
    }
  }, [open]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!name.trim() || !business.trim() || !email.trim() || !phone.trim() || !zip.trim()) {
      setFormError("All fields are required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (!/^\d{5}$/.test(zip.trim())) {
      setFormError("Please enter a valid 5-digit zip code.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name,
          business_name: business,
          email,
          phone,
          zip,
          package: packageName,
          care_plan: isStarter ? (carePlan ? "Yes (+$100/mo)" : "No") : "Included",
          _subject: `New Project Inquiry — ${packageName} — ${name}`,
        }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="ae-modal__overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Start Project: ${packageName}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ae-modal__window">

        {/* Chrome bar */}
        <div className="ae-modal__chrome">
          <div className="ae-modal__chrome-dots">
            <button
              className="ae-modal__chrome-dot ae-modal__chrome-dot--red"
              onClick={onClose}
              aria-label="Close"
            />
            <span className="ae-modal__chrome-dot ae-modal__chrome-dot--yellow" />
            <span className="ae-modal__chrome-dot ae-modal__chrome-dot--green" />
          </div>
          <span className="ae-modal__chrome-title">
            START PROJECT: {packageName.toUpperCase()}
          </span>
          <span className="ae-modal__chrome-step">
            {done ? "COMPLETE" : "STEP 1 / 1"}
          </span>
        </div>

        {/* Progress bar */}
        {!done && (
          <div className="ae-modal__progress" aria-hidden="true">
            <div className="ae-modal__progress-fill" style={{ width: "100%" }} />
          </div>
        )}

        {/* Body */}
        <div className="ae-modal__body ae-modal__body--scrollable">
          {done ? (
            <SuccessScreen packageName={packageName} name={name} onClose={onClose} />
          ) : (
            <div className="ae-modal__step">
              <p className="ae-modal__step-eyebrow">PROJECT INQUIRY</p>
              <h3 className="ae-modal__step-title">Let&apos;s Get Started</h3>
              <p className="ae-modal__step-sub">
                Fill in your details and we&apos;ll reach out within{" "}
                <strong>24 hours</strong> to kick off your project.
              </p>

              <form className="ae-modal__form" onSubmit={handleSubmit} noValidate>

                <div className="ae-modal__form-row">
                  <div className="ae-modal__field">
                    <label className="ae-modal__field-label" htmlFor="pr-name">
                      FULL NAME
                    </label>
                    <input
                      id="pr-name"
                      type="text"
                      placeholder="John Smith"
                      className="ae-modal__input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="ae-modal__field">
                    <label className="ae-modal__field-label" htmlFor="pr-business">
                      BUSINESS NAME
                    </label>
                    <input
                      id="pr-business"
                      type="text"
                      placeholder="Smith Plumbing LLC"
                      className="ae-modal__input"
                      value={business}
                      onChange={(e) => setBusiness(e.target.value)}
                    />
                  </div>
                </div>

                <div className="ae-modal__form-row">
                  <div className="ae-modal__field">
                    <label className="ae-modal__field-label" htmlFor="pr-email">
                      EMAIL ADDRESS
                    </label>
                    <input
                      id="pr-email"
                      type="email"
                      placeholder="john@yourbusiness.com"
                      className="ae-modal__input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="ae-modal__field">
                    <label className="ae-modal__field-label" htmlFor="pr-phone">
                      PHONE NUMBER
                    </label>
                    <input
                      id="pr-phone"
                      type="tel"
                      placeholder="(408) 555-0100"
                      className="ae-modal__input"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div className="ae-modal__form-row ae-modal__form-row--half">
                  <div className="ae-modal__field">
                    <label className="ae-modal__field-label" htmlFor="pr-zip">
                      ZIP CODE
                    </label>
                    <input
                      id="pr-zip"
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="e.g. 95123"
                      className="ae-modal__input ae-modal__input--zip"
                      value={zip}
                      onChange={(e) =>
                        setZip(e.target.value.replace(/\D/g, "").slice(0, 5))
                      }
                    />
                  </div>
                  <div className="ae-modal__field">
                    <label className="ae-modal__field-label">SELECTED PACKAGE</label>
                    <div className="ae-modal__package-badge">
                      <i className="ph-bold ph-package" />
                      {packageName}
                      <span className="ae-modal__package-lock">
                        <i className="ph-bold ph-lock-simple" />
                      </span>
                    </div>
                  </div>
                </div>

                {/* Care plan — Starter only */}
                {isStarter && (
                  <label className="ae-modal__care-plan">
                    <input
                      type="checkbox"
                      className="ae-modal__care-plan-check"
                      checked={carePlan}
                      onChange={(e) => setCarePlan(e.target.checked)}
                    />
                    <div className="ae-modal__care-plan-content">
                      <span className="ae-modal__care-plan-label">
                        Add monthly care plan?{" "}
                        <strong>+$100/mo</strong>
                      </span>
                      <span className="ae-modal__care-plan-sub">
                        Includes hosting, updates, and ongoing support
                      </span>
                    </div>
                  </label>
                )}

                {formError && (
                  <p className="ae-modal__form-error">{formError}</p>
                )}

                <div className="ae-modal__actions ae-modal__actions--solo">
                  <button
                    type="submit"
                    className="ae-modal__btn-primary"
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <span className="ae-modal__spinner" />
                        SUBMITTING...
                      </>
                    ) : (
                      <>
                        START MY PROJECT
                        <i className="ph-bold ph-arrow-right" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function SuccessScreen({
  packageName,
  name,
  onClose,
}: {
  packageName: string;
  name: string;
  onClose: () => void;
}) {
  return (
    <div className="ae-modal__success">
      <div className="ae-modal__success-icon">
        <i className="ph-bold ph-check-circle" />
      </div>
      <p className="ae-modal__success-eyebrow">PROJECT QUEUED</p>
      <h3 className="ae-modal__success-title">Request Received</h3>
      <p className="ae-modal__success-body">
        Thanks, <strong>{name}</strong>! Your{" "}
        <strong>{packageName}</strong> inquiry has been submitted. Our team
        will reach out within <strong>24 hours</strong> to get your project
        started.
      </p>
      <button
        className="ae-modal__btn-primary ae-modal__btn-primary--full"
        onClick={onClose}
      >
        CLOSE
        <i className="ph-bold ph-x" />
      </button>
    </div>
  );
}
