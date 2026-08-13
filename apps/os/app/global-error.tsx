"use client";

// app/global-error.tsx — last-resort boundary for failures in the ROOT LAYOUT itself.
//
// app/error.tsx cannot catch a throw from app/layout.tsx, because the boundary lives inside that
// layout. This one replaces the whole document, so it must render its own <html>/<body>.
//
// Most relevant case: ASCEND_VAULT_PATH unset or unreadable makes vaultPath() throw during the
// layout's own reads. Without this, the operator sees a blank page with no explanation.
//
// Self-contained inline styles — the stylesheet may itself be unavailable at this point. Discloses
// no message and no stack: only the safe Next-generated digest.

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0d10",
          color: "#e8e6e1",
          fontFamily: "ui-sans-serif, -apple-system, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "34rem" }}>
          <p
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "10px",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#e27a6e",
              margin: "0 0 8px",
            }}
          >
            ascend os · startup failure
          </p>
          <h1 style={{ fontSize: "24px", fontWeight: 600, margin: "0 0 12px", letterSpacing: "-0.01em" }}>
            Ascend OS could not start.
          </h1>
          <p style={{ fontSize: "14px", lineHeight: 1.6, color: "#b6b3ac", margin: "0 0 12px" }}>
            The application failed before any page could render. The most common cause is that{" "}
            <code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>ASCEND_VAULT_PATH</code> is unset or
            points at a vault the process cannot read — check{" "}
            <code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>apps/os/.env.local</code> and the
            server logs.
          </p>
          <p style={{ fontSize: "14px", lineHeight: 1.6, color: "#b6b3ac", margin: 0 }}>
            No vault data has been modified.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "10px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#878a92",
                marginTop: "16px",
              }}
            >
              reference · {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}