import { useState, useRef } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL || 
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" 
    ? "http://localhost:8080" 
    : window.location.origin);


const resizeImage = (file, maxWidth = 1200, maxHeight = 1200) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            const resizedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            });
            resolve(resizedFile);
          },
          file.type,
          0.85
        );
      };
    };
  });
};

export default function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = (selected) => {
    if (!selected) return;
    if (!selected.type.startsWith("image/")) {
      setError("Please upload an image file (PNG, JPG, etc).");
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setResult(null);
    setError(null);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleScan = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Resize image on the client side to avoid Render OOM and speed up OCR!
      const resizedFile = await resizeImage(file, 2000, 2000);

      const formData = new FormData();
      formData.append("file", resizedFile);

      const res = await fetch(`${API_BASE}/scan`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status} ${res.statusText}`;
        try {
          const errBody = await res.json();
          detail = errBody.detail || JSON.stringify(errBody);
        } catch {
          // not JSON
        }
        throw new Error(detail);
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error("Scan error:", err);
      if (err.message === "Failed to fetch") {
        setError(`Could not connect to the backend at ${API_BASE}. Please ensure uvicorn is running on port 8000.`);
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
    setRawExpanded(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <span className="sih-badge">SIH 2026 · PS 26034</span>
        <h1 className="app-title">PackSure Compliance Auditor</h1>
        <p className="app-subtitle">
          Instantly verify commodity labels against mandatory declarations specified under the
          <strong> Legal Metrology (Packaged Commodities) Rules, 2011</strong>.
        </p>
      </header>

      <div className="layout-grid">
        {/* Left Column: Image Upload & Preview */}
        <div className="panel">
          <h2 style={{ fontSize: "20px", fontWeight: "700", marginTop: 0, marginBottom: "20px" }}>
            Label Scan Pipeline
          </h2>
          
          {!preview ? (
            <div
              className={`upload-container ${dragActive ? "drag-active" : ""}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}
            >
              <div className="upload-icon">📸</div>
              <p className="upload-text-main">Drag and drop your label photo here</p>
              <p className="upload-text-sub">Supports PNG, JPG, JPEG, and WEBP</p>
              <button className="btn btn-secondary" type="button">
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFile(e.target.files[0])}
                style={{ display: "none" }}
              />
            </div>
          ) : (
            <div className="preview-wrapper">
              <img src={preview} alt="label preview" className="preview-image" />
              <div className="action-row">
                <button
                  onClick={handleScan}
                  disabled={loading}
                  className="btn btn-primary"
                  type="button"
                >
                  {loading ? (
                    <>
                      <span className="spinner" /> Analyzing Label...
                    </>
                  ) : (
                    "Audit Label"
                  )}
                </button>
                <button onClick={reset} className="btn btn-secondary" type="button">
                  Clear Image
                </button>
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: "24px",
                padding: "16px",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                fontSize: "14px",
                lineHeight: "1.5",
              }}
            >
              <strong>Error:</strong> {error}
            </div>
          )}

          {result && (
            <div className="raw-text-container">
              <button
                className="accordion-trigger"
                onClick={() => setRawExpanded(!rawExpanded)}
                type="button"
              >
                <span>Raw OCR Output Text</span>
                <span>{rawExpanded ? "▲" : "▼"}</span>
              </button>
              {rawExpanded && (
                <pre className="raw-text-block">{result.raw_text || "(No text detected)"}</pre>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Audit Results */}
        <div className="panel">
          <h2 style={{ fontSize: "20px", fontWeight: "700", marginTop: 0, marginBottom: "20px" }}>
            Compliance Report
          </h2>

          {!result && !loading && (
            <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-secondary)" }}>
              <div style={{ fontSize: "40px", marginBottom: "16px" }}>📋</div>
              <p>Upload and audit a label to generate a compliance report.</p>
            </div>
          )}

          {loading && (
            <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-secondary)" }}>
              <div className="spinner" style={{ width: "32px", height: "32px", borderThickness: "3px", margin: "0 auto 16px" }} />
              <p>Executing image pre-processing, OCR, and rules verification engine...</p>
              <p style={{ fontSize: "12px", marginTop: "16px", color: "var(--text-muted)", maxWidth: "320px", margin: "16px auto 0", lineHeight: "1.4" }}>
                Note: Deployed backends on Render Free tier go to sleep when inactive. The first scan may take 1-2 minutes to wake up the server.
              </p>
            </div>
          )}

          {result && (
            <div>
              <div className={`verdict-banner ${result.verdict === "COMPLIANT" ? "compliant" : "non-compliant"}`}>
                <span className="verdict-icon">
                  {result.verdict === "COMPLIANT" ? "✓" : "⚠"}
                </span>
                <div>
                  <div style={{ textTransform: "uppercase" }}>{result.verdict}</div>
                  <div style={{ fontSize: "13px", fontWeight: "500", opacity: 0.9, marginTop: "4px" }}>
                    Verified {result.fields_passed} of {result.fields_checked} fields successfully
                  </div>
                </div>
              </div>

              <div className="audit-list">
                {result.results.map((r, i) => {
                  let pillClass = "missing";
                  let pillText = "Missing";
                  if (r.status === "PASS") {
                    if (r.format_status === "COMPLIANT") {
                      pillClass = "pass";
                      pillText = "Pass";
                    } else {
                      pillClass = "incorrect";
                      pillText = "Format Error";
                    }
                  }

                  return (
                    <div className="audit-card" key={i}>
                      <div className="card-header">
                        <span className="card-title">{r.field}</span>
                        <span className={`status-pill ${pillClass}`}>{pillText}</span>
                      </div>
                      
                      <div className="card-body">
                        <span className="card-label">Extracted Value: </span>
                        {r.extracted_value ? (
                          <span className="extracted-value">{r.extracted_value}</span>
                        ) : (
                          <span className="val-empty">—</span>
                        )}
                        
                        {r.reason && (
                          <div className={`card-reason ${r.status !== "PASS" ? "danger" : ""}`}>
                            {r.reason}
                          </div>
                        )}
                      </div>

                      <div className="card-clause">{r.clause}</div>
                    </div>
                  );
                })}
              </div>

              <div className="download-section">
                <a
                  href={`${API_BASE}/report/${result.scan_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-download"
                >
                  Download ReportLab PDF Audit Report
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
