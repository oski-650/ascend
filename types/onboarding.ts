export type Step = "intake" | "conversation" | "summary" | "confirmation";

export type GoalType = "calls" | "bookings" | "leads" | "visits" | "sales";
export type ToneType =
  | "trustworthy"
  | "premium"
  | "modern"
  | "friendly"
  | "authoritative";

export interface IntakeFormData {
  contactName: string;
  email: string;
  phone: string;
  businessName: string;
  industry: string;
  location: string;
  primaryService: string;
  description: string;
  primaryGoal: GoalType;
  hasLogo: "yes" | "no" | "in-progress";
  hasPhotos: "yes" | "no" | "need-help";
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProjectBriefV1 {
  business: {
    name: string;
    industry: string;
    location: string;
    phone: string | null;
    email: string;
  };
  services: {
    primary: string;
    secondary: string[] | null;
    explicit_no_secondary: boolean;
  };
  audience: {
    target_customer: string;
    service_area: string;
  };
  goals: {
    primary_goal: GoalType;
    secondary_goals: string[] | null;
  };
  positioning: {
    tone: {
      primary: ToneType;
      secondary: ToneType[] | null;
    };
    brand_keywords: string[];
    differentiators: string[];
  };
  website_direction: {
    summary: string;
    suggested_style: string;
    inspiration_notes: string | null;
  };
  assets: {
    logo_provided: boolean;
    photos_provided: boolean;
    notes: string | null;
  };
  meta: {
    completion_rate: number;
    confidence_score: number;
    timestamp: string;
    duration_seconds: number;
  };
  review_state: "none" | "required";
}

export interface OnboardingSession {
  sessionId: string;
  step: Step;
  intake: IntakeFormData | null;
  messages: ConversationMessage[];
  brief: ProjectBriefV1 | null;
  startedAt: number;
}
