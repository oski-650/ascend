"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CornerDownLeft, Loader2 } from "lucide-react";
import { JarvisOrb } from "./JarvisOrb";

type Line = { kind: "in" | "out" | "err" | "sys"; text: string };

const URL_RX = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)\b/i;

function inferCommand(raw: string): string | null {
  const s = raw.toLowerCase().trim();
  const stripped = s.replace(/^(hey\s+)?jarvis[,\s:]+/i, "").trim();
  const orig = raw.replace(/^(hey\s+)?jarvis[,\s:]+/i, "").trim();

  const urlMatch = orig.match(URL_RX);
  if (urlMatch && /audit|score|check|review|analy[sz]e|test/i.test(stripped)) {
    return `/audit ${urlMatch[1].startsWith("http") ? urlMatch[1] : "https://" + urlMatch[1]}`;
  }
  if (urlMatch && /audit/i.test(stripped)) {
    return `/audit ${urlMatch[1].startsWith("http") ? urlMatch[1] : "https://" + urlMatch[1]}`;
  }

  const findMatch = stripped.match(/^(?:find|search|lookup|look\s+up|locate|show\s+me)\s+(.+)/);
  if (findMatch) return `/find ${findMatch[1].trim()}`;

  const openMatch = stripped.match(/^(?:open|show|go\s+to|pull\s+up|navigate\s+to|take\s+me\s+to)\s+(.+)/);
  if (openMatch) return `/open ${openMatch[1].trim().replace(/\s+/g, "-")}`;

  const promoteMatch = stripped.match(/^(?:promote|convert|win)\s+(.+?)(?:\s+to\s+client)?$/);
  if (promoteMatch) return `/promote ${promoteMatch[1].trim().replace(/\s+/g, "-")}`;

  if (/(?:brief|what should i|what.*do today|morning|status report|status update|debrief)/.test(stripped)) {
    return "/brief";
  }
  if (/^(?:help|what can you do|commands|menu|options)$/.test(stripped)) return "/help";
  if (/^(?:clear|reset(?:\s+terminal)?|wipe(?:\s+terminal)?|clean\s+up)$/.test(stripped)) return "/clear";

  return null;
}

const QUICK_COMMANDS = [
  { label: "/audit <url>", desc: "Score a prospect site" },
  { label: "/find <query>", desc: "Search documents" },
  { label: "/brief", desc: "Daily operator brief" },
  { label: "/open <slug>", desc: "Jump to a record" },
  { label: "/help", desc: "Full command list" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // ─── Global ⌘K / Ctrl+K trigger + Esc close ────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((s) => !s);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    // Also respond to programmatic open requests from anywhere
    function onOpenRequest() {
      setOpen(true);
    }
    window.addEventListener("jarvis:open", onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("jarvis:open", onOpenRequest);
    };
  }, [open]);

  // Focus the input every time it opens
  useEffect(() => {
    if (open) {
      // small delay to let the AnimatePresence mount the input first
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Auto-scroll output area
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);

  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  const appendLines = useCallback((...newLines: Line[]) => {
    setLines((prev) => [...prev, ...newLines]);
  }, []);

  const dispatch = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      appendLines({ kind: "in", text: `> ${trimmed}` });

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
        case "help":
          appendLines(
            { kind: "out", text: "Of course." },
            { kind: "out", text: "  /audit <url>      — Score a prospect site" },
            { kind: "out", text: "  /find <query>     — Search across documents" },
            { kind: "out", text: "  /brief            — Daily operator brief" },
            { kind: "out", text: "  /open <slug>      — Jump to a client or prospect" },
            { kind: "out", text: "  /promote <slug>   — Begin promoting a prospect" },
            { kind: "out", text: "  /clear            — Clear the terminal" }
          );
          break;

        case "clear":
          setLines([{ kind: "sys", text: "Cleared." }]);
          break;

        case "audit": {
          if (!arg) {
            appendLines({ kind: "err", text: "I'll need a URL, sir. /audit https://example.com" });
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
              ok?: boolean; slug?: string; name?: string;
              psi_performance?: number | null; website_quality?: string;
              error?: string; message?: string;
            };
            if (!res.ok || !json.ok) {
              appendLines({
                kind: "err",
                text: `I'm afraid the audit didn't complete, sir. ${json.error ?? json.message ?? "Unknown error."}`,
              });
            } else {
              // Normalise undefined → null so the `perf === null` branch below narrows correctly.
            const perf: number | null = json.psi_performance ?? null;
              const tone =
                perf === null ? "No Lighthouse scores this time, but the record is in." :
                perf >= 90 ? "Their site is in excellent shape." :
                perf >= 50 ? "Clear room for improvement." :
                "Performance is rough — strong pitch opportunity.";
              appendLines(
                { kind: "out", text: `Done. ${json.name} is on your hit list.` },
                { kind: "out", text: `  Performance ${perf ?? "—"}/100 · quality ${json.website_quality} · slug ${json.slug}` },
                { kind: "out", text: `  ${tone}` },
                { kind: "sys", text: `Full file at /sales/${json.slug}.` }
              );
            }
          } catch (e) {
            appendLines({ kind: "err", text: `I encountered a problem, sir: ${e instanceof Error ? e.message : String(e)}` });
          } finally {
            setBusy(false);
          }
          break;
        }

        case "find": {
          if (!arg) {
            appendLines({ kind: "err", text: "What should I search for, sir? /find pilar" });
            break;
          }
          setBusy(true);
          try {
            const res = await fetch(`/api/documents?search=${encodeURIComponent(arg)}`, { cache: "no-store" });
            const json = (await res.json()) as { documents?: { meta: { doc_id: string; title: string; client: string } }[] };
            const hits = (json.documents ?? []).slice(0, 5);
            if (hits.length === 0) {
              appendLines({ kind: "out", text: `Nothing matching "${arg}", sir.` });
            } else {
              appendLines(
                { kind: "out", text: `${hits.length} document${hits.length === 1 ? "" : "s"} matching "${arg}":` },
                ...hits.map((d) => ({ kind: "out" as const, text: `  · ${d.meta.title}  →  /documents/${d.meta.doc_id}` }))
              );
            }
          } catch (e) {
            appendLines({ kind: "err", text: `Search failed: ${e instanceof Error ? e.message : String(e)}` });
          } finally {
            setBusy(false);
          }
          break;
        }

        case "brief":
          appendLines(
            { kind: "out", text: "Compiling your brief now." },
            { kind: "sys", text: "Routing to /signals — your brief is ready under the 🧭 button." }
          );
          setOpen(false);
          router.push("/signals");
          break;

        case "open":
          if (!arg) {
            appendLines({ kind: "err", text: "Which record, sir? /open <slug>" });
            break;
          }
          appendLines({ kind: "out", text: `Opening /sales/${arg}.` });
          setOpen(false);
          router.push(`/sales/${arg}`);
          break;

        case "promote":
          if (!arg) {
            appendLines({ kind: "err", text: "Which prospect, sir? /promote <slug>" });
            break;
          }
          appendLines({ kind: "out", text: `Routing to ${arg}. The promote button's at the top.` });
          setOpen(false);
          router.push(`/sales/${arg}`);
          break;

        default:
          appendLines({ kind: "err", text: `I don't recognize "${cmd}". /help for the menu.` });
      }
    },
    [appendLines, router]
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    dispatch(input);
    setInput("");
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-md sm:pt-[16vh]"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="glass-hi scanlines w-full max-w-2xl overflow-hidden rounded-2xl shadow-[0_24px_80px_-12px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top: orb + identity + Esc hint */}
            <div className="flex items-center gap-3 border-b border-zinc-800/50 px-5 py-4">
              <JarvisOrb size={42} state={busy ? "processing" : "idle"} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-400">
                  <span
                    className={`inline-block size-1.5 rounded-full ${
                      busy
                        ? "bg-[var(--color-system)] shadow-[0_0_6px_var(--color-system)] hud-pulse"
                        : "bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] hud-pulse"
                    }`}
                  />
                  JARVIS · {busy ? "working" : "ready"}
                </p>
                <p className="mt-0.5 font-mono text-[9px] text-zinc-600">at your service</p>
              </div>
              <kbd className="hidden rounded border border-zinc-800/60 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-zinc-500 sm:inline">
                Esc
              </kbd>
            </div>

            {/* Input — the marquee */}
            <form onSubmit={onSubmit} className="flex items-center gap-3 border-b border-zinc-800/50 px-5 py-4">
              <span className="font-mono text-lg text-[var(--color-accent)]">▸</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={busy}
                placeholder="What can I do for you, sir?"
                className="flex-1 bg-transparent text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label="Submit command"
                className="text-zinc-500 hover:text-[var(--color-accent)] disabled:opacity-30"
              >
                <CornerDownLeft className="size-4" strokeWidth={1.8} />
              </button>
            </form>

            {/* Output (only shows when there's history) */}
            {lines.length > 0 && (
              <div
                ref={outputRef}
                className="max-h-[280px] overflow-y-auto px-5 py-3 font-mono text-[11px] leading-relaxed"
              >
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.kind === "in" ? "text-[var(--color-accent)]"
                      : line.kind === "err" ? "text-[var(--color-danger)]"
                      : line.kind === "sys" ? "text-zinc-500"
                      : "text-zinc-200"
                    }
                  >
                    {line.text}
                  </div>
                ))}
                {busy && (
                  <div className="mt-1 flex items-center gap-1.5 text-[var(--color-system)]">
                    <Loader2 className="size-3 animate-spin" strokeWidth={2} />
                    <span>Working on it, sir…</span>
                  </div>
                )}
              </div>
            )}

            {/* Quick commands hint (only when empty) */}
            {lines.length === 0 && (
              <div className="px-5 py-3">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-zinc-600">quick commands</p>
                <ul className="flex flex-col gap-1">
                  {QUICK_COMMANDS.map((c) => (
                    <li key={c.label} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          setInput(c.label.split(" ")[0] + " ");
                          inputRef.current?.focus();
                        }}
                        className="text-zinc-300 hover:text-[var(--color-accent)]"
                      >
                        {c.label}
                      </button>
                      <span className="text-zinc-600">{c.desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Footer hint bar */}
            <div className="flex items-center justify-between border-t border-zinc-800/50 bg-zinc-950/40 px-5 py-2 font-mono text-[9px] uppercase tracking-widest text-zinc-600">
              <span>or speak naturally: &quot;audit example.com&quot;</span>
              <span className="hidden sm:inline">
                <kbd className="rounded border border-zinc-800/60 px-1 py-0.5">⌘K</kbd> toggle
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
