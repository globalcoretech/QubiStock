import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { isDemoMode, setupDemoMocks } from "./demo/mockInvoke";

if (isDemoMode()) {
  setupDemoMocks();
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("React ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "32px", maxWidth: "600px", margin: "40px auto", background: "#FFF", borderRadius: "16px", border: "2px solid #E4DAC6", boxShadow: "0 10px 25px rgba(0,0,0,0.08)", fontFamily: "sans-serif" }}>
          <h2 style={{ color: "#B5412B", margin: "0 0 12px 0", fontSize: "20px" }}>⚠️ ऐप लोड करने में समस्या आई</h2>
          <p style={{ color: "#1C2B24", fontSize: "14px", lineHeight: "1.5" }}>
            कृपया नीचे दिए गए बटन से पुनः लोड करें। यदि समस्या बनी रहे तो त्रुटि का विवरण देखें:
          </p>
          <pre style={{ background: "#FDF0ED", border: "1px solid #FCA5A5", padding: "12px", borderRadius: "8px", color: "#993320", fontSize: "12px", whiteSpace: "pre-wrap", overflowX: "auto" }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: "16px", background: "#14402F", color: "#FFF", border: "none", padding: "10px 20px", borderRadius: "8px", fontWeight: "bold", cursor: "pointer" }}
          >
            पुनः लोड करें (Reload)
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

