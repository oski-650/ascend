"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CornerDownLeft, Loader2 } from "lucide-react";
import { JarvisOrb } from "./JarvisOrb";

export type Line = { kind: "in" | "out" | "err" | "sys"; text: string };

type Command = {
  name: string;
  signature: string;
  desc: string;
};

const COMMANDS: Command[] = [
  { name: "audit",   signature: "/audit <url>",       desc: "Intake a URL as a new prospect — I'll fetch the site, run Lighthouse, and score them." },
  { name: "find",    signature: "/find <query>",      desc: "Search your clients, prospects, and documents." },
  { name: "brief",   signature: "/brief",             desc: "Compile your daily operator brief." },
  { name: "open",    signature: "/open <slug>",       desc: "Take you to a client or prospect record." },
  { name: "promote", signature: "/promote <slug>",    desc: "Begin promoting a prospect to a CRM client." },
  { name: "help",    signature: "/help",              desc: "Show what I can do for you." },
  { name: "clear",   signature: "/clear",             desc: "Clear the terminal." },
];

const DEFAULT_LINES: Line[] = [
  { kind: "sys", text: "JARVIS online · Ascend OS at your service." },
  { kind: "sys", text: "Type /help if you'd like the menu." },
];

// ─── NLI router ────────────────────────────────────────────────────────────
const URL_RX = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)\b/i;

function inferCommand(raw: string): string | null {
  const s = raw.toLowerCase().trim();

  // Strip a leading "jarvis," / "jarvis " / "hey jarvis" address
  const stripped = s.replace(/^(hey\s+)?jarvis[,\s:]+/i, "").trim();
  const orig = raw.replace(/^(hey\s+)?jarvis[,\s:]+/i, "").trim();

  // URL anywhere in the string → audit
  const urlMatch = orig.match(URL_RX);
  if (urlMatch && /audit|score|check|review|analy[sz]e|test/i.test(stripped)) {
    return `/audit ${urlMatch[1].startsWith("http") ? urlMatch[1] : "https://" + urlMatch[1]}`;
  }
  if (urlMatch && /audit/i.test(stripped)) {
    return `/audit ${urlMatch[1].startsWith("http") ? urlMatch[1] : "https://" + urlMatch[1]}`;
  }

  // "find / search / lookup X"
  const findMatch = stripped.match(/^(?:find|search|lookup|look\s+up|locate|show\s+me)\s+(.+)/);
  if (findMatch) return `/find ${findMatch[1].trim()}`;

  // "open / show / go to / pull up <slug>"
  const openMatch = stripped.match(/^(?:open|show|go\s+to|pull\s+up|navigate\s+to|take\s+me\s+to)\s+(.+)/);
  if (openMatch) {
    const target = openMatch[1].trim().replace(/\s+/g, "-");
    return `/open ${target}`;
  }

  // "promote <slug> [to client]"
  const promoteMatch = stripped.match(/^(?:promote|convert|win)\s+(.+?)(?:\s+to\s+client)?$/);
  if (promoteMatch) {
    const target = promoteMatch[1].trim().replace(/\s+/g, "-");
    return `/promote ${target}`;
  }

  // "brief / give me the brief / what should I do today / morning brief"
  if (/(?:brief|what should i|what.*do today|morning|status report|status update|debrief)/.test(stripped)) {
    return "/brief";
  }

  // "help / what can you do / commands"
  if (/^(?:help|what can you do|commands|menu|options)$/.test(stripped)) {
    return "/help";
  }

  // "clear / reset terminal / wipe"
  if (/^(?:clear|reset(?:\s+terminal)?|wipe(?:\s+terminal)?|clean\s+up)$/.test(stripped)) {
    return "/clear";
  }

  return null;
}

export function HoloTerminal({ initialLines }: { initialLines?: Line[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(initialLines && initialLines.length > 0 ? initialLines : DEFAULT_LINES);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new output
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function appendLines(...newLines: Line[]) {
    setLines((prev) => [...prev, ...newLines]);
  }

  async function dispatch(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    appendLines({ kind: "in", text: `> ${trimmed}` });

    // ─── Natural-language fallback ───────────────────────────────────────
    // If the user didn't prefix with /, try to infer their intent before
    // hitting the command parser.
    let routed = trimmed;
    if (!routed.startsWith("/")) {
      const interpreted = inferCommand(routed);
      if (interpreted) {
        appendLines({ kind: "sys", text: `Interpreting as: ${interpreted}` });
        routed = interpreted;
      } else {
        appendLines({
          kind: "out",
          text: "I'm not sure how to handle that, sir. Try /help — or rephrase with an action verb (audit, find, open).",
        });
        return;
      }
    }

    const [cmd, ...rest] = routed.replace(/^\//, "").split(/\s+/);
    const arg = rest.join(" ").trim();

    switch (cmd.toLowerCase()) {
      case "help": {
        appendLines(
          { kind: "out", text: "Of course." },
          ...COMMANDS.map((c) => ({ kind: "out" as const, text: `  ${c.signature.padEnd(28)} — ${c.desc}` }))
        );
        break;
      }
      case "clear": {
        setLines([{ kind: "sys", text: "Cleared." }]);
        break;
      }
      case "audit": {
        if (!arg) {
          appendLines({ kind: "err", text: "I'll need a URL for that, sir. Try: /audit https://example.com" });
          break;
        }
        setBusy(true);
        appendLines({ kind: "out", text: `Running audit on ${arg}. 15-30 seconds.` });
        try {
          const res = await fetch("/api/prospects/from-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: arg, run_psi: true }),
          });
          const json = (await res.json()) as {
            ok?: boolean;
            slug?: string;
            name?: string;
            psi_performance?: number | null;
            website_quality?: string;
            error?: string;
            message?: string;
          };
          if (!res.ok || !json.ok) {
            appendLines({
              kind: "err",
              text: `I'm afraid the audit didn't complete, sir. ${json.error ?? json.message ?? "Unknown error."}`,
            });
          } else {
            const perf = json.psi_performance;
            const tone =
              perf === null
                ? "I couldn't get Lighthouse scores this time, but the record is in."
                : perf >= 90
                  ? "Their site is in excellent shape."
                  : perf >= 50
                    ? "There's clear room for improvement on their end."
                    : "Their performance is rough — likely a strong pitch opportunity.";
            appendLines(
              { kind: "out", text: `Done. ${json.name} is on your hit list.` },
              {
                kind: "out",
                text: `  Performance ${perf ?? "—"}/100 · quality ${json.website_quality} · slug ${json.slug}`,
              },
              { kind: "out", text: `  ${tone}` },
              { kind: "sys", text: `Full file at /sales/${json.slug}.` }
            );
          }
        } catch (e) {
          appendLines({
            kind: "err",
            text: `I encountered a problem, sir: ${e instanceof Error ? e.message : String(e)}`,
          });
        } finally {
          setBusy(false);
        }
        break;
      }
      case "find": {
        if (!arg) {
          appendLines({ kind: "err", text: "What should I search for? Try: /find pilar" });
          break;
        }
        setBusy(true);
        try {
          const docsRes = await fetch(`/api/documents?search=${encodeURIComponent(arg)}`, { cache: "no-store" });
          const docs = (await docsRes.json()) as { documents?: { meta: { doc_id: string; title: string; client: string } }[] };
          const docHits = (docs.documents ?? []).slice(0, 5);
          if (docHits.length === 0) {
            appendLines({ kind: "out", text: `Nothing matching "${arg}", sir.` });
          } else {
            appendLines(
              { kind: "out", text: `${docHits.length} document${docHits.length === 1 ? "" : "s"} matching "${arg}":` },
              ...docHits.map((d) => ({
                kind: "out" as const,
                text: `  · ${d.meta.title}  →  /documents/${d.meta.doc_id}`,
              }))
            );
          }
          appendLines({ kind: "sys", text: "Document search only for now. /open <slug> for direct navigation." });
        } catch (e) {
          appendLines({ kind: "err", text: `Search failed: ${e instanceof Error ? e.message : String(e)}` });
        } finally {
          setBusy(false);
        }
        break;
      }
      case "brief": {
        setBusy(true);
        try {
          appendLines(
            { kind: "out", text: "Compiling your brief now." },
            { kind: "sys", text: "Routing to /signals — your brief is ready under the 🧭 button." }
          );
          router.push("/signals");
        } finally {
          setBusy(false);
        }
        break;
      }
      case "open": {
        if (!arg) {
          appendLines({ kind: "err", text: "Which record, sir? /open <slug>" });
          break;
        }
        const target = `/sales/${arg}`;
        appendLines({ kind: "out", text: `Opening ${target}.` });
        router.push(target);
        break;
      }
      case "promote": {
        if (!arg) {
          appendLines({ kind: "err", text: "Which prospect, sir? /promote <slug>" });
          break;
        }
        appendLines({ kind: "out", text: `Routing to ${arg}'s record. The promote button's at the top.` });
        router.push(`/sales/${arg}`);
        break;
      }
      default: {
        appendLines({
          kind: "err",
          text: `I don't recognize "${cmd}". /help for the menu.`,
        });
      }
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    void dispatch(input);
    setInput("");
  }

  return (
    <div className="glass-hi scanlines flex h-full flex-col overflow-hidden rounded-xl">
      {/* Header — orb + identity */}
      <div className="flex items-center gap-3 border-b border-zinc-800/50 px-4 py-3">
        <JarvisOrb size={56} state={busy ? "processing" : "idle"} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <span
              className={`inline-block size-1.5 rounded-full ${
                busy
                  ? "bg-[var(--color-system)] shadow-[0_0_6px_var(--color-system)] hud-pulse"
                  : "bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] hud-pulse"
              }`}
            />
            JARVIS · {busy ? "working" : "online"}
          </p>
          <p className="mt-0.5 font-mono text-[9px] text-zinc-600">
            ascend OS · always at your service
          </p>
        </div>
        <span className="shrink-0 self-start font-mono text-[9px] uppercase tracking-widest text-zinc-600">/help</span>
      </div>

      {/* Output area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed"
        style={{ minHeight: "200px" }}
      >
        <AnimatePresence initial={false}>
          {lines.map((line, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className={
                line.kind === "in"
                  ? "text-[var(--color-accent)]"
                  : line.kind === "err"
                    ? "text-[var(--color-danger)]"
                    : line.kind === "sys"
                      ? "text-zinc-500"
                      : "text-zinc-200"
              }
            >
              {line.text}
            </motion.div>
          ))}
          {busy && (
            <motion.div
              key="busy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1.5 text-[var(--color-system)]"
            >
              <Loader2 className="size-3 animate-spin" strokeWidth={2} />
              <span>Working on it, sir…</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-zinc-800/50 px-4 py-2.5">
        <span className="font-mono text-xs text-[var(--color-accent)]">▸</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder='At your service. /help, or talk plainly — "audit bayareacustomshirts.com"'
          className="flex-1 bg-transparent font-mono text-xs text-zinc-100 placeholder:text-zinc-700 focus:outline-none disabled:opacity-50"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Submit command"
          className="text-zinc-500 hover:text-[var(--color-accent)] disabled:opacity-30"
        >
          <CornerDownLeft className="size-3.5" strokeWidth={1.8} />
        </button>
      </form>
    </div>
  );
}
