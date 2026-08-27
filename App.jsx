import { useState, useRef } from "react";

// Point this at wherever your FastAPI backend is running
const API_BASE = "http://localhost:8000";

export default function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = (selected) => {
    if (!selected) return;
    if (!selected.type.startsWith("image/")) {
      setError("Please upload an image file (jpg, png, etc).");
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setResult(null);
    setError(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleScan = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/scan`, {
        method: "POST",
        body: formData,
      });

      // Surface the REAL error instead of a generic message
      if (!res.ok) {
        let detail = `HTTP ${res.status} ${res.statusText}`;
        try {
          const errBody = await res.json();
          detail = errBody.detail || JSON.stringify(errBody);
        } catch {
          // response wasn't JSON, keep the generic detail
        }
        throw new Error(detail);
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      // Network-level failure (backend not running, wrong port, CORS) lands here
      console.error("Scan error:", err);
      if (err.message === "Failed to fetch") {
        setError(
          `Could not reach the backend at ${API_BASE}. Is uvicorn running? Check your terminal for the backend process.`
        );
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.badge}>SIH 2026 · PS 26034</div>
          <h1 style={styles.title}>Legal Metrology Compliance Checker</h1>
          <p style={styles.subtitle}>
            Upload a product label photo to instantly check compliance with
            the Legal Metrology (Packaged Commodities) Rules, 2011
          </p>
        </header>

        <div
          style={{
            ...styles.uploadBox,
            ...(dragActive ? styles.uploadBoxActive : {}),
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          {!preview ? (
            <>
              <div style={styles.uploadIcon}>📷</div>
              <p style={styles.uploadText}>
                Drag & drop a label photo here, or
              </p>
              <button
                style={styles.chooseButton}
                onClick={() => fileInputRef.current.click()}
              >
                Choose Image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFile(e.target.files[0])}
                style={{ display: "none" }}
              />
            </>
          ) : (
            <>
              <img src={preview} alt="preview" style={styles.previewImg} />
              <div style={styles.actionRow}>
                <button
                  onClick={handleScan}
                  disabled={loading}
                  style={styles.scanButton}
                >
                  {loading ? (
                    <>
                      <span style={styles.spinner} /> Scanning...
                    </>
                  ) : (
                    "Scan Label"
                  )}
                </button>
                <button onClick={reset} style={styles.resetButton}>
                  Choose Different Image
                </button>
              </div>
            </>
          )}
        </div>

        {error && (
          <div style={styles.errorBox}>
            <strong>Something went wrong:</strong> {error}
          </div>
        )}

        {result && (
          <div style={styles.resultBox}>
            <div
              style={{
                ...styles.verdictBanner,
                background:
                  result.verdict === "COMPLIANT" ? "#e6f4ea" : "#fdecea",
                color: result.verdict === "COMPLIANT" ? "#1e7e34" : "#c0392b",
              }}
            >
              {result.verdict === "COMPLIANT" ? "✅" : "⚠️"}{" "}
              <strong>{result.verdict}</strong> — {result.fields_passed}/
              {result.fields_checked} fields verified
            </div>

            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Field</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Extracted Value</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}>{r.field}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusPill,
                          background:
                            r.status === "PASS" ? "#e6f4ea" : "#fdecea",
                          color: r.status === "PASS" ? "#1e7e34" : "#c0392b",
                        }}
                      >
                        {r.status === "PASS" ? "✓ PASS" : "✗ MISSING"}
                      </span>
                    </td>
                    <td style={styles.td}>{r.extracted_value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <a
              href={`${API_BASE}${result.report_url}`}
              target="_blank"
              rel="noreferrer"
              style={styles.downloadLink}
            >
              ⬇ Download Full PDF Report
            </a>
          </div>
        )}
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f4f6f8",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    padding: "40px 16px",
  },
  container: { maxWidth: 720, margin: "0 auto" },
  header: { textAlign: "center", marginBottom: 32 },
  badge: {
    display: "inline-block",
    background: "#2c3e50",
    color: "white",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.5,
    padding: "4px 12px",
    borderRadius: 20,
    marginBottom: 12,
  },
  title: { margin: "0 0 8px", fontSize: 28, color: "#1a1a1a" },
  subtitle: { color: "#666", fontSize: 15, maxWidth: 480, margin: "0 auto" },
  uploadBox: {
    background: "white",
    border: "2px dashed #d0d5dd",
    borderRadius: 16,
    padding: 40,
    textAlign: "center",
    transition: "border-color 0.2s, background 0.2s",
  },
  uploadBoxActive: { borderColor: "#2c3e50", background: "#f8fafc" },
  uploadIcon: { fontSize: 40, marginBottom: 8 },
  uploadText: { color: "#666", marginBottom: 16 },
  chooseButton: {
    padding: "10px 24px",
    background: "#2c3e50",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  previewImg: {
    maxWidth: "100%",
    maxHeight: 320,
    borderRadius: 10,
    marginBottom: 16,
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
  },
  actionRow: {
    display: "flex",
    gap: 12,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  scanButton: {
    padding: "10px 28px",
    background: "#2c3e50",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  resetButton: {
    padding: "10px 20px",
    background: "transparent",
    color: "#555",
    border: "1px solid #d0d5dd",
    borderRadius: 8,
    fontSize: 14,
    cursor: "pointer",
  },
  spinner: {
    width: 14,
    height: 14,
    border: "2px solid rgba(255,255,255,0.5)",
    borderTopColor: "white",
    borderRadius: "50%",
    display: "inline-block",
    animation: "spin 0.7s linear infinite",
  },
  errorBox: {
    marginTop: 20,
    background: "#fdecea",
    color: "#c0392b",
    padding: "14px 18px",
    borderRadius: 10,
    fontSize: 14,
    lineHeight: 1.5,
  },
  resultBox: { marginTop: 28 },
  verdictBanner: {
    padding: "14px 18px",
    borderRadius: 10,
    fontSize: 16,
    marginBottom: 20,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    background: "white",
    borderRadius: 10,
    overflow: "hidden",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  },
  th: {
    textAlign: "left",
    padding: "12px 16px",
    background: "#f8fafc",
    color: "#555",
    fontSize: 13,
    fontWeight: 600,
    borderBottom: "1px solid #eee",
  },
  tr: {},
  td: {
    padding: "12px 16px",
    fontSize: 14,
    borderBottom: "1px solid #f0f0f0",
  },
  statusPill: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
  },
  downloadLink: {
    display: "inline-block",
    marginTop: 20,
    padding: "10px 20px",
    background: "#2c3e50",
    color: "white",
    borderRadius: 8,
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 600,
  },
};
