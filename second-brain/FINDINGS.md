# FINDINGS.md — Second Brain Evaluation Report

## Results Summary

| Topology | Total | Correct | Partial | Wrong | Hallucinated | Accuracy |
|----------|-------|---------|---------|-------|--------------|----------|
| Direct Fact | 10 | — | — | — | — | —% |
| Multi-Hop | 8 | — | — | — | — | —% |
| Time-Scoped | 7 | — | — | — | — | —% |
| Negative | 5 | — | — | — | — | —% |
| **Overall** | **30** | **—** | **—** | **—** | **—** | **—%** |

### Retrieval Metrics

| Metric | Score |
|--------|-------|
| Context Precision (top-5) | —% |
| Context Recall | —% |
| Faithfulness | —% |
| Negative Rejection Rate | —/5 |

---

## Error Analysis — 5 Most Interesting Failures

### Failure 1: [Title]

**Question:** [question text]
**Expected:** [ground truth]
**Generated:** [system output]
**Retrieved Chunks:**
1. [chunk text with source URL]
2. [chunk text with source URL]

**Root Cause:** [analysis]

---

### Failure 2: [Title]

*(repeat pattern)*

---

## The One Improvement: Before/After

### Component Improved
[Which component was modified — e.g., chunking strategy, dedup threshold, prompt template]

### What Changed
[Specific technical change made]

### Measured Lift

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| [metric] | —% | —% | +—% |

---

## One Surprise

[Describe something unexpected discovered during fieldwork — a site that broke parsing, a dedup edge case, a retrieval pattern you didn't anticipate]

---

## Privacy/Threat Model

### Architecture
- All text extraction, embedding, and deduplication run locally in the browser
- PGlite database persisted in IndexedDB — never leaves the machine
- Embedding model downloaded once from Hugging Face CDN, cached locally
- Only outbound traffic: Groq API for answer generation (context chunks only)

### Default Protections
- Banking, email, health, and auth pages blocked by default
- Sensitive URL path patterns (login, checkout, password) blocked
- `declarativeNetRequest` blocks all extension-originated traffic except Groq and HF CDN
- Content Script operates in Chrome's Isolated World — invisible to host page JS
- UI elements injected via Shadow DOM to prevent host page scraping

### User Controls
- Pause/resume capture globally
- Block/unblock specific domains
- Delete individual indexed pages
- Wipe entire database with one action

### Honest Limitations
- Groq API receives the top-5 retrieved chunks for generation — this is the only data that leaves the machine
- Backfilled pages reflect current content, not content at original reading time
- Chrome history timestamps are used for backfilled pages but may not reflect actual reading time
- IndexedDB is subject to browser storage eviction policies under extreme disk pressure

---

## AI Usage Note

AI tools were used throughout the build process:
- **Code generation:** [tools used]
- **Architecture design:** [tools used]
- **Research:** [tools used]
- **Debugging:** [tools used]

The evaluation dataset (`eval/questions.json`) was hand-crafted from genuine browsing history. All ground truth answers were verified by reading the source pages. [Note: History backfill was used to supplement the corpus — disclosed per assignment requirements.]
