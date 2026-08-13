"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Field = {
  key: string;
  label: string;
  placeholder: string;
  help: string;
  type: "input" | "textarea";
  rows?: number;
  optional?: boolean;
};

type Section = {
  id: string;
  title: string;
  description: string;
  fields: Field[];
  defaultOpen?: boolean;
};

const SECTIONS: Section[] = [
  {
    id: "goals",
    title: "1 · Goals & Success",
    description:
      "These three answers shape every other decision we make. Take a minute on each — even rough thoughts beat polished ones.",
    defaultOpen: true,
    fields: [
      {
        key: "success_vision",
        label: "What does success look like 6 months after launch?",
        placeholder:
          "e.g. 'We're getting 5 quote requests a week through the site (currently 1). Half of our team-order customers find us via Google instead of word of mouth.'",
        help: "Be specific about numbers if you can — orders, calls, leads, revenue.",
        type: "textarea",
        rows: 4,
      },
      {
        key: "current_frustration",
        label: "What frustrates you most about the current site?",
        placeholder:
          "e.g. 'It's slow on phones, customers can't see our work easily, the quote form is broken, etc.'",
        help: "Be honest — this tells us what NOT to repeat.",
        type: "textarea",
        rows: 3,
      },
      {
        key: "must_get_right",
        label: "If we get only ONE thing right, what should it be?",
        placeholder: "e.g. 'Make it dead-simple for someone to start a 20-shirt order online.'",
        help: "Forces priority. Helps us protect the core when we have to cut scope.",
        type: "textarea",
        rows: 3,
      },
    ],
  },
  {
    id: "customers",
    title: "2 · Your Customers",
    description: "We're designing this site for them, not for you. The clearer you can describe them, the better the design.",
    fields: [
      {
        key: "primary_customer",
        label: "Who's your primary customer?",
        placeholder:
          "e.g. 'Coaches and team managers ordering 20-50 jerseys at a time, mostly within 3 weeks of season start. Repeat buyers — same teams come back year after year.'",
        help: "Walk us through who they are, what they're trying to accomplish, what their constraints are.",
        type: "textarea",
        rows: 4,
      },
      {
        key: "customer_acquisition",
        label: "How do customers find you today?",
        placeholder:
          "e.g. 'Mostly word-of-mouth from existing coaches. Some Google searches for 'custom jerseys near me'. A few from Instagram.'",
        help: "Word of mouth, Google, Instagram, Yelp, walk-in, referrals — what's the actual mix?",
        type: "textarea",
        rows: 3,
      },
      {
        key: "why_choose_you",
        label: "Why do customers pick you over a competitor?",
        placeholder:
          "e.g. 'We turn around in 5 days when competitors quote 3 weeks. And we never charge for revisions.'",
        help: "Your real differentiators. We'll surface these on the site.",
        type: "textarea",
        rows: 3,
      },
    ],
  },
  {
    id: "functional",
    title: "3 · What the site needs to do",
    description:
      "Functional requirements. These are the biggest scope drivers — answer honestly even if you're not sure.",
    fields: [
      {
        key: "primary_action",
        label: "What's the ONE action you want a first-time visitor to take?",
        placeholder: "e.g. 'Submit a quote request with their team logo attached.'  OR  'Call us.'",
        help: "Every page on the new site will be designed to funnel toward this one thing.",
        type: "textarea",
        rows: 3,
      },
      {
        key: "ordering_flow",
        label: "Should customers be able to start an order online, or is the goal to get them to call/visit?",
        placeholder:
          "e.g. 'Online quote request is fine — we'll follow up by phone to confirm details. Don't need full e-commerce checkout. Or: yes, full online checkout for our most common products.'",
        help: "Quote form / full e-commerce / hybrid / 'just get them to call' — all valid. Drives a HUGE amount of scope.",
        type: "textarea",
        rows: 4,
      },
      {
        key: "customer_artwork",
        label: "Do customers need to upload their own artwork (logos, designs)?",
        placeholder: "e.g. 'Yes — most customers send PNG logos, occasionally PDFs. We need their files to quote.'",
        help: "Common for print shops. Affects form complexity and storage.",
        type: "textarea",
        rows: 2,
      },
      {
        key: "other_functionality",
        label: "Any other functionality you need?",
        placeholder:
          "e.g. customer accounts, order tracking, repeat-order shortcut, wholesale pricing tier, calendar booking for consults, online payment, recurring orders...",
        help: "Anything else the site needs to DO. List it all — we'll triage with you.",
        type: "textarea",
        rows: 4,
        optional: true,
      },
    ],
  },
  {
    id: "content_visual",
    title: "4 · Content, voice & visuals",
    description:
      "Everything we need to actually make the thing look and sound like you. Upload at the top, answer what you can below.",
    fields: [
      {
        key: "service_keywords",
        label: "Services / keywords",
        placeholder: "wedding planning, event design, catering, rentals…",
        help: "Words your customers actually search for. Comma-separated is fine.",
        type: "textarea",
        rows: 2,
      },
      {
        key: "service_area",
        label: "Service area",
        placeholder: "Modesto, Turlock, Stockton, surrounding Central Valley cities",
        help: "Cities or regions you serve.",
        type: "textarea",
        rows: 2,
      },
      {
        key: "brand_voice",
        label: "Brand voice in 5 words",
        placeholder: "warm · elegant · personal · trustworthy · bilingual",
        help: "How should we sound on your behalf?",
        type: "input",
      },
      {
        key: "color_preferences",
        label: "Color preferences",
        placeholder: "Earth tones — warm browns, ivory, gold accent. No bright blue.",
        help: "Hex codes welcome, or just describe the feel.",
        type: "textarea",
        rows: 2,
        optional: true,
      },
      {
        key: "logo_status",
        label: "Logo files — what do you have?",
        placeholder:
          "e.g. 'I have a vector SVG and a couple PNGs. No EPS or AI files anymore.' OR 'Just the PNG on my Facebook profile.'",
        help:
          "Vector files (SVG / AI / EPS / PDF) are best — they scale to any size. If you only have PNGs/JPGs, that's still useful information for us to plan around.",
        type: "textarea",
        rows: 2,
      },
      {
        key: "photography_plan",
        label: "Photography — what's the plan?",
        placeholder:
          "e.g. 'I have ~30 good photos of finished work on my phone. Happy to do a quick shoot of the shop.' OR 'We need stock photos — no time for a shoot.'",
        help: "Existing photos / new shoot / stock / mix. Drives whether we budget time for direction or sourcing.",
        type: "textarea",
        rows: 3,
      },
      {
        key: "copy_ownership",
        label: "Who's writing the words?",
        placeholder:
          "e.g. 'Please write everything — I'll review.' OR 'I have all the copy in a Google Doc.' OR 'I'll write the personal stuff, you write the SEO stuff.'",
        help: "Be honest. Most clients overestimate how much copy they'll deliver. We can write everything; just tell us.",
        type: "textarea",
        rows: 2,
      },
      {
        key: "inspiration_links",
        label: "Sites you like",
        placeholder:
          "https://example.com — love the photography\nhttps://another.com — clean typography",
        help: "2-5 URLs of sites whose vibe resonates with you. One per line. A short note on what specifically you like beats just the URL.",
        type: "textarea",
        rows: 4,
      },
      {
        key: "avoid_links",
        label: "Sites that miss the mark",
        placeholder: "https://busy-site.com — too cluttered, can't find anything",
        help: "Saying what you don't want is sometimes the clearest signal. Optional.",
        type: "textarea",
        rows: 2,
        optional: true,
      },
    ],
  },
  {
    id: "logistics",
    title: "5 · Logistics & technical",
    description: "The boring stuff that nonetheless prevents launch surprises.",
    fields: [
      {
        key: "deadlines",
        label: "Any hard deadlines?",
        placeholder:
          "e.g. 'Need to launch before football season — by Aug 15.' OR 'No hard deadline, but the sooner the better.'",
        help:
          "Events, seasons, contract dates, anything driving the timing. If none, say so — that's useful too.",
        type: "textarea",
        rows: 2,
      },
      {
        key: "decision_makers",
        label: "Who else weighs in on decisions?",
        placeholder: "e.g. 'My business partner — needs to approve the brand direction.' OR 'Just me.'",
        help: "Knowing this upfront prevents the 'wait, my partner doesn't like that' surprise at week 4.",
        type: "textarea",
        rows: 2,
      },
      {
        key: "existing_tools",
        label: "Tools we should know about or connect to",
        placeholder:
          "QuickBooks, Square, Mailchimp, Google Workspace, social schedulers, CRM — list whatever you actively use to run the business.",
        help: "We don't need to integrate everything, but we need to know what's in the picture so we don't break workflows.",
        type: "textarea",
        rows: 3,
        optional: true,
      },
      {
        key: "domain_email",
        label: "Domain and email setup",
        placeholder:
          "e.g. 'Domain is on GoDaddy. Email is just yourname@gmail.com.' OR 'Domain registered through Wix. Email is on Google Workspace.'",
        help: "We'll need access to the domain to launch. Tell us where it lives and who has the login.",
        type: "textarea",
        rows: 2,
      },
    ],
  },
  {
    id: "catchall",
    title: "6 · Anything else",
    description: "Free space for whatever didn't fit above.",
    fields: [
      {
        key: "notes",
        label: "Anything else we should know?",
        placeholder:
          "Stories, quirks, history, internal politics, things we won't think to ask — anything that would help us deliver something you actually love.",
        help: "Genuinely the most valuable section for projects that turn out great.",
        type: "textarea",
        rows: 4,
        optional: true,
      },
    ],
  },
];

export function OnboardingForm({ token, clientName }: { token: string; clientName: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set("token", token);
      const res = await fetch("/api/portal/submissions", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Submission failed");
        return;
      }
      router.push(`/portal/${token}/thanks`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4">
      {/* Files block — always at top, always visible (most important asset capture) */}
      <section className="rounded-xl border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-5 sm:p-7">
        <h2 className="mb-1 text-base font-semibold text-[var(--color-fg)]">📎 Files &amp; brand assets</h2>
        <p className="mb-4 text-sm text-[var(--color-fg-mute)]">
          Drop in your logo (vector preferred — SVG/AI/EPS/PDF), reference photography, brand guidelines, existing copy
          docs, mockups — anything you have on hand. Don&apos;t worry about being organized; we&apos;ll sort it.
        </p>
        <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-border-hi)] bg-[var(--color-bg)] px-4 py-8 text-center text-sm text-[var(--color-fg-mute)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hi)]">
          <span className="text-2xl">📎</span>
          <span>Click or drag files here</span>
          <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">25MB per file · 100MB total</span>
          <input
            type="file"
            name="files[]"
            multiple
            className="sr-only"
            onChange={(e) => setFileCount(e.target.files?.length ?? 0)}
          />
        </label>
        {fileCount > 0 && (
          <p className="mt-2 font-mono text-xs text-[var(--color-accent)]">
            ✓ {fileCount} file{fileCount === 1 ? "" : "s"} selected
          </p>
        )}
      </section>

      {/* Collapsible question sections */}
      {SECTIONS.map((section) => (
        <details
          key={section.id}
          open={section.defaultOpen}
          className="group rounded-xl border border-[var(--color-border-hi)] bg-[var(--color-surface)] open:bg-[var(--color-surface)] [&[open]>summary>span.toggle]:rotate-90"
        >
          <summary className="flex cursor-pointer items-start justify-between gap-3 p-5 sm:p-7 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-fg)]">
                <span className="toggle inline-block text-[var(--color-accent)] transition-transform">▸</span>
                {section.title}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-fg-mute)]">{section.description}</p>
            </div>
            <span className="shrink-0 self-center font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
              {section.fields.length} q
            </span>
          </summary>
          <div className="flex flex-col gap-5 border-t border-[var(--color-border-hi)] p-5 sm:p-7">
            {section.fields.map((f) => (
              <div key={f.key} className="flex flex-col gap-2">
                <div>
                  <label htmlFor={f.key} className="text-sm font-semibold text-[var(--color-fg)]">
                    {f.label}{" "}
                    {f.optional && (
                      <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                        · optional
                      </span>
                    )}
                  </label>
                  <p className="mt-0.5 text-xs text-[var(--color-fg-mute)]">{f.help}</p>
                </div>
                {f.type === "textarea" ? (
                  <textarea
                    id={f.key}
                    name={f.key}
                    placeholder={f.placeholder}
                    rows={f.rows ?? 3}
                    className="w-full rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-dim)]/70 focus:border-[var(--color-accent)]"
                  />
                ) : (
                  <input
                    id={f.key}
                    type="text"
                    name={f.key}
                    placeholder={f.placeholder}
                    className="w-full rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-dim)]/70 focus:border-[var(--color-accent)]"
                  />
                )}
              </div>
            ))}
          </div>
        </details>
      ))}

      {/* Submit footer */}
      <div className="sticky bottom-4 z-40 mt-2 flex flex-col items-stretch gap-3 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-bg)]/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-5">
        {err ? (
          <p className="font-mono text-xs text-[var(--color-danger)]">{err}</p>
        ) : (
          <p className="text-xs text-[var(--color-fg-mute)]">
            Don&apos;t feel pressure to answer everything. Submit what you have — we&apos;ll fill the rest in on our
            kickoff call.
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-6 py-3 text-sm font-semibold text-[var(--color-bg)] shadow-[0_0_18px_-4px_var(--color-accent)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? `Sending…` : `Submit · ${clientName}`}
        </button>
      </div>
    </form>
  );
}
