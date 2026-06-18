import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import type {
  IntakeFormData,
  ConversationMessage,
  ProjectBriefV1,
} from "@/types/onboarding";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { intake, messages, startedAt } = (await req.json()) as {
    intake: IntakeFormData;
    messages: ConversationMessage[];
    startedAt: number;
  };

  const transcript = messages
    .map((m) => `${m.role === "user" ? "CLIENT" : "ASSISTANT"}: ${m.content}`)
    .join("\n\n");

  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  const now = new Date().toISOString();

  const prompt = `You are a professional web strategy consultant generating a structured project brief for Ascend Web Solutions.

INTAKE FORM DATA:
- Business Name: ${intake.businessName}
- Industry: ${intake.industry}
- Location: ${intake.location}
- Phone: ${intake.phone || "not provided"}
- Email: ${intake.email}
- Primary Service: ${intake.primaryService}
- Description: "${intake.description}"
- Primary Goal: ${intake.primaryGoal}
- Has Logo: ${intake.hasLogo}
- Has Photos: ${intake.hasPhotos}

DISCOVERY CONVERSATION:
${transcript}

Generate a JSON object that exactly matches this structure. Output ONLY valid JSON — no markdown fences, no explanation, no other text.

{
  "business": {
    "name": "string",
    "industry": "string",
    "location": "string",
    "phone": "string or null",
    "email": "string"
  },
  "services": {
    "primary": "string",
    "secondary": "string[] or null",
    "explicit_no_secondary": "boolean"
  },
  "audience": {
    "target_customer": "string (specific, 1-2 sentences)",
    "service_area": "string"
  },
  "goals": {
    "primary_goal": "calls | bookings | leads | visits | sales",
    "secondary_goals": "string[] or null"
  },
  "positioning": {
    "tone": {
      "primary": "trustworthy | premium | modern | friendly | authoritative",
      "secondary": "array of 0-2 from same list, or null"
    },
    "brand_keywords": "array of 3-5 strings",
    "differentiators": "array of 2-4 strings"
  },
  "website_direction": {
    "summary": "string (2-3 sentences describing the website vision)",
    "suggested_style": "string (1 sentence describing visual direction)",
    "inspiration_notes": "string or null"
  },
  "assets": {
    "logo_provided": "boolean",
    "photos_provided": "boolean",
    "notes": "string or null"
  },
  "meta": {
    "completion_rate": "integer 0-100 (% of fields with clear values)",
    "confidence_score": "integer 0-100 (confidence in inferred fields)",
    "timestamp": "${now}",
    "duration_seconds": ${durationSeconds}
  },
  "review_state": "none | required"
}

Inference rules:
- Use intake + conversation to fill every field
- Make professional inferences for fields not explicitly discussed
- logo_provided = true only if hasLogo is "yes"
- photos_provided = true only if hasPhotos is "yes"
- review_state = "required" if confidence_score < 60 OR completion_rate < 70, otherwise "none"`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText =
      response.content[0].type === "text" ? response.content[0].text : "";

    const cleaned = rawText
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    const brief = JSON.parse(cleaned) as ProjectBriefV1;
    brief.meta.timestamp = now;
    brief.meta.duration_seconds = durationSeconds;

    return NextResponse.json({ brief });
  } catch (err) {
    console.error("Brief generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate brief" },
      { status: 500 }
    );
  }
}
