/**
 * background.js – BookmarkFlow Service Worker (MV3)
 * Handles side-panel registration and browser action events.
 */

'use strict';

// Open the side panel when the action button is clicked
// (falls back to popup if side panel isn't toggled on)
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => {}); // sidePanel API may not be available in all Chrome versions

// Handle messages from popup/sidepanel if needed in future
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_VERSION') {
    sendResponse({ version: chrome.runtime.getManifest().version });
  }
  return false;
});
