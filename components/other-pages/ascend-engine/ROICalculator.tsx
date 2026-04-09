"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "react-toastify";
import { useEngineModal } from "./EngineModalContext";

interface SliderConfig {
  key: keyof CalcValues;
  label: string;
  micro: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  defaultVal: number;
}

interface CalcValues {
  jobValue: number;
  monthlyLeads: number;
  missedPct: number;
  closeRate: number;
}

const SLIDERS: SliderConfig[] = [
  {
    key: "jobValue",
    label: "Average Job Value",
    micro: "What is your average invoice amount?",
    min: 500,
    max: 20000,
    step: 100,
    format: (v) => `$${v.toLocaleString()}`,
    defaultVal: 2500,
  },
  {
    key: "monthlyLeads",
    label: "Monthly Leads",
    micro: "How many new inquiries do you get per month?",
    min: 10,
    max: 500,
    step: 5,
    format: (v) => `${v}`,
    defaultVal: 50,
  },
  {
    key: "missedPct",
    label: "Estimated Missed Leads",
    micro: "How many leads go unanswered or aren't followed up instantly?",
    min: 5,
    max: 50,
    step: 1,
    format: (v) => `${v}%`,
    defaultVal: 20,
  },
  {
    key: "closeRate",
    label: "Current Close Rate",
    micro: "What percentage of leads currently become paying jobs?",
    min: 10,
    max: 60,
    step: 1,
    format: (v) => `${v}%`,
    defaultVal: 30,
  },
];

function useCountUp(target: number, duration = 700): number {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current = null;

    const step = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}

function fillPct(value: number, min: number, max: number): string {
  return `${((value - min) / (max - min)) * 100}%`;
}

export default function ROICalculator() {
  const [values, setValues] = useState<CalcValues>({
    jobValue: 2500,
    monthlyLeads: 50,
    missedPct: 20,
    closeRate: 30,
  });
  const [toastFired, setToastFired] = useState(false);
  const { openModal } = useEngineModal();

  // Core formula
  const lostLeads = values.monthlyLeads * (values.missedPct / 100);
  const lostJobs = lostLeads * (values.closeRate / 100);
  const monthlyLeak = lostJobs * values.jobValue;
  const annualRecovery = monthlyLeak * 12;

  // Secondary stats
  const adminHoursReclaimed = Math.round(lostLeads * 12 * 0.75 + 120);
  const systemROI =
    annualRecovery > 0 ? (annualRecovery / (599 * 12)).toFixed(1) : "0.0";

  const animatedValue = useCountUp(annualRecovery);

  const handleChange = (key: keyof CalcValues, value: number) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  // Toast when leak is high
  useEffect(() => {
    if (annualRecovery >= 60000 && !toastFired) {
      setToastFired(true);
      const timer = setTimeout(() => {
        toast(
          <span className="ae-roi__toast-inner">
            <span className="ae-roi__toast-label">[SYSTEM]</span> High-revenue
            leak detected. Engine deployment recommended.
          </span>,
          {
            position: "bottom-right",
            autoClose: 7000,
            className: "ae-roi__toast",
            progressClassName: "ae-roi__toast-progress",
          }
        );
      }, 600);
      return () => clearTimeout(timer);
    }
    if (annualRecovery < 60000) setToastFired(false);
  }, [annualRecovery, toastFired]);

  return (
    <section className="ae-roi">
      <div className="mxd-container">
        <div className="mxd-block">

          {/* Section Header */}
          <div className="ae-roi__header">

            {/* Terminal status bar */}
            <div className="ae-roi__term-bar">
              <span className="ae-roi__term-prompt">
                <span className="ae-roi__term-caret">&gt;&nbsp;</span>
                PROFIT_RECOVERY_LAB.exe
              </span>
              <span className="ae-roi__term-status">
                <span className="ae-roi__eyebrow-dot" />
                STATUS: ACTIVE
              </span>
            </div>

            {/* Title + sub row */}
            <div className="ae-roi__title-row">
              <h2 className="ae-roi__title">
                The Numbers<br />
                <span className="ae-roi__title-accent">Don&apos;t Lie</span>
              </h2>
              <p className="ae-roi__sub">
                Move the sliders. Watch what you&apos;re actually losing every year — then decide if
                the Engine pays for itself.
              </p>
            </div>

          </div>

          {/* Main Lab Card */}
          <div className="ae-roi__lab">

            {/* Backdrop grid */}
            <div className="ae-roi__lab-grid" aria-hidden="true" />

            {/* Two-col layout */}
            <div className="ae-roi__lab-inner">

              {/* LEFT: Sliders */}
              <div className="ae-roi__inputs">
                <p className="ae-roi__inputs-label">
                  <i className="ph-bold ph-sliders-horizontal" />
                  INPUT YOUR NUMBERS
                </p>

                {SLIDERS.map((s) => {
                  const val = values[s.key];
                  const pct = fillPct(val, s.min, s.max);
                  return (
                    <div key={s.key} className="ae-roi__slider-group">
                      <div className="ae-roi__slider-header">
                        <span className="ae-roi__slider-label">{s.label}</span>
                        <span className="ae-roi__slider-value">{s.format(val)}</span>
                      </div>
                      <p className="ae-roi__slider-micro">{s.micro}</p>
                      <div className="ae-roi__slider-track-wrap">
                        <input
                          type="range"
                          className="ae-roi__slider"
                          min={s.min}
                          max={s.max}
                          step={s.step}
                          value={val}
                          onChange={(e) =>
                            handleChange(s.key, Number(e.target.value))
                          }
                          style={
                            {
                              "--fill": pct,
                            } as React.CSSProperties
                          }
                        />
                      </div>
                      <div className="ae-roi__slider-range-labels">
                        <span>{s.format(s.min)}</span>
                        <span>{s.format(s.max)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* RIGHT: Output */}
              <div className="ae-roi__output">

                {/* Big number */}
                <div className="ae-roi__primary">
                  <p className="ae-roi__primary-label">
                    ESTIMATED ANNUAL REVENUE RECOVERED
                  </p>
                  <div className="ae-roi__primary-num">
                    <span className="ae-roi__primary-dollar">$</span>
                    <span className="ae-roi__primary-value">
                      {animatedValue.toLocaleString()}
                    </span>
                  </div>
                  <p className="ae-roi__primary-per-month">
                    ≈{" "}
                    <strong>
                      ${Math.round(monthlyLeak).toLocaleString()}
                    </strong>{" "}
                    per month currently leaking
                  </p>
                </div>

                {/* Secondary stats */}
                <div className="ae-roi__stats">
                  <div className="ae-roi__stat">
                    <span className="ae-roi__stat-num">{adminHoursReclaimed}</span>
                    <span className="ae-roi__stat-unit">hrs/yr</span>
                    <span className="ae-roi__stat-label">Admin Hours Reclaimed</span>
                  </div>
                  <div className="ae-roi__stat-divider" />
                  <div className="ae-roi__stat">
                    <span className="ae-roi__stat-num">−98</span>
                    <span className="ae-roi__stat-unit">%</span>
                    <span className="ae-roi__stat-label">Lead Response Time</span>
                  </div>
                  <div className="ae-roi__stat-divider" />
                  <div className="ae-roi__stat">
                    <span className="ae-roi__stat-num">{systemROI}</span>
                    <span className="ae-roi__stat-unit">×</span>
                    <span className="ae-roi__stat-label">System ROI</span>
                  </div>
                </div>

                {/* Bridge to action */}
                <div className="ae-roi__bridge">
                  <p className="ae-roi__bridge-math">
                    You&apos;re losing{" "}
                    <span className="ae-roi__bridge-leak">
                      ${Math.round(monthlyLeak).toLocaleString()}/mo
                    </span>{" "}
                    to save{" "}
                    <span className="ae-roi__bridge-cost">$599/mo</span>.
                    <br />
                    It&apos;s time to stop the leak.
                  </p>
                  <button
                    type="button"
                    className="ae-roi__cta"
                    onClick={() => openModal({ preset: "Growth Package" })}
                  >
                    ACTIVATE GROWTH ENGINE
                    <i className="ph-bold ph-arrow-up-right" />
                  </button>
                </div>

              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
