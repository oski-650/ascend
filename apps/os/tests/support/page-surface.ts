// tests/support/page-surface — RENDERING A PAGE INSIDE NEXT'S OWN REQUEST SCOPE
// (STAGE2G §29.6/§29.7, slice 2G.4.3).
//
// ─── WHY THIS IS NOT A MOCK OF `cookies()` ─────────────────────────────────────────────────────
//
// `lib/page-principal.ts`'s `pageAuthority()` calls the REAL `cookies()` from `next/headers`. Every
// earlier page suite in this repository (`page-principal.test.ts`, `f51-page-demand.test.ts`,
// `page-denial.test.ts`) made that call succeed by replacing it with `vi.mock("next/headers", …)` —
// which proves the code downstream of a cookie value, never that the cookie is reachable from
// Next's own machinery at all. This slice's whole thesis is that a row in `memberships` decides the
// verdict; substituting the read that finds the cookie would make that thesis untestable by
// construction. So this file enters Next's REAL work store and work-unit store instead, and
// `cookies()` runs unmodified.
//
// ─── THE PREREQUISITE THAT MAKES IT POSSIBLE ───────────────────────────────────────────────────
//
// `next/dist/server/app-render/async-local-storage.js` captures `globalThis.AsyncLocalStorage` AT
// MODULE-EVALUATION TIME and installs a throwing `FakeAsyncLocalStorage` when it is absent. Under
// Node, `AsyncLocalStorage` is an export of `node:async_hooks`, not a global — so every earlier
// attempt to reach this store found `workAsyncStorage`/`workUnitAsyncStorage` permanently broken and
// concluded the seam was unreachable in-process. `vi.hoisted()` runs before this file's own imports
// evaluate, which is early enough: assigning the real constructor there makes both stores real
// `AsyncLocalStorage` instances instead of the throwing fake.
vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require("node:async_hooks") as typeof import("node:async_hooks");
  (globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage ??= AsyncLocalStorage;
});

import { vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";
import { RequestCookiesAdapter } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { HeadersAdapter } from "next/dist/server/web/spec-extension/adapters/headers";
import {
  AppRouterContext, type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  getAccessFallbackHTTPStatus, isHTTPAccessFallbackError,
} from "next/dist/client/components/http-access-fallback/http-access-fallback";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getRedirectStatusCodeFromError, getURLFromRedirectError } from "next/dist/client/components/redirect";
import { SESSION_COOKIE } from "@/lib/auth";
import { AccountRefused, CapabilityDenied, NoAuthority } from "@/core/auth/authority";
import { AccountInactive } from "@/components/auth/AccountInactive";
import { Denied } from "@/components/auth/Denied";
// BINDING (the plan's own load-bearing requirement): this module must import at least one symbol
// from `tests/support/provisioned-partner`, so F59's `EVIDENCE_PATH` scan — which walks the import
// graph FROM that module's importers, not TO it — reaches this file. `World` is imported for its
// type only; nothing here constructs one.
import type { World } from "@/tests/support/provisioned-partner";
export type { World };

// ─── THE CORPUS, DERIVED FROM THE FILESYSTEM ───────────────────────────────────────────────────
//
// BINDING: no hand-written page list. `import.meta.glob` returns one lazy importer per matched file,
// keyed by its project-root-relative path (`/app/admin/page.tsx`, …) — stripped below to the same
// keys `PAGE_AUTHORIZATION` uses (`admin`, root `/`).
const globbed = import.meta.glob("/app/**/page.tsx") as Record<string, () => Promise<Record<string, unknown>>>;

function keyFor(globPath: string): string {
  const rel = globPath.replace(/^\/app\//, "");
  return rel === "page.tsx" ? "/" : rel.replace(/\/page\.tsx$/, "");
}

export const PAGE_KEYS: Record<string, () => Promise<Record<string, unknown>>> = Object.fromEntries(
  Object.entries(globbed).map(([globPath, importer]) => [keyFor(globPath), importer])
);

/**
 * Pages that are `"use client"`, DERIVED by reading each file's own source rather than maintained by
 * hand — the same reason `PAGE_KEYS` itself is derived. A client component cannot be called as a
 * plain function (its hooks require an active React render), so it is rendered through
 * `AppRouterContext.Provider` instead of `await`ed directly.
 */
export const CLIENT_PAGE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(globbed)
    .filter((globPath) => {
      const abs = path.join(process.cwd(), globPath);
      const src = fs.readFileSync(abs, "utf8");
      return /^\s*["']use client["']/m.test(src);
    })
    .map(keyFor)
);

/** A no-op router. Its methods are never invoked during an initial, static render. */
const STUB_ROUTER: AppRouterInstance = {
  back: () => {}, forward: () => {}, refresh: () => {},
  push: () => {}, replace: () => {}, prefetch: () => {},
  bfcacheId: "page-surface-stub",
};

// ─── ENTERING NEXT'S OWN REQUEST SCOPE ─────────────────────────────────────────────────────────

/**
 * Run `fn` inside a real `workAsyncStorage` + `workUnitAsyncStorage` (`type: "request"`) pair, with
 * `cookies()` able to read `SESSION_COOKIE` carrying `token` off a real `Headers`/`RequestCookies`
 * object — never a stand-in for either.
 *
 * `.headers` is populated too — MEASURED, not assumed: `app/admin/invitations/page.tsx` and
 * `app/clients/[slug]/portal/page.tsx` both call `headers()` directly, and
 * `next/dist/server/request/headers.js`'s `type: "request"` branch reads `workUnitStore.headers`
 * unconditionally to build its own tracking `WeakMap` key — leaving it `undefined` throws "Invalid
 * value used as weak map key" from inside `next/headers` itself, not from either page. `.mutableCookies`
 * / `.userspaceMutableCookies` are the one pair genuinely never read on this path: `.phase` is
 * `"render"`, so `areCookiesMutableInCurrentPhase` is false and `cookies()` only ever touches
 * `.cookies`. `RequestStore`'s remaining fields (`url`, `draftMode`, `rootParams`, `resumeDataCache`,
 * `implicitTags`, …) satisfy internals no page under test reaches — nothing here calls `draftMode()`
 * or a root param outside its own `params` prop — so those are left untyped (`as unknown as …`)
 * rather than fabricated to match an interface this harness never exercises.
 */
export function withPageRequest<T>(token: string | undefined, route: string, fn: () => Promise<T>): Promise<T> {
  const rawHeaders = new Headers();
  if (token !== undefined) rawHeaders.set("cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}`);
  const cookies = RequestCookiesAdapter.seal(new RequestCookies(rawHeaders));
  const headers = HeadersAdapter.seal(rawHeaders);

  const workStore = { route, forceStatic: false, dynamicShouldError: false } as
    Parameters<typeof workAsyncStorage.run>[0];
  const requestStore = {
    type: "request",
    phase: "render",
    cookies,
    mutableCookies: cookies,
    userspaceMutableCookies: cookies,
    headers,
  } as unknown as Parameters<typeof workUnitAsyncStorage.run>[0];

  return workAsyncStorage.run(workStore, () => workUnitAsyncStorage.run(requestStore, fn));
}

// ─── THE VERDICT ────────────────────────────────────────────────────────────────────────────────

/**
 * Exhaustive. `denied` and `rendered` both carry markup so a caller can inspect either — I7 needs
 * the DENIED markup, Fact A needs the RENDERED markup compared byte-for-byte across roles.
 */
export type PageVerdict =
  | { kind: "denied"; html: string }
  /**
   * The `AccountInactive` surface (2G.4.5) — the database ANSWERED and the answer denies this
   * person. Distinct from `unauthorized`, which is now exactly the UNANSWERED half: an outage, an
   * unbound resolver, or a caller nobody could identify. Before the split both produced
   * `unauthorized` and only the free-form `reason` separated them.
   */
  | { kind: "inactive"; html: string }
  | { kind: "rendered"; html: string }
  /**
   * An authority refusal that escaped UNCAUGHT — a `CapabilityDenied`, or (2G.4.5) an
   * `AccountRefused`. Every wrapped page converts both, so this arm reaching a page means that page
   * is not wrapped, not that the boundary failed.
   */
  | { kind: "refused"; error: unknown }
  /** A `NoAuthority` thrown and never converted — the outcome a revoked or unresolvable session produces. */
  | { kind: "unauthorized"; reason: string }
  | { kind: "redirect"; digest: string; target: string; status: number }
  | { kind: "notFound" }
  | { kind: "error"; error: unknown };

const isDenied = (el: unknown): boolean =>
  typeof el === "object" && el !== null && (el as ReactElement).type === Denied;

/** STRUCTURAL, exactly like `isDenied` — the element's type, never a string in its markup. */
const isInactive = (el: unknown): boolean =>
  typeof el === "object" && el !== null && (el as ReactElement).type === AccountInactive;

/**
 * Render `el` to static markup with a mounted `AppRouterContext` in scope. Every rendered element
 * goes through this — a SERVER page's own top-level element is not itself a Client Component, but
 * it composes ones that call `useRouter()` during THEIR render, which only happens here.
 */
function renderStatic(el: unknown): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: STUB_ROUTER }, el as ReactNode)
  );
}

function classifyThrown(err: unknown): PageVerdict {
  // Framework control flow FIRST — `redirect()` and `notFound()` work by throwing, exactly as
  // `components/auth/renderOrDenied.tsx`'s own header warns.
  if (isRedirectError(err)) {
    return {
      kind: "redirect",
      digest: err.digest,
      // Parsed from the digest via Next's own helper, never a hardcoded string comparison.
      target: getURLFromRedirectError(err),
      status: getRedirectStatusCodeFromError(err),
    };
  }
  if (isHTTPAccessFallbackError(err) && getAccessFallbackHTTPStatus(err) === 404) {
    return { kind: "notFound" };
  }
  // BEFORE the `NoAuthority` arm — `AccountRefused` extends it, so order decides which one answers.
  // An escaping `AccountRefused` is a page that was never wrapped; `unauthorized` is now exactly the
  // UNANSWERED half (outage, unbound resolver, unidentifiable caller), and conflating the two here
  // would hide the distinction this slice exists to draw.
  if (err instanceof AccountRefused) return { kind: "refused", error: err };
  if (err instanceof NoAuthority) return { kind: "unauthorized", reason: err.reason };
  if (err instanceof CapabilityDenied) return { kind: "refused", error: err };
  return { kind: "error", error: err };
}

/** Every dynamic segment this app uses, over-supplied so one call site serves every page. */
export const DEFAULT_PARAMS = {
  slug: "acme-co", client: "acme-co", prospect: "lead-one",
  id: "doc-fixture-1", token: "no-such-token", reqId: "no-such-request",
};

export function propsFor(searchParams: Record<string, string> = {}): { params: Promise<typeof DEFAULT_PARAMS>; searchParams: Promise<Record<string, string>> } {
  return { params: Promise.resolve(DEFAULT_PARAMS), searchParams: Promise.resolve(searchParams) };
}

/**
 * Render page `key` under a session carrying `token` (or no cookie at all when `token` is
 * `undefined` — used only where the matrix itself needs an anonymous CONTROL, never as an exposure
 * claim: see the suite's own header on why an anonymous render says nothing about production).
 */
export async function renderPage(
  key: string,
  token: string | undefined,
  props: { params: Promise<unknown>; searchParams: Promise<unknown> } = propsFor()
): Promise<PageVerdict> {
  const importer = PAGE_KEYS[key];
  if (!importer) throw new Error(`page-surface: no importer registered for "${key}"`);

  return withPageRequest(token, key, async () => {
    try {
      const mod = await importer();
      let el: unknown;
      if (CLIENT_PAGE_KEYS.has(key)) {
        const ClientPage = mod.default as (p: Record<string, unknown>) => ReactElement;
        el = createElement(ClientPage, props as unknown as Record<string, unknown>);
        // React only runs a Client Component's body during an actual render pass — a thrown
        // `CapabilityDenied`/redirect/notFound from a hook body surfaces during `renderToStaticMarkup`
        // below, not here.
      } else {
        const ServerPage = mod.default as (p: unknown) => Promise<unknown>;
        el = await ServerPage(props);
        if (isDenied(el)) return { kind: "denied", html: renderStatic(el) };
        if (isInactive(el)) return { kind: "inactive", html: renderStatic(el) };
      }
      // EVERY render is wrapped, not only a top-level Client Component: a SERVER page can compose
      // nested Client Components (`AddInvoiceForm`, `CopyTextButton`, …) that call `useRouter()`
      // during their own render pass, which is exactly when `renderToStaticMarkup` reaches them —
      // never during the `await ServerPage(props)` step above. Measured: omitting this wrapper for
      // server pages throws "invariant expected app router to be mounted" from `finance`,
      // `documents`, `/`, `maintenance`, `sales` and `tasks`.
      return { kind: "rendered", html: renderStatic(el) };
    } catch (err) {
      return classifyThrown(err);
    }
  });
}
