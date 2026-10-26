"use client";

/** Last resort when the root layout itself fails (e.g. /api/config is unreachable). */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0A0F0D", color: "#EAFBF1", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <p>Divvy can&apos;t reach its server right now.</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 999, border: 0, background: "#4ADE80", color: "#03140A", fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
