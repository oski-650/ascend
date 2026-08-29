import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ascend OS · Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Only accept a same-site relative path as the post-login destination. An absolute URL or a
  // protocol-relative `//evil.com` would turn the login form into an open redirect.
  const safeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center">
      <div className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">ascend os</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-mute)]">
          This console has write access to the business vault. Sign in with your Ascend account.
        </p>
      </div>
      <LoginForm next={safeNext} />
    </div>
  );
}