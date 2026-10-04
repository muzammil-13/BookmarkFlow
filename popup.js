/**
 * popup.js – BookmarkFlow
 * Main controller: coordinates UI state, scanning, analysis,
 * diff preview, and applying changes.
 */

'use strict';

import { analyzeBookmarks, testConnection } from './api.js';
import {
  getBookmarkTree,
  applyChanges,
  getProtectedBookmarkIds,
  exportBookmarksAsHTML,
  exportBookmarksAsJSON,
} from './bookmarks.js';

// ─────────────────────────────────────────────
// App State
// ─────────────────────────────────────────────

const state = {
  bookmarks:      [],   // flat bookmark array from getBookmarkTree
  folders:        [],   // folder list
  stats:          {},   // {total, duplicates, untitled, folders}
  analysisResults:[],   // raw LLM output
  diffItems:      [],   // enriched diff items shown in UI
  settings:       {},   // loaded from chrome.storage.local
  isScanning:     false,
  isAnalyzing:    false,
  isApplying:     false,
};

// ─────────────────────────────────────────────
// DOM Refs (resolved after DOMContentLoaded)
// ─────────────────────────────────────────────

let dom = {};

function resolveDOM() {
  dom = {
    // Tabs
    tabBtns:       document.querySelectorAll('.tab-btn'),
    tabPanels:     document.querySelectorAll('.tab-content'),

    // Run tab
    statTotal:     document.getElementById('stat-total'),
    statDupes:     document.getElementById('stat-duplicates'),
    statUntitled:  document.getElementById('stat-untitled'),
    statFolders:   document.getElementById('stat-folders'),
    scanBtn:       document.getElementById('scan-btn'),
    analyzeBtn:    document.getElementById('analyze-btn'),
    backupCheckbox:document.getElementById('backup-checkbox'),
    backupBtn:     document.getElementById('backup-btn'),
    progressSection: document.getElementById('progress-section'),
    progressLabel: document.getElementById('progress-label'),
    progressPct:   document.getElementById('progress-pct'),
    progressBar:   document.getElementById('progress-bar'),
    progressDetail:document.getElementById('progress-detail'),
    logBox:        document.getElementById('log-box'),
    logEntries:    document.getElementById('log-entries'),
    clearLogBtn:   document.getElementById('clear-log-btn'),

    // Preview tab
    previewBadge:  document.getElementById('preview-badge'),
    previewCountLabel: document.getElementById('preview-count-label'),
    diffList:      document.getElementById('diff-list'),
    diffEmpty:     document.getElementById('diff-empty'),
    selectAllBtn:  document.getElementById('select-all-btn'),
    deselectAllBtn:document.getElementById('deselect-all-btn'),
    previewFooter: document.getElementById('preview-footer'),
    selectedCount: document.getElementById('selected-count'),
    applyBtn:      document.getElementById('apply-btn'),

    // Settings tab
    providerSelect:  document.getElementById('provider-select'),
    apiKeyInput:     document.getElementById('api-key-input'),
    toggleKeyBtn:    document.getElementById('toggle-key-visibility'),
    modelSelect:     document.getElementById('model-select'),
    modelField:      document.getElementById('model-field'),
    customModelField:document.getElementById('custom-model-field'),
    customModelInput:document.getElementById('custom-model-input'),
    testApiBtn:      document.getElementById('test-api-btn'),
    apiStatus:       document.getElementById('api-status'),
    batchSizeInput:  document.getElementById('batch-size-input'),
    maxCategoriesInput: document.getElementById('max-categories-input'),
    maxDepthInput:   document.getElementById('max-depth-input'),
    protectFoldersInput: document.getElementById('protect-folders-input'),
    customPromptInput:   document.getElementById('custom-prompt-input'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    themeBtns:       document.querySelectorAll('.theme-btn'),

    // Modal
    confirmModal:  document.getElementById('confirm-modal'),
    modalTitle:    document.getElementById('modal-title'),
    modalBody:     document.getElementById('modal-body'),
    modalIcon:     document.getElementById('modal-icon'),
    modalCancel:   document.getElementById('modal-cancel'),
    modalConfirm:  document.getElementById('modal-confirm'),

    // Side panel
    openSidepanelBtn: document.getElementById('open-sidepanel-btn'),

    // Toast container
    toastContainer: document.getElementById('toast-container'),
  };
}

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  resolveDOM();
  await loadSettings();
  applyTheme(state.settings.theme || 'dark');
  bindEvents();
  log('BookmarkFlow ready. Click "Scan Bookmarks" to begin.', 'info');
  showLog();
});

// ─────────────────────────────────────────────
// Settings persistence
// ─────────────────────────────────────────────

async function loadSettings() {
  const stored = await chrome.storage.local.get('bf_settings');
  state.settings = Object.assign({
    provider:         'gemini',
    apiKey:           '',
    model:            'gemini-flash-latest',
    customModel:      '',
    batchSize:        40,
    maxCategories:    8,
    maxDepth:         3,
    protectedFolders: '',
    customPrompt:     '',
    theme:            'dark',
  }, stored.bf_settings || {});

  // Auto-migrate deprecated or high-demand models to the most stable one
  if (['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-3.8-flash'].includes(state.settings.model)) {
    state.settings.model = 'gemini-flash-latest';
  }

  // Populate fields
  dom.providerSelect.value      = state.settings.provider;
  dom.apiKeyInput.value         = state.settings.apiKey;
  dom.modelSelect.value         = state.settings.model || 'gemini-flash-latest';
  dom.customModelInput.value    = state.settings.customModel;
  dom.batchSizeInput.value      = state.settings.batchSize;
  dom.maxCategoriesInput.value  = state.settings.maxCategories;
  dom.maxDepthInput.value       = state.settings.maxDepth;
  dom.protectFoldersInput.value = state.settings.protectedFolders;
  dom.customPromptInput.value   = state.settings.customPrompt;

  updateProviderUI(state.settings.provider);
}

async function saveSettings() {
  const settings = {
    provider:         dom.providerSelect.value,
    apiKey:           dom.apiKeyInput.value.trim(),
    model:            dom.modelSelect.value,
    customModel:      dom.customModelInput.value.trim(),
    batchSize:        parseInt(dom.batchSizeInput.value) || 40,
    maxCategories:    parseInt(dom.maxCategoriesInput.value) || 8,
    maxDepth:         parseInt(dom.maxDepthInput.value) || 3,
    protectedFolders: dom.protectFoldersInput.value.trim(),
    customPrompt:     dom.customPromptInput.value.trim(),
    theme:            state.settings.theme || 'dark',
  };

  state.settings = settings;
  await chrome.storage.local.set({ bf_settings: settings });
  toast('Settings saved successfully.', 'success');
}

// ─────────────────────────────────────────────
// Event Bindings
// ─────────────────────────────────────────────

function bindEvents() {
  // Tab switching
  dom.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Run tab
  dom.scanBtn.addEventListener('click', handleScan);
  dom.analyzeBtn.addEventListener('click', handleAnalyze);
  dom.backupBtn.addEventListener('click', handleManualBackup);
  dom.clearLogBtn.addEventListener('click', clearLog);

  // Preview tab
  dom.selectAllBtn.addEventListener('click', () => toggleAllDiffItems(true));
  dom.deselectAllBtn.addEventListener('click', () => toggleAllDiffItems(false));
  dom.applyBtn.addEventListener('click', handleApply);

  // Settings tab
  dom.providerSelect.addEventListener('change', () => updateProviderUI(dom.providerSelect.value));
  dom.toggleKeyBtn.addEventListener('click', toggleKeyVisibility);
  dom.testApiBtn.addEventListener('click', handleTestApi);
  dom.saveSettingsBtn.addEventListener('click', saveSettings);
  dom.themeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.theme;
      applyTheme(btn.dataset.theme);
    });
  });

  // Side panel opener (only exists in popup.html)
  if (dom.openSidepanelBtn) {
    dom.openSidepanelBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    });
  }
}

// ─────────────────────────────────────────────
// Tab Switching
// ─────────────────────────────────────────────

function switchTab(tabId) {
  dom.tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
    btn.setAttribute('aria-selected', btn.dataset.tab === tabId);
  });
  dom.tabPanels.forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-content-${tabId}`);
  });
}

// ─────────────────────────────────────────────
// Scan
// ─────────────────────────────────────────────

async function handleScan() {
  if (state.isScanning) return;
  state.isScanning = true;

  dom.scanBtn.disabled = true;
  dom.scanBtn.classList.add('btn-loading');
  setStats({ total: '…', duplicates: '…', untitled: '…', folders: '…' });
  showProgress('Scanning bookmark tree…', 0);
  clearLog();
  showLog();

  try {
    const result = await getBookmarkTree();
    state.bookmarks = result.bookmarks;
    state.folders   = result.folders;
    state.stats     = result.stats;

    setStats(result.stats);
    hideProgress();
    dom.analyzeBtn.disabled = false;

    log(`Found ${result.stats.total} bookmarks in ${result.stats.folders} folders.`);
    if (result.stats.duplicates > 0) {
      log(`${result.stats.duplicates} duplicate URL(s) detected.`, 'warn');
    }
    if (result.stats.untitled > 0) {
      log(`${result.stats.untitled} bookmark(s) have no title.`, 'warn');
    }

    toast(`Scanned ${result.stats.total} bookmarks.`, 'success');
    dom.scanBtn.classList.add('pulse-once');
    setTimeout(() => dom.scanBtn.classList.remove('pulse-once'), 800);
  } catch (err) {
    hideProgress();
    log(`Scan failed: ${err.message}`, 'error');
    toast('Scan failed. See log for details.', 'error');
  } finally {
    state.isScanning = false;
    dom.scanBtn.disabled = false;
    dom.scanBtn.classList.remove('btn-loading');
  }
}

// ─────────────────────────────────────────────
// Analyze
// ─────────────────────────────────────────────

async function handleAnalyze() {
  if (state.isAnalyzing) return;
  if (!state.settings.apiKey) {
    toast('Please enter your API key in Settings first.', 'warn');
    switchTab('settings');
    return;
  }
  if (state.bookmarks.length === 0) {
    toast('No bookmarks found. Please scan first.', 'warn');
    return;
  }

  // Determine which bookmarks are protected
  const protectedNames = state.settings.protectedFolders
    ? state.settings.protectedFolders.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const protectedIds = await getProtectedBookmarkIds(protectedNames, state.folders);

  // Filter to only bookmarks that can be moved
  const eligible = state.bookmarks.filter(b => !protectedIds.has(b.id));
  
  if (eligible.length === 0) {
    toast('No eligible bookmarks to analyze.', 'info');
    return;
  }

  // Check for temp storage to resume
  const { bf_partial_analysis } = await chrome.storage.local.get('bf_partial_analysis');
  let resumeState = null;

  if (bf_partial_analysis && bf_partial_analysis.startIndex > 0 && bf_partial_analysis.startIndex < eligible.length) {
    const doResume = confirm(`You have an incomplete analysis (${bf_partial_analysis.startIndex} / ${eligible.length} done). Resume from where you left off?\n\n(Click Cancel to restart from the beginning)`);
    if (doResume) {
      resumeState = bf_partial_analysis;
    } else {
      await chrome.storage.local.remove('bf_partial_analysis');
    }
  } else if (bf_partial_analysis) {
    await chrome.storage.local.remove('bf_partial_analysis');
  }

  state.isAnalyzing = true;
  dom.analyzeBtn.disabled = true;
  dom.analyzeBtn.classList.add('btn-loading');

  log(`Analyzing ${eligible.length} eligible bookmarks (${protectedIds.size} protected)…`);
  showProgress(resumeState ? 'Resuming AI analysis…' : 'Sending bookmarks to AI…', 0);

  try {
    const results = await analyzeBookmarks(
      eligible,
      state.settings,
      (done, total, msg) => {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        updateProgress(msg, pct);
        if (done > 0) log(msg);
      },
      resumeState
    );

    state.analysisResults = results;
    state.diffItems       = _buildDiffItems(results, eligible);

    hideProgress();
    log(`AI suggested changes for ${state.diffItems.length} bookmarks.`, 'success');

    updatePreviewBadge(state.diffItems.length);
    renderDiffList();
    switchTab('preview');
    toast(`${state.diffItems.length} changes proposed. Review them now.`, 'info');
  } catch (err) {
    hideProgress();
    log(`Analysis failed: ${err.message}`, 'error');
    toast(`AI Error: ${err.message}`, 'error');
  } finally {
    state.isAnalyzing = false;
    dom.analyzeBtn.disabled = false;
    dom.analyzeBtn.classList.remove('btn-loading');
  }
}

/**
 * Merge LLM results with the original bookmark metadata for display.
 */
function _buildDiffItems(results, eligible) {
  const bookmarkMap = new Map(eligible.map(b => [b.id, b]));

  return results
    .map(result => {
      const original = bookmarkMap.get(result.id);
      if (!original) return null;

      const oldPath = original.path.join(' / ') || '(Root)';
      const newPath = result.suggested_folder_path.join(' / ');

      // Skip if nothing changed and no title cleanup
      const pathChanged  = newPath !== oldPath;
      const titleChanged = result.cleaned_title && result.cleaned_title !== original.title;

      if (!pathChanged && !titleChanged) return null;

      return {
        id:          result.id,
        title:       original.title || '(untitled)',
        url:         original.url,
        oldPath,
        newPath,
        newTitle:    result.cleaned_title || null,
        pathChanged,
        titleChanged,
        folderPath:  result.suggested_folder_path,
        selected:    true,
      };
    })
    .filter(Boolean);
}

// ─────────────────────────────────────────────
// Diff / Preview Rendering
// ─────────────────────────────────────────────

function renderDiffList() {
  // Clear previous
  while (dom.diffList.firstChild) dom.diffList.removeChild(dom.diffList.firstChild);

  if (state.diffItems.length === 0) {
    dom.diffList.appendChild(dom.diffEmpty);
    dom.diffEmpty.style.display = 'flex';
    dom.previewFooter.style.display = 'none';
    dom.previewCountLabel.textContent = 'No changes to preview';
    return;
  }

  dom.diffEmpty.style.display = 'none';
  dom.previewFooter.style.display = 'flex';
  dom.previewCountLabel.textContent = `${state.diffItems.length} proposed changes`;

  for (const item of state.diffItems) {
    const el = _createDiffItemElement(item);
    dom.diffList.appendChild(el);
  }

  updateSelectedCount();
}

function _createDiffItemElement(item) {
  const div = document.createElement('div');
  div.className = `diff-item ${item.selected ? 'selected' : 'excluded'}`;
  div.dataset.id = item.id;

  const checkbox = document.createElement('div');
  checkbox.className = 'diff-checkbox';
  checkbox.setAttribute('role', 'checkbox');
  checkbox.setAttribute('aria-checked', item.selected);
  checkbox.addEventListener('click', () => toggleDiffItem(item.id));

  const info = document.createElement('div');
  info.className = 'diff-info';

  // Title row
  const titleEl = document.createElement('div');
  titleEl.className = 'diff-title';
  titleEl.textContent = item.newTitle || item.title;
  titleEl.title = item.url;

  // Path rows
  const pathContainer = document.createElement('div');
  pathContainer.className = 'diff-path';

  if (item.pathChanged) {
    pathContainer.appendChild(_createPathRow('OLD', item.oldPath, false));
    pathContainer.appendChild(_createPathRow('NEW', item.newPath, true));
  }

  if (item.titleChanged) {
    const tag = document.createElement('span');
    tag.className = 'diff-tag renamed';
    tag.textContent = 'Title cleaned';
    titleEl.appendChild(tag);
  }

  info.appendChild(titleEl);
  info.appendChild(pathContainer);
  div.appendChild(checkbox);
  div.appendChild(info);

  return div;
}

function _createPathRow(label, path, isNew) {
  const row = document.createElement('div');
  row.className = 'diff-path-row';

  const lbl = document.createElement('span');
  lbl.className = `diff-path-label ${isNew ? 'new' : 'old'}`;
  lbl.textContent = label;

  const val = document.createElement('span');
  val.className = `diff-path-value ${isNew ? 'new-path' : ''}`;
  val.textContent = path;
  val.title = path;

  row.appendChild(lbl);
  row.appendChild(val);
  return row;
}

function toggleDiffItem(id) {
  const item = state.diffItems.find(d => d.id === id);
  if (!item) return;
  item.selected = !item.selected;

  const el = dom.diffList.querySelector(`[data-id="${id}"]`);
  if (el) {
    el.classList.toggle('selected', item.selected);
    el.classList.toggle('excluded', !item.selected);
    el.querySelector('.diff-checkbox')?.setAttribute('aria-checked', item.selected);
  }
  updateSelectedCount();
}

function toggleAllDiffItems(selected) {
  state.diffItems.forEach(item => { item.selected = selected; });
  renderDiffList();
}

function updateSelectedCount() {
  const count = state.diffItems.filter(d => d.selected).length;
  dom.selectedCount.textContent = `${count} selected`;
  dom.applyBtn.disabled = count === 0;
}

function updatePreviewBadge(count) {
  if (count > 0) {
    dom.previewBadge.textContent = count;
    dom.previewBadge.style.display = 'inline-flex';
  } else {
    dom.previewBadge.style.display = 'none';
  }
}

// ─────────────────────────────────────────────
// Apply Changes
// ─────────────────────────────────────────────

async function handleApply() {
  if (state.isApplying) return;

  const selected = state.diffItems.filter(d => d.selected);
  if (selected.length === 0) {
    toast('No items selected to apply.', 'warn');
    return;
  }

  const doApply = await showConfirm({
    icon:    '🔄',
    title:   'Apply Changes?',
    body:    `This will move ${selected.length} bookmarks based on AI suggestions. The operation can be reversed by importing your backup.`,
    confirm: 'Apply Now',
    cancel:  'Cancel',
  });

  if (!doApply) return;

  // Backup if requested
  if (dom.backupCheckbox.checked) {
    log('Creating backup before applying…');
    try {
      await exportBookmarksAsHTML();
      log('Backup exported to your Downloads folder.', 'success');
    } catch (err) {
      log(`Backup warning: ${err.message}`, 'warn');
    }
  }

  state.isApplying = true;
  dom.applyBtn.disabled = true;
  dom.applyBtn.classList.add('btn-loading');
  switchTab('run');
  showProgress('Applying changes…', 0);

  const preferredRoot = '2'; // Other Bookmarks as default root

  try {
    const { succeeded, failed } = await applyChanges(
      selected.map(d => ({
        id:                   d.id,
        suggested_folder_path: d.folderPath,
        cleaned_title:         d.newTitle,
      })),
      preferredRoot,
      state.settings.batchSize || 40,
      (done, total, msg) => {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        updateProgress(msg, pct);
      },
      (id, err) => {
        log(`Failed to move bookmark ${id}: ${err.message}`, 'error');
      }
    );

    hideProgress();
    log(`Done! ${succeeded} bookmarks moved successfully.${failed > 0 ? ` ${failed} failed.` : ''}`,
        failed > 0 ? 'warn' : 'success');
    toast(`Applied ${succeeded} changes successfully!`, 'success');

    // Reset preview
    state.diffItems = [];
    updatePreviewBadge(0);

    // Re-scan to get fresh stats
    const result = await getBookmarkTree();
    state.bookmarks = result.bookmarks;
    state.folders   = result.folders;
    state.stats     = result.stats;
    setStats(result.stats);
  } catch (err) {
    hideProgress();
    log(`Apply failed: ${err.message}`, 'error');
    toast(`Apply failed: ${err.message}`, 'error');
  } finally {
    state.isApplying = false;
    dom.applyBtn.disabled = false;
    dom.applyBtn.classList.remove('btn-loading');
  }
}

// ─────────────────────────────────────────────
// Manual Backup
// ─────────────────────────────────────────────

async function handleManualBackup() {
  try {
    await exportBookmarksAsHTML();
    toast('Backup exported to Downloads.', 'success');
    log('Manual bookmark backup created.', 'success');
  } catch (err) {
    toast(`Backup failed: ${err.message}`, 'error');
  }
}

// ─────────────────────────────────────────────
// API Test
// ─────────────────────────────────────────────

async function handleTestApi() {
  await saveSettings();

  if (!state.settings.apiKey) {
    toast('Enter an API key first.', 'warn');
    return;
  }

  dom.testApiBtn.disabled = true;
  dom.apiStatus.textContent = '⏳ Testing…';
  dom.apiStatus.className = 'api-status wait';

  try {
    await testConnection(state.settings);
    dom.apiStatus.textContent = '✓ Connected';
    dom.apiStatus.className = 'api-status ok';
    toast('API connection successful!', 'success');
  } catch (err) {
    dom.apiStatus.textContent = `✗ ${err.message.slice(0, 40)}`;
    dom.apiStatus.className = 'api-status err';
    toast(`API test failed: ${err.message}`, 'error');
  } finally {
    dom.testApiBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────
// Provider UI adaption
// ─────────────────────────────────────────────

function updateProviderUI(provider) {
  const isGemini = provider === 'gemini';
  dom.modelField.style.display      = isGemini ? 'flex' : 'none';
  dom.customModelField.style.display = isGemini ? 'none' : 'flex';

  if (!isGemini) {
    const placeholder = provider === 'openrouter'
      ? 'e.g. google/gemini-flash-1.5:free'
      : 'e.g. llama3-70b-8192';
    dom.customModelInput.placeholder = placeholder;
  }
}

// ─────────────────────────────────────────────
// API Key Visibility Toggle
// ─────────────────────────────────────────────

function toggleKeyVisibility() {
  const input = dom.apiKeyInput;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  dom.toggleKeyBtn.title = isHidden ? 'Hide key' : 'Show key';
}

// ─────────────────────────────────────────────
// Stats Display
// ─────────────────────────────────────────────

function setStats({ total, duplicates, untitled, folders }) {
  dom.statTotal.textContent    = total   ?? '—';
  dom.statDupes.textContent    = duplicates ?? '—';
  dom.statUntitled.textContent = untitled ?? '—';
  dom.statFolders.textContent  = folders ?? '—';
}

// ─────────────────────────────────────────────
// Progress
// ─────────────────────────────────────────────

function showProgress(msg, pct) {
  dom.progressSection.style.display = 'flex';
  updateProgress(msg, pct);
}

function updateProgress(msg, pct) {
  dom.progressLabel.textContent   = msg;
  dom.progressPct.textContent     = `${pct}%`;
  dom.progressBar.style.width     = `${pct}%`;
  dom.progressDetail.textContent  = '';
}

function hideProgress() {
  dom.progressSection.style.display = 'none';
}

// ─────────────────────────────────────────────
// Log
// ─────────────────────────────────────────────

function showLog() {
  dom.logBox.style.display = 'flex';
}

function clearLog() {
  dom.logEntries.innerHTML = '';
}

function log(msg, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${level}`;
  entry.textContent = msg;
  dom.logEntries.appendChild(entry);
  dom.logEntries.scrollTop = dom.logEntries.scrollHeight;
}

// ─────────────────────────────────────────────
// Toast Notifications
// ─────────────────────────────────────────────

function toast(msg, type = 'info', durationMs = 3000) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;

  const icon = { success: '✓', error: '✗', info: 'ℹ', warn: '⚠' }[type] || 'ℹ';
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;

  dom.toastContainer.appendChild(t);
  setTimeout(() => t.remove(), durationMs);
}

// ─────────────────────────────────────────────
// Confirm Modal
// ─────────────────────────────────────────────

function showConfirm({ icon, title, body, confirm, cancel }) {
  return new Promise(resolve => {
    dom.modalIcon.textContent  = icon  || '❓';
    dom.modalTitle.textContent = title || 'Confirm';
    dom.modalBody.textContent  = body  || '';
    dom.modalConfirm.textContent = confirm || 'OK';
    dom.modalCancel.textContent  = cancel  || 'Cancel';

    dom.confirmModal.style.display = 'flex';

    const onConfirm = () => { cleanup(); resolve(true); };
    const onCancel  = () => { cleanup(); resolve(false); };
    const onBackdrop = (e) => { if (e.target === dom.confirmModal) { cleanup(); resolve(false); } };

    function cleanup() {
      dom.confirmModal.style.display = 'none';
      dom.modalConfirm.removeEventListener('click', onConfirm);
      dom.modalCancel.removeEventListener('click', onCancel);
      dom.confirmModal.removeEventListener('click', onBackdrop);
    }

    dom.modalConfirm.addEventListener('click', onConfirm);
    dom.modalCancel.addEventListener('click', onCancel);
    dom.confirmModal.addEventListener('click', onBackdrop);
  });
}

// ─────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }

  dom.themeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}
