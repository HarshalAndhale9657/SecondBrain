import React, { useState, useEffect, useCallback } from "react";

interface Document {
  doc_id: number;
  url: string;
  title: string;
  captured_at: string;
  last_visited: string;
  is_backfill: boolean;
}

export function IndexBrowser(): React.JSX.Element {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [stats, setStats] = useState({ documentCount: 0, chunkCount: 0 });
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [docsResponse, statsResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: "GET_DOCUMENTS" }),
        chrome.runtime.sendMessage({ type: "GET_STATS" }),
      ]);

      if (docsResponse?.documents) {
        setDocuments(docsResponse.documents);
      }
      if (statsResponse && !statsResponse.error) {
        setStats(statsResponse);
      }
    } catch (err) {
      console.error("[SecondBrain] Failed to load index:", err);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = useCallback(
    async (docId: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const confirmed = window.confirm(
        "Remove this page from your index? This cannot be undone."
      );
      if (!confirmed) return;

      await chrome.runtime.sendMessage({
        type: "DELETE_DOCUMENT",
        payload: { docId },
      });
      loadData();
    },
    [loadData]
  );

  const openUrl = useCallback((url: string) => {
    chrome.tabs.create({ url, active: true });
  }, []);

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const extractDomain = (url: string): string => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  const filteredDocs = documents.filter((doc) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.url.toLowerCase().includes(q)
    );
  });

  if (isLoading) {
    return (
      <div className="empty-state">
        <div className="empty-state-desc">Loading index...</div>
      </div>
    );
  }

  return (
    <div className="index-container">
      <div className="index-header">
        <span className="index-stats">
          {stats.documentCount} pages &middot; {stats.chunkCount} chunks
        </span>
      </div>

      <input
        className="search-input"
        type="text"
        placeholder="Filter by title or URL..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {filteredDocs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#x1F4DA;</div>
          <div className="empty-state-title">
            {documents.length === 0 ? "No pages indexed" : "No matches"}
          </div>
          <div className="empty-state-desc">
            {documents.length === 0
              ? "Browse the web and your pages will appear here."
              : "Try a different search term."}
          </div>
        </div>
      ) : (
        <div className="doc-list">
          {filteredDocs.map((doc) => (
            <div
              key={doc.doc_id}
              className="doc-item"
              onClick={() => openUrl(doc.url)}
            >
              <div className="doc-info">
                <div className="doc-title">{doc.title}</div>
                <div className="doc-url">{extractDomain(doc.url)}</div>
                <div className="doc-date">
                  {formatDate(doc.last_visited)}
                  {doc.is_backfill ? " (backfill)" : ""}
                </div>
              </div>
              <button
                className="doc-delete"
                onClick={(e) => handleDelete(doc.doc_id, e)}
                title="Remove from index"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
