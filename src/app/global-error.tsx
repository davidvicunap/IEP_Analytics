"use client";

// Replaces the root layout when it fails, so it cannot use the i18n provider or styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0a0b0d", color: "#e8eaed", margin: 0 }}>
        <main style={{ maxWidth: 420, margin: "15vh auto", padding: 16, textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>Algo salió mal · Something went wrong</h1>
          <p style={{ color: "#98a1ad", fontSize: 14 }}>
            No pudimos cargar IEP Analytics. · We couldn&apos;t load IEP Analytics.
          </p>
          {error.digest && <p style={{ color: "#98a1ad", fontSize: 11 }}>ref: {error.digest}</p>}
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 12, height: 40, padding: "0 16px", borderRadius: 8, border: 0, background: "#ff9f1a", color: "#111", fontWeight: 600 }}
          >
            Reintentar · Try again
          </button>
        </main>
      </body>
    </html>
  );
}
