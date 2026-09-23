"use client";

export default function SalesListError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="mx-auto max-w-xl px-5 py-16"><p className="t-label text-[var(--color-risk)]">Sales · Browse</p><h1 className="t-h2 mt-3">This list could not be loaded.</h1><p className="mt-3 text-sm text-[var(--color-t2)]">Your filters are still in the URL. Try the read again.</p><button type="button" onClick={reset} className="mt-6 inline-flex min-h-11 items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-5 text-sm text-[var(--color-t1)]">Try again</button></div>;
}
