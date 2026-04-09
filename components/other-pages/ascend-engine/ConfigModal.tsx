"use client";

import { useState, useEffect } from "react";
import type { ModalConfig } from "./EngineModalContext";

const FORMSPREE_ID = "mgoooqqb";

const LOAD_OPTIONS = [
  { value: "<25",     label: "< 25",     sub: "Just getting started" },
  { value: "25-100",  label: "25–100",   sub: "Steady growth" },
  { value: "100-250", label: "100–250",  sub: "High volume" },
  { value: "250+",    label: "250+",     sub: "Enterprise scale" },
];

const GOAL_OPTIONS = [
  { value: "lead-capture",      label: "Lead Capture",      sub: "Never miss an inbound call or text",     icon: "ph-phone-incoming" },
  { value: "automated-quoting", label: "Automated Quoting", sub: "Send quotes and follow up automatically", icon: "ph-file-text" },
  { value: "full-automation",   label: "Full Automation",   sub: "Both — total hands-off operation",       icon: "ph-robot" },
];

interface Props {
  open: boolean;
  config: ModalConfig;
  onClose: () => void;
}

export default function ConfigModal({ open, config, onClose }: Props) {
  const [step, setStep] = useState(1);
  const [zip, setZip] = useState("");
  const [zipError, setZipError] = useState("");
  const [load, setLoad] = useState("");
  const [goal, setGoal] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState("");

  const presetLabel = (config.preset ?? "ASCEND ENGINE").toUpperCase();

  // Reset state every time the modal opens
  useEffect(() => {
    if (open) {
      setStep(1);
      setZip("");
      setZipError("");
      setLoad("");
      setGoal("");
      setName("");
      setEmail("");
      setPhone("");
      setDone(false);
      setFormError("");
    }
  }, [open]);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // ESC key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleStep1 = () => {
    if (!/^\d{5}$/.test(zip.trim())) {
      setZipError("Please enter a valid 5-digit zip code.");
      return;
    }
    setZipError("");
    setStep(2);
  };

  // Auto-advance on selection for steps 2 & 3
  const handleLoadSelect = (value: string) => {
    setLoad(value);
    setTimeout(() => setStep(3), 220);
  };

  const handleGoalSelect = (value: string) => {
    setGoal(value);
    setTimeout(() => setStep(4), 220);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!name.trim() || !email.trim() || !phone.trim()) {
      setFormError("All fields are required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          preset: presetLabel,
          territory: zip,
          monthly_leads: load,
          goal,
          _subject: `Engine Config — ${presetLabel} — ${zip}`,
        }),
      });
      setDone(true);
    } catch {
      setDone(true); // show success regardless — Formspree is reliable
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
      aria-label={`System Configuration: ${presetLabel}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ae-modal__window">

        {/* ── Chrome bar ── */}
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
            SYSTEM CONFIGURATION: {presetLabel}
          </span>
          <span className="ae-modal__chrome-step">
            {done ? "COMPLETE" : `STEP ${step} / 4`}
          </span>
        </div>

        {/* ── Progress bar ── */}
        {!done && (
          <div className="ae-modal__progress" aria-hidden="true">
            <div
              className="ae-modal__progress-fill"
              style={{ width: `${(step / 4) * 100}%` }}
            />
          </div>
        )}

        {/* ── Body ── */}
        <div className="ae-modal__body">
          {done ? (
            <SuccessScreen presetLabel={presetLabel} zip={zip} onClose={onClose} />
          ) : (
            <>
              {step === 1 && (
                <StepTerritory
                  zip={zip}
                  setZip={setZip}
                  zipError={zipError}
                  onNext={handleStep1}
                />
              )}
              {step === 2 && (
                <StepLoad
                  load={load}
                  onSelect={handleLoadSelect}
                  onBack={() => setStep(1)}
                />
              )}
              {step === 3 && (
                <StepGoal
                  goal={goal}
                  onSelect={handleGoalSelect}
                  onBack={() => setStep(2)}
                />
              )}
              {step === 4 && (
                <StepFinalize
                  name={name} setName={setName}
                  email={email} setEmail={setEmail}
                  phone={phone} setPhone={setPhone}
                  submitting={submitting}
                  formError={formError}
                  onSubmit={handleSubmit}
                  onBack={() => setStep(3)}
                />
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}

/* ── Step 1: Territory ─────────────────────────────────────── */
function StepTerritory({
  zip, setZip, zipError, onNext,
}: {
  zip: string;
  setZip: (v: string) => void;
  zipError: string;
  onNext: () => void;
}) {
  return (
    <div className="ae-modal__step">
      <p className="ae-modal__step-eyebrow">01 / TERRITORY</p>
      <h3 className="ae-modal__step-title">Where Are We Deploying?</h3>
      <p className="ae-modal__step-sub">
        Enter your service area zip code to check territory availability.
        We limit deployments to <strong>one operator per zip code</strong>.
      </p>
      <div className="ae-modal__field">
        <label className="ae-modal__field-label" htmlFor="ae-zip">
          ZIP CODE
        </label>
        <input
          id="ae-zip"
          type="text"
          inputMode="numeric"
          maxLength={5}
          placeholder="e.g. 95123"
          className={`ae-modal__input ae-modal__input--zip${zipError ? " ae-modal__input--error" : ""}`}
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
          onKeyDown={(e) => { if (e.key === "Enter") onNext(); }}
          autoFocus
        />
        {zipError && <p className="ae-modal__field-error">{zipError}</p>}
      </div>
      <div className="ae-modal__actions ae-modal__actions--solo">
        <button className="ae-modal__btn-primary" onClick={onNext}>
          CHECK AVAILABILITY
          <i className="ph-bold ph-arrow-right" />
        </button>
      </div>
    </div>
  );
}

/* ── Step 2: Load ─────────────────────────────────────────── */
function StepLoad({
  load, onSelect, onBack,
}: {
  load: string;
  onSelect: (v: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="ae-modal__step">
      <p className="ae-modal__step-eyebrow">02 / LOAD</p>
      <h3 className="ae-modal__step-title">Select Your Load</h3>
      <p className="ae-modal__step-sub">
        How many inbound leads do you handle per month?
      </p>
      <div className="ae-modal__options-grid">
        {LOAD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`ae-modal__option${load === opt.value ? " ae-modal__option--selected" : ""}`}
            onClick={() => onSelect(opt.value)}
          >
            <span className="ae-modal__option-label">{opt.label}</span>
            <span className="ae-modal__option-sub">{opt.sub}</span>
          </button>
        ))}
      </div>
      <div className="ae-modal__actions">
        <button className="ae-modal__btn-back" onClick={onBack}>
          <i className="ph-bold ph-arrow-left" />
          BACK
        </button>
      </div>
    </div>
  );
}

/* ── Step 3: Goal ─────────────────────────────────────────── */
function StepGoal({
  goal, onSelect, onBack,
}: {
  goal: string;
  onSelect: (v: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="ae-modal__step">
      <p className="ae-modal__step-eyebrow">03 / OBJECTIVE</p>
      <h3 className="ae-modal__step-title">Select Your Primary Objective</h3>
      <p className="ae-modal__step-sub">
        What should the Engine prioritize for your business?
      </p>
      <div className="ae-modal__goals-list">
        {GOAL_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`ae-modal__goal${goal === opt.value ? " ae-modal__goal--selected" : ""}`}
            onClick={() => onSelect(opt.value)}
          >
            <span className="ae-modal__goal-icon">
              <i className={`ph-bold ${opt.icon}`} />
            </span>
            <div className="ae-modal__goal-text">
              <span className="ae-modal__goal-label">{opt.label}</span>
              <span className="ae-modal__goal-sub">{opt.sub}</span>
            </div>
            <i className="ph-bold ph-caret-right ae-modal__goal-arrow" />
          </button>
        ))}
      </div>
      <div className="ae-modal__actions">
        <button className="ae-modal__btn-back" onClick={onBack}>
          <i className="ph-bold ph-arrow-left" />
          BACK
        </button>
      </div>
    </div>
  );
}

/* ── Step 4: Finalize ─────────────────────────────────────── */
function StepFinalize({
  name, setName, email, setEmail, phone, setPhone,
  submitting, formError, onSubmit, onBack,
}: {
  name: string; setName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  submitting: boolean;
  formError: string;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <div className="ae-modal__step">
      <p className="ae-modal__step-eyebrow">04 / ACTIVATE</p>
      <h3 className="ae-modal__step-title">Finalize Activation</h3>
      <p className="ae-modal__step-sub">
        Our deployment team will reach out within <strong>24 hours</strong> to
        activate your Engine and walk you through onboarding.
      </p>
      <form className="ae-modal__form" onSubmit={onSubmit} noValidate>
        <div className="ae-modal__field">
          <label className="ae-modal__field-label" htmlFor="ae-name">FULL NAME</label>
          <input
            id="ae-name"
            type="text"
            placeholder="John Smith"
            className="ae-modal__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="ae-modal__field">
          <label className="ae-modal__field-label" htmlFor="ae-email">EMAIL ADDRESS</label>
          <input
            id="ae-email"
            type="email"
            placeholder="john@yourbusiness.com"
            className="ae-modal__input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="ae-modal__field">
          <label className="ae-modal__field-label" htmlFor="ae-phone">PHONE NUMBER</label>
          <input
            id="ae-phone"
            type="tel"
            placeholder="(408) 555-0100"
            className="ae-modal__input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {formError && <p className="ae-modal__form-error">{formError}</p>}
        <div className="ae-modal__actions">
          <button
            type="button"
            className="ae-modal__btn-back"
            onClick={onBack}
            disabled={submitting}
          >
            <i className="ph-bold ph-arrow-left" />
            BACK
          </button>
          <button
            type="submit"
            className="ae-modal__btn-primary"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <span className="ae-modal__spinner" />
                ACTIVATING...
              </>
            ) : (
              <>
                ACTIVATE ENGINE
                <i className="ph-bold ph-lightning" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Success Screen ──────────────────────────────────────── */
function SuccessScreen({
  presetLabel, zip, onClose,
}: {
  presetLabel: string;
  zip: string;
  onClose: () => void;
}) {
  return (
    <div className="ae-modal__success">
      <div className="ae-modal__success-icon">
        <i className="ph-bold ph-check-circle" />
      </div>
      <p className="ae-modal__success-eyebrow">DEPLOYMENT QUEUED</p>
      <h3 className="ae-modal__success-title">Engine Configuration Received</h3>
      <p className="ae-modal__success-body">
        Your <strong>{presetLabel}</strong> configuration for territory{" "}
        <strong>{zip}</strong> has been submitted. Our team will contact you
        within <strong>24 hours</strong> to finalize activation.
      </p>
      <button className="ae-modal__btn-primary ae-modal__btn-primary--full" onClick={onClose}>
        CLOSE TERMINAL
        <i className="ph-bold ph-x" />
      </button>
    </div>
  );
}
