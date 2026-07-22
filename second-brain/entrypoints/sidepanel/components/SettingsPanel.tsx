import React, { useState, useEffect, useCallback } from "react";

export function SettingsPanel(): React.JSX.Element {
  const [isPaused, setIsPaused] = useState(false);
  const [llmProvider, setLlmProvider] = useState("groq");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("llama-3.1-8b-instant");
  const [blockInput, setBlockInput] = useState("");
  const [blockedDomains, setBlockedDomains] = useState<string[]>([]);
  const [isBackfilling, setIsBackfilling] = useState(false);

  useEffect(() => {
    // Load current state
    chrome.runtime.sendMessage({ type: "GET_PAUSE_STATE" }).then((res) => {
      if (res && !res.error) setIsPaused(res.isPaused);
    });

    chrome.runtime.sendMessage({ type: "GET_LLM_CONFIG" }).then((res) => {
      if (res && !res.error) {
        setLlmProvider(res.provider || "groq");
        setApiKey(res.apiKey || "");
        setModel(res.model || "llama-3.1-8b-instant");
      }
    });

    chrome.runtime.sendMessage({ type: "GET_BLOCKLIST" }).then((res) => {
      if (res && !res.error) {
        setBlockedDomains(res.userBlocked || []);
      }
    });
  }, []);

  const handleTogglePause = useCallback(async () => {
    const res = await chrome.runtime.sendMessage({ type: "TOGGLE_PAUSE" });
    if (res && !res.error) setIsPaused(res.isPaused);
  }, []);

  const handleSaveLLM = useCallback(async () => {
    await chrome.runtime.sendMessage({
      type: "SAVE_LLM_CONFIG",
      payload: { provider: llmProvider, apiKey, model },
    });
    alert("LLM configuration saved.");
  }, [llmProvider, apiKey, model]);

  const handleProviderChange = useCallback(
    (provider: string) => {
      setLlmProvider(provider);
      const defaults: Record<string, string> = {
        groq: "llama-3.1-8b-instant",
        gemini: "gemini-2.0-flash",
        ollama: "llama3.1",
      };
      setModel(defaults[provider] || "");
    },
    []
  );

  const handleBlockDomain = useCallback(async () => {
    const domain = blockInput.trim();
    if (!domain) return;

    await chrome.runtime.sendMessage({
      type: "UPDATE_BLOCKLIST",
      payload: { action: "block", domain },
    });
    setBlockedDomains((prev) => [...prev, domain]);
    setBlockInput("");
  }, [blockInput]);

  const handleUnblock = useCallback(async (domain: string) => {
    await chrome.runtime.sendMessage({
      type: "UPDATE_BLOCKLIST",
      payload: { action: "unblock", domain },
    });
    setBlockedDomains((prev) => prev.filter((d) => d !== domain));
  }, []);

  const handleWipe = useCallback(async () => {
    const confirmed = window.confirm(
      "This will permanently delete your entire browsing index. Continue?"
    );
    if (!confirmed) return;

    await chrome.runtime.sendMessage({ type: "WIPE_DATABASE" });
    alert("Index wiped.");
  }, []);

  const handleBackfill = useCallback(async () => {
    setIsBackfilling(true);
    await chrome.runtime.sendMessage({
      type: "TRIGGER_BACKFILL",
      payload: { maxUrls: 200, daysBack: 14 },
    });
    setIsBackfilling(false);
    alert("Backfill complete. Check the Index tab for new pages.");
  }, []);

  return (
    <div className="settings-container">
      {/* Capture Control */}
      <div className="settings-section">
        <div className="settings-section-title">Capture Control</div>
        <div className="settings-row">
          <div>
            <div className="settings-label">
              {isPaused ? "Capture Paused" : "Capture Active"}
            </div>
            <div className="settings-description">
              {isPaused
                ? "No new pages will be indexed."
                : "Pages you visit are being indexed."}
            </div>
          </div>
          <div
            className={`toggle-switch ${isPaused ? "" : "active"}`}
            onClick={handleTogglePause}
          />
        </div>
      </div>

      {/* LLM Configuration */}
      <div className="settings-section">
        <div className="settings-section-title">LLM Configuration</div>
        <div className="settings-row">
          <div className="settings-label">Provider</div>
          <select
            className="settings-select"
            value={llmProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            <option value="groq">Groq</option>
            <option value="gemini">Gemini</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </div>

        {llmProvider !== "ollama" && (
          <>
            <div className="settings-label" style={{ marginTop: 8 }}>
              API Key
            </div>
            <input
              className="settings-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`Enter your ${llmProvider === "groq" ? "Groq" : "Gemini"} API key`}
            />
          </>
        )}

        <div className="settings-label" style={{ marginTop: 8 }}>
          Model
        </div>
        <input
          className="settings-input"
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Model name"
        />

        <button
          className="btn-secondary"
          style={{ marginTop: 10, width: "100%" }}
          onClick={handleSaveLLM}
        >
          Save LLM Config
        </button>
      </div>

      {/* Domain Blocklist */}
      <div className="settings-section">
        <div className="settings-section-title">Blocked Domains</div>
        <div className="settings-description" style={{ marginBottom: 8 }}>
          Pages on these domains will never be indexed.
        </div>
        <div className="input-row">
          <input
            className="settings-input"
            type="text"
            value={blockInput}
            onChange={(e) => setBlockInput(e.target.value)}
            placeholder="example.com"
            onKeyDown={(e) => e.key === "Enter" && handleBlockDomain()}
            style={{ margin: 0 }}
          />
          <button className="btn-secondary" onClick={handleBlockDomain}>
            Block
          </button>
        </div>
        {blockedDomains.length > 0 && (
          <div className="doc-list" style={{ marginTop: 8 }}>
            {blockedDomains.map((domain) => (
              <div key={domain} className="doc-item">
                <div className="doc-info">
                  <div className="doc-title">{domain}</div>
                </div>
                <button
                  className="doc-delete"
                  onClick={() => handleUnblock(domain)}
                  title="Unblock"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History Backfill */}
      <div className="settings-section">
        <div className="settings-section-title">History Backfill</div>
        <div className="settings-description" style={{ marginBottom: 8 }}>
          Re-crawl URLs from your Chrome history to build the index retroactively.
          Up to 200 pages from the last 14 days.
        </div>
        <button
          className="btn-secondary"
          style={{ width: "100%" }}
          onClick={handleBackfill}
          disabled={isBackfilling}
        >
          {isBackfilling ? "Backfilling..." : "Run Backfill"}
        </button>
      </div>

      {/* Danger Zone */}
      <div className="settings-section">
        <div className="settings-section-title">Danger Zone</div>
        <button className="btn-danger" style={{ width: "100%" }} onClick={handleWipe}>
          Wipe Entire Index
        </button>
      </div>
    </div>
  );
}
