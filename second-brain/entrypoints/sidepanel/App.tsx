import React, { useState } from "react";
import { ChatView } from "./components/ChatView";
import { IndexBrowser } from "./components/IndexBrowser";
import { SettingsPanel } from "./components/SettingsPanel";

type Tab = "ask" | "index" | "settings";

export function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>("ask");

  return (
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
        {activeTab === "ask" && <ChatView />}
        {activeTab === "index" && <IndexBrowser />}
        {activeTab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}
