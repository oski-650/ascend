"use client";
import { useForm } from "react-hook-form";
import type { IntakeFormData, GoalType } from "@/types/onboarding";

interface Props {
  onComplete: (data: IntakeFormData) => void;
}

const GOAL_OPTIONS: { value: GoalType; label: string; desc: string }[] = [
  { value: "calls", label: "Phone Calls", desc: "Drive calls from potential customers" },
  { value: "bookings", label: "Bookings", desc: "Let people schedule appointments online" },
  { value: "leads", label: "Lead Forms", desc: "Capture contact info for follow-up" },
  { value: "visits", label: "In-Store Visits", desc: "Bring people through the door" },
  { value: "sales", label: "Online Sales", desc: "Sell products or services directly" },
];

export default function StepIntake({ onComplete }: Props) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<IntakeFormData>({
    defaultValues: { primaryGoal: "calls", hasLogo: "no", hasPhotos: "no" },
  });

  const primaryGoal = watch("primaryGoal");

  return (
    <div className="ob-card">
      <div className="ob-card__header">
        <p className="ob-eyebrow">Step 1 of 3</p>
        <h2 className="ob-heading">Tell us about your business</h2>
        <p className="ob-subtext">
          A quick 2-minute form before we dive into the details.
        </p>
      </div>

      <form onSubmit={handleSubmit(onComplete)} className="ob-form" noValidate>
        {/* Section A */}
        <div className="ob-form__section">
          <p className="ob-form__section-label">About you</p>
          <div className="ob-form__row ob-form__row--2">
            <div className="ob-field">
              <label className="ob-label">Your name *</label>
              <input
                className={`ob-input ${errors.contactName ? "ob-input--error" : ""}`}
                type="text"
                placeholder="Jane Smith"
                {...register("contactName", { required: "Required" })}
              />
              {errors.contactName && (
                <p className="ob-error">{errors.contactName.message}</p>
              )}
            </div>
            <div className="ob-field">
              <label className="ob-label">Business name *</label>
              <input
                className={`ob-input ${errors.businessName ? "ob-input--error" : ""}`}
                type="text"
                placeholder="Smith Electric Co."
                {...register("businessName", { required: "Required" })}
              />
              {errors.businessName && (
                <p className="ob-error">{errors.businessName.message}</p>
              )}
            </div>
          </div>
          <div className="ob-form__row ob-form__row--2">
            <div className="ob-field">
              <label className="ob-label">Email *</label>
              <input
                className={`ob-input ${errors.email ? "ob-input--error" : ""}`}
                type="email"
                placeholder="jane@smithelectric.com"
                {...register("email", {
                  required: "Required",
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Invalid email" },
                })}
              />
              {errors.email && (
                <p className="ob-error">{errors.email.message}</p>
              )}
            </div>
            <div className="ob-field">
              <label className="ob-label">Phone <span className="ob-optional">(optional)</span></label>
              <input
                className="ob-input"
                type="tel"
                placeholder="(559) 555-0100"
                {...register("phone")}
              />
            </div>
          </div>
        </div>

        {/* Section B */}
        <div className="ob-form__section">
          <p className="ob-form__section-label">Your business</p>
          <div className="ob-form__row ob-form__row--2">
            <div className="ob-field">
              <label className="ob-label">Industry / type of business *</label>
              <input
                className={`ob-input ${errors.industry ? "ob-input--error" : ""}`}
                type="text"
                placeholder="Electrical contractor"
                {...register("industry", { required: "Required" })}
              />
              {errors.industry && (
                <p className="ob-error">{errors.industry.message}</p>
              )}
            </div>
            <div className="ob-field">
              <label className="ob-label">City / location *</label>
              <input
                className={`ob-input ${errors.location ? "ob-input--error" : ""}`}
                type="text"
                placeholder="Fresno, CA"
                {...register("location", { required: "Required" })}
              />
              {errors.location && (
                <p className="ob-error">{errors.location.message}</p>
              )}
            </div>
          </div>
          <div className="ob-field">
            <label className="ob-label">Primary service you offer *</label>
            <input
              className={`ob-input ${errors.primaryService ? "ob-input--error" : ""}`}
              type="text"
              placeholder="Residential electrical work & panel upgrades"
              {...register("primaryService", { required: "Required" })}
            />
            {errors.primaryService && (
              <p className="ob-error">{errors.primaryService.message}</p>
            )}
          </div>
          <div className="ob-field">
            <label className="ob-label">
              Describe your business in 1–2 sentences *
            </label>
            <textarea
              className={`ob-input ob-textarea ${errors.description ? "ob-input--error" : ""}`}
              placeholder="We help homeowners in Fresno with safe, reliable electrical work — from panel upgrades to new installs."
              rows={3}
              {...register("description", {
                required: "Required",
                minLength: { value: 20, message: "Please add a bit more detail" },
              })}
            />
            {errors.description && (
              <p className="ob-error">{errors.description.message}</p>
            )}
          </div>
        </div>

        {/* Section C — Goal */}
        <div className="ob-form__section">
          <p className="ob-form__section-label">Your website goal</p>
          <p className="ob-subtext ob-subtext--sm">
            What&apos;s the single most important action you want visitors to take?
          </p>
          <div className="ob-goal-grid">
            {GOAL_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`ob-goal-card ${primaryGoal === opt.value ? "is-selected" : ""}`}
              >
                <input
                  type="radio"
                  value={opt.value}
                  {...register("primaryGoal", { required: true })}
                  className="ob-goal-card__radio"
                />
                <span className="ob-goal-card__label">{opt.label}</span>
                <span className="ob-goal-card__desc">{opt.desc}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Section D — Assets */}
        <div className="ob-form__section">
          <p className="ob-form__section-label">Assets you have</p>
          <div className="ob-form__row ob-form__row--2">
            <div className="ob-field">
              <label className="ob-label">Do you have a logo?</label>
              <select className="ob-input ob-select" {...register("hasLogo")}>
                <option value="yes">Yes, I have one</option>
                <option value="in-progress">Working on it</option>
                <option value="no">No, I need one</option>
              </select>
            </div>
            <div className="ob-field">
              <label className="ob-label">Do you have professional photos?</label>
              <select className="ob-input ob-select" {...register("hasPhotos")}>
                <option value="yes">Yes, I have photos</option>
                <option value="no">No, but I can get some</option>
                <option value="need-help">No, I&apos;ll need help</option>
              </select>
            </div>
          </div>
        </div>

        <div className="ob-form__footer">
          <button type="submit" className="ob-btn ob-btn--primary">
            Continue to Discovery
            <i className="ph-bold ph-arrow-right" />
          </button>
          <p className="ob-form__time-note">
            <i className="ph ph-clock" /> Takes about 5–10 minutes total
          </p>
        </div>
      </form>
    </div>
  );
}
