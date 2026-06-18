"use client";
import { useEffect, useState } from "react";
import type {
  Step,
  IntakeFormData,
  ConversationMessage,
  OnboardingSession,
  ProjectBriefV1,
} from "@/types/onboarding";
import StepIntake from "./StepIntake";
import StepConversation from "./StepConversation";
import StepSummary from "./StepSummary";
import StepConfirmation from "./StepConfirmation";

const SESSION_KEY = "ascend_onboarding_session";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadSession(): OnboardingSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as OnboardingSession;
    // Expire sessions older than 2 hours
    if (Date.now() - session.startedAt > 2 * 60 * 60 * 1000) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function saveSession(session: OnboardingSession) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

const STEP_LABELS: Record<Step, string> = {
  intake: "About You",
  conversation: "Discovery",
  summary: "Review",
  confirmation: "Done",
};

const STEPS: Step[] = ["intake", "conversation", "summary", "confirmation"];

export default function OnboardingFlow() {
  const [session, setSession] = useState<OnboardingSession>(() => ({
    sessionId: generateId(),
    step: "intake",
    intake: null,
    messages: [],
    brief: null,
    startedAt: Date.now(),
  }));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadSession();
    if (saved && saved.step !== "confirmation") {
      setSession(saved);
    }
    setHydrated(true);
  }, []);

  function updateSession(patch: Partial<OnboardingSession>) {
    setSession((prev) => {
      const next = { ...prev, ...patch };
      saveSession(next);
      return next;
    });
  }

  function handleIntakeComplete(intake: IntakeFormData) {
    updateSession({ intake, step: "conversation" });
  }

  function handleConversationComplete(messages: ConversationMessage[]) {
    updateSession({ messages, step: "summary" });
  }

  function handleBriefReady(brief: ProjectBriefV1) {
    updateSession({ brief });
  }

  function handleSummaryApproved(brief: ProjectBriefV1) {
    updateSession({ brief, step: "confirmation" });
    clearSession();
  }

  function handleStartOver() {
    clearSession();
    setSession({
      sessionId: generateId(),
      step: "intake",
      intake: null,
      messages: [],
      brief: null,
      startedAt: Date.now(),
    });
  }

  const currentIndex = STEPS.indexOf(session.step);

  if (!hydrated) return null;

  return (
    <div className="ob-flow">
      {/* Step indicator — hidden on confirmation */}
      {session.step !== "confirmation" && (
        <div className="ob-steps">
          {STEPS.filter((s) => s !== "confirmation").map((s, i) => {
            const idx = STEPS.indexOf(s);
            const isDone = currentIndex > idx;
            const isActive = session.step === s;
            return (
              <div
                key={s}
                className={`ob-step-item ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}`}
              >
                <div className="ob-step-dot">
                  {isDone ? (
                    <i className="ph-bold ph-check" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
                <span className="ob-step-label">{STEP_LABELS[s]}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="ob-content">
        {session.step === "intake" && (
          <StepIntake onComplete={handleIntakeComplete} />
        )}
        {session.step === "conversation" && session.intake && (
          <StepConversation
            intake={session.intake}
            initialMessages={session.messages}
            onComplete={handleConversationComplete}
          />
        )}
        {session.step === "summary" && session.intake && (
          <StepSummary
            intake={session.intake}
            messages={session.messages}
            startedAt={session.startedAt}
            brief={session.brief}
            onBriefReady={handleBriefReady}
            onApproved={handleSummaryApproved}
            onStartOver={handleStartOver}
          />
        )}
        {session.step === "confirmation" && session.intake && session.brief && (
          <StepConfirmation
            intake={session.intake}
            brief={session.brief}
          />
        )}
      </div>
    </div>
  );
}
