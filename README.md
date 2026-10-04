# BookmarkFlow – Smart Bookmark Organizer

> **AI-powered Chrome extension** that intelligently categorizes and restructures your bookmarks using Google Gemini (or OpenRouter / Groq). 100% client-side — your bookmarks never leave your browser except for titles and URLs sent to the AI API.

---

## ✨ Features

| Feature | Description |
| --- | --- |
| 🔍 **Smart Scan** | Detects total bookmarks, duplicates, untitled items, and folder count |
| 🤖 **AI Analysis** | Sends batches of 10–100 bookmarks to Gemini/OpenRouter/Groq |
| 🌳 **Diff Preview** | Review every proposed move before anything is changed |
| ✅ **Selective Apply** | Check/uncheck individual changes before applying |
| 💾 **Auto Backup** | Exports a full HTML/JSON snapshot before modifying your tree |
| 🔒 **Privacy First** | Only bookmark titles + URLs are sent; no page content |
| 🗂️ **Protected Folders** | Mark folders that should never be touched |
| 🎨 **Dark / Light / Auto** | Three theme modes with a premium UI |
| 📌 **Side Panel** | Works as a Chrome side panel for a larger view |

---

## 🚀 Quick Start

### Step 1 – Load the Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **"Load unpacked"**
4. Select the `BookmarkFlow` folder (the one containing `manifest.json`)
5. The BookmarkFlow icon will appear in your Chrome toolbar 🎉

### Step 2 – Get a Free Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Copy the key (starts with `AIza…`)

> **Free tier limits:** Gemini Flash Latest allows ~15 requests/minute and 1 million tokens/day on the free tier — more than enough for organizing thousands of bookmarks.

### Step 3 – Configure BookmarkFlow

1. Click the **BookmarkFlow** toolbar icon
2. Go to the **Settings** tab ⚙️
3. Paste your API key into the **API Key** field
4. Click **"Test Connection"** to verify it works
5. Click **"Save Settings"**

### Step 4 – Organize Your Bookmarks

1. Switch to the **Run** tab
2. Click **"Scan Bookmarks"** — see your stats instantly
3. Click **"Analyze with AI"** — the AI processes your bookmarks in batches
4. Switch to the **Preview** tab to review proposed changes
5. Deselect any moves you don't want
6. Click **"Apply Changes"** — done! ✅

---

## 🔧 Advanced Configuration

### Using OpenRouter (Alternative AI Provider)

OpenRouter provides access to many free models including Gemini Flash:

1. Visit [openrouter.ai](https://openrouter.ai) → Create a free account
2. Generate an API key from the dashboard
3. In BookmarkFlow Settings → select **"OpenRouter"** as provider
4. Enter your OpenRouter API key
5. Set the model to `google/gemini-flash-1.5:free` (free) or any other model

### Using Groq (Ultra-Fast Inference)

1. Visit [console.groq.com](https://console.groq.com) → Create a free account
2. Generate an API key
3. In BookmarkFlow Settings → select **"Groq"** as provider
4. Enter your Groq API key
5. Model defaults to `llama-3.1-8b-instant`

### Protected Folders

In the **Settings → Folder Rules** section:

- Enter comma-separated folder names: `Work, Personal, Do Not Touch`
- Bookmarks inside these folders will be completely skipped during analysis

### Custom AI Instructions

Add plain-English instructions like:

```
Group all programming tutorials under 'Dev Resources'.
Keep news and articles in a 'Reading' section.
Separate work and personal bookmarks strictly.
```

---

## 📁 File Structure

```
BookmarkFlow/
├── manifest.json          # Chrome Extension Manifest V3
├── popup.html             # Main popup UI (420px)
├── sidepanel.html         # Full-height side panel UI
├── popup.css              # All styles (dark/light themes)
├── popup.js               # UI controller & state management
├── api.js                 # LLM API client (Gemini, OpenRouter, Groq)
├── bookmarks.js           # Chrome Bookmarks API wrapper
├── background.js          # MV3 Service Worker
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🔐 Privacy & Security

- **No external servers:** BookmarkFlow makes direct API calls from your browser to Google/OpenRouter/Groq. There is no middleman server.
- **API Key storage:** Your key is stored in `chrome.storage.local` — it never leaves your device except in the `Authorization` header to the AI API endpoint.
- **What the AI sees:** Only bookmark `title`, `url`, and an internal Chrome `id`. No page content, no browsing history, no cookies.
- **Non-destructive:** The extension always shows a diff preview. Nothing changes until you click "Apply Changes". Backup is created by default.

---

## 🛠️ Troubleshooting

| Problem | Solution |
| --- | --- |
| "API key invalid" error | Double-check your key. For Gemini, it starts with `AIza`. Test via Settings → "Test Connection". |
| "Empty response from AI" | Reduce batch size (e.g. to 20) in Settings. The model may be hitting context limits. |
| Rate limit (429) errors | BookmarkFlow automatically retries with exponential backoff. Wait a moment and try again. |
| Bookmarks not moved | Check if the bookmark is in a Protected Folder. Also verify the bookmark still exists. |
| Extension not loading | Make sure Developer mode is ON in `chrome://extensions` and you selected the correct folder. |

---

## 📜 Permissions Explained

| Permission | Why it's needed |
| --- | --- |
| `bookmarks` | Read your bookmark tree; create folders; move bookmarks |
| `storage` | Save your API key and settings locally |
| `sidePanel` | Allow the extension to open as a Chrome side panel |
| `generativelanguage.googleapis.com` | Send batches to Gemini API |
| `openrouter.ai` | Send batches to OpenRouter (only if selected) |
| `api.groq.com` | Send batches to Groq (only if selected) |

---

## 🧑‍💻 Development

No build step required. Pure vanilla JS with ES modules.

To make changes:

1. Edit any `.js`, `.html`, or `.css` file
2. Go to `chrome://extensions`
3. Click the **🔄 refresh icon** on the BookmarkFlow card
4. Reopen the popup

---

*Built with ❤️ using Chrome Extension Manifest V3, Google Gemini API, and vanilla JS.*
