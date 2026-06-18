import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { IntakeFormData, ConversationMessage } from "@/types/onboarding";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(intake: IntakeFormData): string {
  const goalLabel: Record<string, string> = {
    calls: "phone calls",
    bookings: "bookings / appointments",
    leads: "lead generation",
    visits: "in-store visits",
    sales: "online sales",
  };

  return `You are a friendly discovery assistant for Ascend Web Solutions, a premium web design agency in the Bay Area / Central Valley, CA.

Your job is to gather information needed to build a high-quality website brief for a small business owner. Oscar Robles (the founder) will use this brief to design and develop their website.

The client has already filled out an intake form:

Business: ${intake.businessName}
Industry: ${intake.industry}
Location: ${intake.location}
Primary Service: ${intake.primaryService}
Description: "${intake.description}"
Primary Goal: ${goalLabel[intake.primaryGoal] || intake.primaryGoal}
Has Logo: ${intake.hasLogo}
Has Photos: ${intake.hasPhotos}

Your goal is to ask targeted follow-up questions to build a complete picture across these areas (skip anything already clearly covered):
1. Brand tone / personality — how they want the business to feel: trustworthy, premium, modern, friendly, or authoritative
2. Unique differentiators — what makes them stand out from competitors in their area
3. Target customer — who they serve in specific, concrete terms (not just "local businesses")
4. Service area — are they hyperlocal, city-wide, regional, or statewide?
5. Style / inspiration — any websites or brands they admire, look/feel they're going for
6. Specific features needed — booking system, gallery, testimonials, contact form, before/after photos, etc.

Rules:
- Ask ONE focused question per message
- Be warm, conversational, and professional — like a knowledgeable creative collaborator
- Reference specific details from their intake to make questions feel personal
- Briefly acknowledge good answers (one sentence max) before the next question
- If they say "I'm not sure", "skip", "I don't know", or similar — accept gracefully and move on
- After 5–8 exchanges you will have enough information

When you have gathered sufficient information (or after 8 of your turns), close your final natural response with exactly:
[CONVERSATION_COMPLETE]

Do not announce that you're done. Just include [CONVERSATION_COMPLETE] silently at the very end.`;
}

export async function POST(req: NextRequest) {
  const { intake, messages } = (await req.json()) as {
    intake: IntakeFormData;
    messages: ConversationMessage[];
  };

  const systemPrompt = buildSystemPrompt(intake);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.messages.stream({
          model: "claude-opus-4-8",
          max_tokens: 512,
          system: systemPrompt,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

        for await (const chunk of response) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`
              )
            );
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "AI response failed" })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
