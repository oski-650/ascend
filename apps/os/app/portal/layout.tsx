import "../globals.css";

export const metadata = {
  title: "Ascend · Client Portal",
};

// Public-facing layout — no internal HUD nav/widgets. Cleaner, warmer presentation.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-8 flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--color-accent)]" />
          <span className="font-mono text-xs tracking-widest text-[var(--color-fg-mute)]">ASCEND · CLIENT PORTAL</span>
        </header>
        {children}
        <footer className="mt-12 border-t border-[var(--color-border-hi)] pt-4 text-center font-mono text-[10px] text-[var(--color-fg-dim)]">
          Powered by Ascend Web Solutions
        </footer>
      </div>
    </div>
  );
}
