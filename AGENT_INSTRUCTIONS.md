# Agent Instructions & Project Context

Welcome, future AI agent! This document contains essential context, architectural decisions, and development guidelines for **BookmarkFlow**. Please read this entirely before making modifications to the codebase.

---

## 1. Project Overview
BookmarkFlow is a **Google Chrome Extension (Manifest V3)** that uses client-side LLM calls (via Google Gemini, OpenRouter, or Groq) to organize, categorize, and restructure user bookmarks intelligently.

**Core Philosophy:**
- **Zero-Backend:** 100% client-side. No intermediate servers. All API calls go directly from the browser to the LLM provider.
- **Vanilla Tech Stack:** Pure HTML, CSS (Custom Properties/Variables), and JavaScript (ES Modules). **No bundlers (Webpack/Vite), no frameworks (React/Vue), and no TailwindCSS.**
- **Privacy First:** Only bookmark URLs and titles are sent. User API keys are stored securely in `chrome.storage.local`.
- **Non-Destructive by Default:** All AI suggestions are presented in a diff UI. The user must explicitly approve changes before the Chrome Bookmarks tree is modified. Auto-backups (HTML format) are triggered prior to modifications.

---

## 2. File Structure & Responsibilities

| File | Responsibility | Agentic Rules |
|---|---|---|
| `manifest.json` | MV3 configuration | Ensure any new API endpoint domains are added to `host_permissions`. New permissions require careful review. |
| `popup.html` | The main extension UI (also used by side panel) | Keep semantic HTML. Use IDs for JS targeting. Avoid inline styles. |
| `sidepanel.html` | Full-height side panel wrapper | Mirrors `popup.html` but overrides CSS for full height. Any UI element added to `popup.html` must work in this responsive context. |
| `popup.css` | All styling and theming | Use CSS variables (`var(--color)`) for theming. Maintain support for `[data-theme="dark"]` and `[data-theme="light"]`. |
| `popup.js` | UI Controller & State Machine | Keep DOM manipulation here. Do not leak Chrome Bookmark API logic here (delegate to `bookmarks.js`). |
| `api.js` | LLM Communication | Must handle rate limits (`429`), exponential backoff, and strict JSON parsing. |
| `bookmarks.js` | Chrome Bookmarks API wrapper | Handles recursive tree reading, folder creation, moving nodes, and exporting backups. |

---

## 3. State Management & Architecture

### The State Object (`popup.js`)
The application state is centralized in a simple JS object:
```javascript
const state = {
  bookmarks: [],       // Flat list of all bookmarks
  folders: [],         // Flat list of all folders
  stats: {},           // Counts for UI display
  analysisResults: [], // Raw JSON returned by the LLM
  diffItems: [],       // Enriched items for the Preview UI
  settings: {},        // User preferences (API key, model, etc.)
  isScanning: false,
  isAnalyzing: false,
  isApplying: false
};
```
**Rule:** Always update this state object rather than relying on the DOM as the source of truth.

### API Handling (`api.js`)
- Bookmarks are batched (default 40 per request) to avoid LLM context window limits and strict JSON output breakage.
- All LLM interactions must enforce the `application/json` response type.
- **Retries:** `api.js` includes exponential backoff for `429` (Rate Limit) and `5xx` errors. Do not remove this logic.

---

## 4. Coding Standards & Guidelines

1. **Vanilla JS Only:** Use standard modern ES6+ features (`async/await`, `Map`, `Set`, destructuring). Do not introduce jQuery or external libraries unless absolutely necessary (and if so, they must be local files, not CDNs, due to MV3 CSP rules).
2. **CSS Best Practices:** 
   - Rely on CSS variables at the `:root` level for colors, spacing, and transitions.
   - UI should look premium, using glassmorphism, subtle shadows, and smooth micro-animations.
3. **Error Handling:** 
   - Catch errors gracefully and use the `toast(msg, type)` or `log(msg, type)` functions in `popup.js` to inform the user.
   - Never let an unhandled promise rejection crash the UI state machine (e.g., getting stuck in `isAnalyzing = true`).
4. **Security & MV3 Compliance:**
   - Do not use `eval()` or `innerHTML` with unsanitized LLM output. 
   - All external API calls must be `fetch()` requests directly to the provider.

---

## 5. Adding New Features

### Adding a New AI Provider
1. Add the endpoint URL constant in `api.js`.
2. Update the `_dispatchCall()` function in `api.js` to route to a new handler (e.g., `_callAnthropic()`).
3. Add the provider to the `<select id="provider-select">` in `popup.html` and `sidepanel.html`.
4. Update `updateProviderUI()` in `popup.js` if the new provider requires specific UI toggles (like hiding the custom model field).

### Modifying Bookmark Logic
1. Place any interaction with `chrome.bookmarks.*` inside `bookmarks.js`.
2. Remember that the Chrome Bookmark root has synthetic IDs (`'1'` for Bookmarks Bar, `'2'` for Other Bookmarks). The UI currently defaults to moving things into `'2'`.

## 6. Testing Changes
Since there is no build step:
1. Make changes to the files.
2. Go to `chrome://extensions`.
3. Click the **Refresh** icon on the BookmarkFlow card.
4. Click the extension icon to view changes.

*End of Agent Instructions. Keep the code clean, fast, and beautiful.*
