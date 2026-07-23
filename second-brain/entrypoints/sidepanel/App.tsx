import React, { useState, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ChatView } from "./components/ChatView";
import { IndexBrowser } from "./components/IndexBrowser";
import { SettingsPanel } from "./components/SettingsPanel";

type Tab = "ask" | "index" | "settings";

/**
 * Error Boundary — catches unhandled React render errors and
 * displays a recovery UI instead of unmounting the entire panel.
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[SecondBrain] UI crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            color: "#9ca3b8",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "1rem", opacity: 0.3 }}>
            &#x26A0;
          </div>
          <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "0.5rem" }}>
            Something went wrong
          </div>
          <div style={{ fontSize: "12px", marginBottom: "1rem", color: "#6b7394" }}>
            {this.state.error?.message || "Unknown error"}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "8px 16px",
              background: "#242837",
              border: "1px solid #2a2e3f",
              borderRadius: "6px",
              color: "#e8eaf0",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "12px",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>("ask");

  return (
    <ErrorBoundary>
      <div className="app-container">
        <div className="tab-bar">
          <button
            className={`tab-button ${activeTab === "ask" ? "active" : ""}`}
            onClick={() => setActiveTab("ask")}
          >
            Ask
          </button>
          <button
            className={`tab-button ${activeTab === "index" ? "active" : ""}`}
            onClick={() => setActiveTab("index")}
          >
            Index
          </button>
          <button
            className={`tab-button ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            Settings
          </button>
        </div>

        <div className="tab-content">
          <ErrorBoundary>
            {activeTab === "ask" && <ChatView />}
            {activeTab === "index" && <IndexBrowser />}
            {activeTab === "settings" && <SettingsPanel />}
          </ErrorBoundary>
        </div>
      </div>
    </ErrorBoundary>
  );
}
