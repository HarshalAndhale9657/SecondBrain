import React, { useState, useRef, useEffect, useCallback } from "react";
import type { QueryResponseMessage } from "@/lib/messages";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Array<{ index: number; url: string; title: string }>;
  isNegative?: boolean;
  isLoading?: boolean;
  isError?: boolean;
}

/**
 * Clean the LLM's raw answer for display:
 * 1. Strip the reference list block (e.g. "[1] Title — URL") since
 *    citations are rendered separately in the UI.
 * 2. Render **bold** markdown.
 */
function formatAnswer(raw: string): React.ReactNode {
  // Strip trailing reference block (lines starting with [1], [2], etc.)
  let cleaned = raw.replace(
    /\n*(?:\[\d+\]\s+.+(?:\n|$))+$/,
    ""
  ).trim();

  // Also strip standalone reference lines anywhere in the text
  cleaned = cleaned.replace(/^\[\d+\]\s+\S.*$/gm, "").trim();

  // Remove consecutive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // Split into segments: bold markers and plain text
  const parts = cleaned.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function ChatView(): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const handler = (message: QueryResponseMessage) => {
      if (message.type !== "QUERY_RESPONSE") return;

      const { requestId, answer, citations, isNegative, error } =
        message.payload;

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === requestId
            ? {
                ...msg,
                content: error
                  ? `Error: ${error}`
                  : answer,
                citations: error ? undefined : citations,
                isNegative,
                isLoading: false,
                isError: !!error,
              }
            : msg
        )
      );
      setIsQuerying(false);
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const handleSubmit = useCallback(() => {
    const query = input.trim();
    if (!query || isQuerying) return;

    const requestId = crypto.randomUUID();

    // Add user message
    setMessages((prev) => [
      ...prev,
      { id: `user-${requestId}`, role: "user", content: query },
      { id: requestId, role: "assistant", content: "", isLoading: true },
    ]);

    setInput("");
    setIsQuerying(true);

    chrome.runtime.sendMessage({
      type: "QUERY",
      payload: { requestId, query },
    });

    // Client-side timeout (45s) — if no response arrives, show error
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === requestId && msg.isLoading
            ? {
                ...msg,
                content: "Request timed out. The LLM or embedding service may be unavailable. Check your API key in Settings.",
                isLoading: false,
                isError: true,
              }
            : msg
        )
      );
      setIsQuerying(false);
    }, 45_000);
  }, [input, isQuerying]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const openUrl = useCallback((url: string) => {
    chrome.tabs.create({ url, active: true });
  }, []);

  return (
    <div className="chat-container">
      <div className="messages-area">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">&#x1F9E0;</div>
            <div className="empty-state-title">Second Brain</div>
            <div className="empty-state-desc">
              Ask questions about pages you have read. Your browsing history is
              indexed locally and never leaves your machine.
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.isLoading ? (
              <div className="message message-loading">
                <div className="loading-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : (
              <div
                className={`message ${
                  msg.role === "user"
                    ? "message-user"
                    : msg.isError
                      ? "message-error"
                      : msg.isNegative
                        ? "message-negative"
                        : "message-assistant"
                }`}
              >
                <div>
                  {msg.role === "assistant" && !msg.isError
                    ? formatAnswer(msg.content)
                    : msg.content}
                </div>

                {msg.citations && msg.citations.length > 0 && (
                  <div className="citations">
                    {msg.citations.map((cite) => (
                      <a
                        key={cite.index}
                        className="citation-link"
                        onClick={() => openUrl(cite.url)}
                        title={cite.url}
                      >
                        [{cite.index}] {cite.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="input-row">
          <textarea
            ref={inputRef}
            className="input-field"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your browsing history..."
            rows={1}
            disabled={isQuerying}
          />
          <button
            className="send-button"
            onClick={handleSubmit}
            disabled={!input.trim() || isQuerying}
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
