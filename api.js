/**
 * api.js – BookmarkFlow
 * Handles all LLM API communication: Gemini, OpenRouter, Groq.
 * Manages batching, rate limiting, retries and structured JSON responses.
 */

'use strict';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_ENDPOINT       = 'https://api.groq.com/openai/v1/chat/completions';

// Default free-tier models for OpenRouter / Groq
const OPENROUTER_DEFAULT_MODEL = 'google/gemini-flash-1.5:free';
const GROQ_DEFAULT_MODEL       = 'llama3-70b-8192';

/** System instruction passed to the LLM */
const SYSTEM_INSTRUCTION = `You are a professional bookmark organizer assistant.
Your task is to analyze a batch of browser bookmarks and return a clean, hierarchical categorization.

Rules:
- Group into 3 to 8 top-level categories max (e.g., Development, News, Shopping, Entertainment).
- Maximum folder nesting depth: {MAX_DEPTH} levels.
- Avoid single-item folders or redundant nesting.
- Prefer balanced categories. Avoid over-specific categories.
- Do NOT invent bookmark content – analyze only what is provided.
- Respect the user's custom rules: {CUSTOM_RULES}
- Protected folders (never move bookmarks already in these): {PROTECTED_FOLDERS}
- If a bookmark title is messy (e.g., all caps, long URL, HTML entity), suggest a cleaner title.
- Return ONLY valid JSON. No markdown fences, no extra commentary.`;

const USER_PROMPT_TEMPLATE = `Organize the following {COUNT} bookmarks into a logical folder structure.

Return a JSON object matching this exact schema:
{
  "organized_bookmarks": [
    {
      "id": "<original chrome bookmark id>",
      "suggested_folder_path": ["Category", "Optional Subcategory"],
      "cleaned_title": "Optional cleaner title – omit if original is fine"
    }
  ]
}

Bookmarks (id | title | url):
{BOOKMARKS_LIST}`;

// ─────────────────────────────────────────────
// Rate-limit state (shared across calls)
// ─────────────────────────────────────────────

let _lastCallTime = 0;
const MIN_CALL_INTERVAL_MS = 1500; // avoid hammering free tier

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Analyze bookmarks in batches via the configured LLM provider.
 *
 * @param {Array<{id:string, title:string, url:string}>} bookmarks
 * @param {Object} settings – provider, apiKey, model, batchSize, etc.
 * @param {function(number, number, string)} onProgress – (done, total, msg)
 * @returns {Promise<Array<{id, suggested_folder_path, cleaned_title}>>}
 */
export async function analyzeBookmarks(bookmarks, settings, onProgress) {
  const batchSize  = settings.batchSize  || 40;
  const results    = [];
  const totalBatches = Math.ceil(bookmarks.length / batchSize);

  for (let i = 0; i < bookmarks.length; i += batchSize) {
    const batchIndex = Math.floor(i / batchSize) + 1;
    const batch = bookmarks.slice(i, i + batchSize);

    onProgress?.(i, bookmarks.length,
      `Analyzing batch ${batchIndex}/${totalBatches} (${batch.length} bookmarks)…`);

    const batchResult = await _callLLMWithRetry(batch, settings);
    results.push(...batchResult);

    // Respectful delay between batches
    if (i + batchSize < bookmarks.length) {
      await _sleep(MIN_CALL_INTERVAL_MS);
    }
  }

  onProgress?.(bookmarks.length, bookmarks.length, 'Analysis complete.');
  return results;
}

/**
 * Quick connectivity / API key test.
 * Sends a minimal request with 2 dummy bookmarks.
 */
export async function testConnection(settings) {
  const dummies = [
    { id: 'test-1', title: 'Google', url: 'https://google.com' },
    { id: 'test-2', title: 'YouTube', url: 'https://youtube.com' },
  ];
  await _callLLMWithRetry(dummies, settings);
  return true; // throws on failure
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

/**
 * Call the LLM with automatic exponential-backoff retry on 429 / 5xx.
 */
async function _callLLMWithRetry(batch, settings, attempt = 1) {
  // Enforce minimum inter-call interval
  const now    = Date.now();
  const waited = now - _lastCallTime;
  if (waited < MIN_CALL_INTERVAL_MS) {
    await _sleep(MIN_CALL_INTERVAL_MS - waited);
  }
  _lastCallTime = Date.now();

  try {
    return await _dispatchCall(batch, settings);
  } catch (err) {
    if (attempt >= 4) throw err;

    const isRetryable = err.status === 429 || (err.status >= 500 && err.status < 600);
    if (!isRetryable) throw err;

    const delay = Math.min(2 ** attempt * 1500, 30_000);
    console.warn(`[BookmarkFlow] API call failed (${err.status}), retrying in ${delay}ms…`);
    await _sleep(delay);
    return _callLLMWithRetry(batch, settings, attempt + 1);
  }
}

/**
 * Route to the correct provider.
 */
async function _dispatchCall(batch, settings) {
  switch (settings.provider) {
    case 'openrouter':
      return _callOpenAICompatible(batch, settings, OPENROUTER_ENDPOINT, OPENROUTER_DEFAULT_MODEL);
    case 'groq':
      return _callOpenAICompatible(batch, settings, GROQ_ENDPOINT, GROQ_DEFAULT_MODEL);
    case 'gemini':
    default:
      return _callGemini(batch, settings);
  }
}

// ── Gemini ─────────────────────────────────────

async function _callGemini(batch, settings) {
  const model    = settings.model || 'gemini-3.8-flash';
  const endpoint = GEMINI_ENDPOINT
    .replace('{MODEL}', model)
    .replace('{KEY}',   settings.apiKey);

  const systemText = _buildSystemInstruction(settings);
  const userText   = _buildUserPrompt(batch);

  const payload = {
    system_instruction: {
      parts: [{ text: systemText }]
    },
    contents: [
      { role: 'user', parts: [{ text: userText }] }
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.3,
      maxOutputTokens: 8192,
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const apiErr = new Error(
      body?.error?.message || `Gemini API error: ${response.status}`
    );
    apiErr.status = response.status;
    throw apiErr;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini API.');

  return _parseOrganizedBookmarks(text);
}

// ── OpenAI-compatible (OpenRouter / Groq) ──────

async function _callOpenAICompatible(batch, settings, endpoint, defaultModel) {
  const model      = settings.customModel?.trim() || defaultModel;
  const systemText = _buildSystemInstruction(settings);
  const userText   = _buildUserPrompt(batch);

  const payload = {
    model,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user',   content: userText },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 8192,
  };

  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${settings.apiKey}`,
  };

  if (settings.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://bookmarkflow.extension';
    headers['X-Title']      = 'BookmarkFlow';
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const apiErr = new Error(
      body?.error?.message || `API error: ${response.status}`
    );
    apiErr.status = response.status;
    throw apiErr;
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from API.');

  return _parseOrganizedBookmarks(text);
}

// ─────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────

function _buildSystemInstruction(settings) {
  return SYSTEM_INSTRUCTION
    .replace('{MAX_DEPTH}',        settings.maxDepth         || 3)
    .replace('{CUSTOM_RULES}',     settings.customPrompt?.trim() || 'None.')
    .replace('{PROTECTED_FOLDERS}',
      settings.protectedFolders?.trim() || 'None.');
}

function _buildUserPrompt(batch) {
  const lines = batch
    .map(b => `${b.id} | ${_sanitizeTitle(b.title)} | ${b.url}`)
    .join('\n');

  return USER_PROMPT_TEMPLATE
    .replace('{COUNT}',          batch.length)
    .replace('{BOOKMARKS_LIST}', lines);
}

function _sanitizeTitle(title) {
  if (!title) return '(untitled)';
  // Trim and collapse whitespace
  return title.trim().replace(/\s+/g, ' ').slice(0, 120);
}

// ─────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────

function _parseOrganizedBookmarks(rawText) {
  let parsed;
  try {
    // Strip any accidental markdown fences
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('LLM returned invalid JSON. Try again or reduce batch size.');
  }

  const arr = parsed?.organized_bookmarks;
  if (!Array.isArray(arr)) {
    throw new Error('LLM response missing "organized_bookmarks" array.');
  }

  // Validate & normalise each entry
  return arr
    .filter(item => item?.id && Array.isArray(item?.suggested_folder_path))
    .map(item => ({
      id:                   String(item.id),
      suggested_folder_path: item.suggested_folder_path.map(String).filter(Boolean),
      cleaned_title:         item.cleaned_title?.trim() || null,
    }));
}

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
