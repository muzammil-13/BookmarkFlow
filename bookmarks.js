/**
 * bookmarks.js – BookmarkFlow
 * Reads Chrome bookmark trees, creates folder hierarchies,
 * moves items, and exports backups.
 */

'use strict';

// ─────────────────────────────────────────────
// Reading & Scanning
// ─────────────────────────────────────────────

/**
 * Retrieve and flatten all bookmarks from the Chrome bookmark tree.
 * Returns an object with:
 *   - bookmarks:  Array<{id, title, url, parentId, path}>
 *   - folders:    Array<{id, title, path}>
 *   - stats:      {total, duplicates, untitled, folders}
 */
export async function getBookmarkTree() {
  const [tree] = await chrome.bookmarks.getTree();
  const bookmarks = [];
  const folders   = [];
  const seenUrls  = new Map(); // url → first id
  let duplicates  = 0;
  let untitled    = 0;

  function walk(node, pathParts) {
    if (node.url) {
      // It's a bookmark
      const isDuplicate = seenUrls.has(node.url);
      if (isDuplicate) {
        duplicates++;
      } else {
        seenUrls.set(node.url, node.id);
      }

      if (!node.title || node.title.trim() === '') untitled++;

      bookmarks.push({
        id:        node.id,
        title:     node.title || '',
        url:       node.url,
        parentId:  node.parentId,
        path:      pathParts,
        isDuplicate,
      });
    } else if (node.children) {
      // It's a folder (or root)
      const isRoot = !node.parentId; // the synthetic root nodes
      if (!isRoot) {
        folders.push({
          id:    node.id,
          title: node.title || '(unnamed)',
          path:  pathParts,
        });
      }

      const childPath = isRoot ? [] : [...pathParts, node.title || '(unnamed)'];
      for (const child of node.children) {
        walk(child, childPath);
      }
    }
  }

  // Chrome's root has children: Bookmarks Bar, Other Bookmarks, Mobile Bookmarks
  for (const rootChild of (tree.children || [])) {
    walk(rootChild, [rootChild.title || '']);
  }

  return {
    bookmarks,
    folders,
    stats: {
      total:      bookmarks.length,
      duplicates,
      untitled,
      folders:    folders.length,
    },
  };
}

/**
 * Retrieve the path string for a given bookmark node ID.
 */
export async function getBookmarkPath(bookmarkId) {
  try {
    const [node] = await chrome.bookmarks.get(bookmarkId);
    const parts  = [];

    let current = node;
    while (current.parentId) {
      const [parent] = await chrome.bookmarks.get(current.parentId);
      if (parent.title) parts.unshift(parent.title);
      current = parent;
    }

    return parts.join(' / ');
  } catch {
    return '(unknown)';
  }
}

// ─────────────────────────────────────────────
// Folder management
// ─────────────────────────────────────────────

// In-memory cache: "folderPath joined by |" → folderId
const _folderCache = new Map();

/**
 * Recursively verify or create a folder path, returning the leaf folder's ID.
 * @param {string[]} pathParts – e.g. ['Development', 'JavaScript', 'Tutorials']
 * @param {string} rootParentId – Chrome built-in root: '1' (bar), '2' (other)
 */
export async function ensureFolderPath(pathParts, rootParentId = '2') {
  let parentId = rootParentId;

  for (let i = 0; i < pathParts.length; i++) {
    const folderName = pathParts[i].trim();
    const cacheKey   = `${parentId}|${folderName}`;

    if (_folderCache.has(cacheKey)) {
      parentId = _folderCache.get(cacheKey);
      continue;
    }

    // Search existing children
    const children = await chrome.bookmarks.getChildren(parentId);
    const existing = children.find(
      c => !c.url && c.title.toLowerCase() === folderName.toLowerCase()
    );

    if (existing) {
      _folderCache.set(cacheKey, existing.id);
      parentId = existing.id;
    } else {
      const created = await chrome.bookmarks.create({
        parentId,
        title: folderName,
      });
      _folderCache.set(cacheKey, created.id);
      parentId = created.id;
    }
  }

  return parentId;
}

/**
 * Clear the in-memory folder cache (call before each apply run).
 */
export function clearFolderCache() {
  _folderCache.clear();
}

// ─────────────────────────────────────────────
// Moving bookmarks
// ─────────────────────────────────────────────

/**
 * Move a single bookmark to the target folder.
 * @param {string} bookmarkId
 * @param {string} targetFolderId
 * @param {string|null} newTitle – if provided, also update the title
 */
export async function moveBookmark(bookmarkId, targetFolderId, newTitle = null) {
  await chrome.bookmarks.move(bookmarkId, { parentId: targetFolderId });

  if (newTitle) {
    await chrome.bookmarks.update(bookmarkId, { title: newTitle });
  }
}

/**
 * Apply a list of proposed changes in chunks.
 * Each change: { id, suggested_folder_path, cleaned_title }
 *
 * @param {Array} changes
 * @param {string} preferredRoot  – '1' (bar) or '2' (other bookmarks)
 * @param {number} chunkSize
 * @param {function} onProgress   – (done, total, msg) => void
 * @param {function} onError      – (id, error) => void
 * @returns {Promise<{succeeded: number, failed: number}>}
 */
export async function applyChanges(
  changes, preferredRoot, chunkSize = 40, onProgress, onError
) {
  clearFolderCache();
  let succeeded = 0;
  let failed    = 0;

  for (let i = 0; i < changes.length; i += chunkSize) {
    const chunk = changes.slice(i, i + chunkSize);

    for (const change of chunk) {
      try {
        const folderId = await ensureFolderPath(change.suggested_folder_path, preferredRoot);
        await moveBookmark(change.id, folderId, change.cleaned_title);
        succeeded++;
      } catch (err) {
        failed++;
        onError?.(change.id, err);
      }

      onProgress?.(succeeded + failed, changes.length,
        `Moved ${succeeded + failed} of ${changes.length}…`);
    }

    // Small pause between chunks to stay within API/browser limits
    if (i + chunkSize < changes.length) {
      await _sleep(150);
    }
  }

  return { succeeded, failed };
}

// ─────────────────────────────────────────────
// Protected folder detection
// ─────────────────────────────────────────────

/**
 * Given a list of protected folder names and the current bookmark tree,
 * returns a Set of bookmark IDs that should not be moved.
 */
export async function getProtectedBookmarkIds(protectedFolderNames, allFolders) {
  if (!protectedFolderNames || protectedFolderNames.length === 0) return new Set();

  const lowerNames = protectedFolderNames.map(n => n.trim().toLowerCase());
  const protectedFolderIds = new Set(
    allFolders
      .filter(f => lowerNames.includes(f.title.toLowerCase()))
      .map(f => f.id)
  );

  if (protectedFolderIds.size === 0) return new Set();

  // Get all descendants of protected folders
  const protectedBookmarkIds = new Set();
  const [tree] = await chrome.bookmarks.getTree();

  function walk(node, isProtected) {
    if (isProtected && node.url) {
      protectedBookmarkIds.add(node.id);
    }
    if (node.children) {
      const nowProtected = isProtected || protectedFolderIds.has(node.id);
      for (const child of node.children) {
        walk(child, nowProtected);
      }
    }
  }

  walk(tree, false);
  return protectedBookmarkIds;
}

// ─────────────────────────────────────────────
// Backup / Export
// ─────────────────────────────────────────────

/**
 * Export the full bookmark tree as a downloadable HTML file
 * (Netscape Bookmark Format – importable by all browsers).
 */
export async function exportBookmarksAsHTML() {
  const [tree] = await chrome.bookmarks.getTree();
  const lines  = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];

  function writeNode(node, indent) {
    const pad = '    '.repeat(indent);
    if (node.url) {
      const addDate = node.dateAdded ? Math.floor(node.dateAdded / 1000) : '';
      const title   = _escapeHtml(node.title || node.url);
      lines.push(`${pad}<DT><A HREF="${_escapeHtml(node.url)}" ADD_DATE="${addDate}">${title}</A>`);
    } else if (node.children) {
      if (node.title) {
        lines.push(`${pad}<DT><H3>${_escapeHtml(node.title)}</H3>`);
        lines.push(`${pad}<DL><p>`);
      }
      for (const child of node.children) {
        writeNode(child, indent + (node.title ? 1 : 0));
      }
      if (node.title) {
        lines.push(`${pad}</DL><p>`);
      }
    }
  }

  for (const child of (tree.children || [])) {
    writeNode(child, 1);
  }

  lines.push('</DL><p>');

  const html = lines.join('\n');
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const anchor = document.createElement('a');
  anchor.href     = url;
  anchor.download = `bookmarks-backup-${timestamp}.html`;
  anchor.click();

  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Export the full bookmark tree as a JSON file.
 */
export async function exportBookmarksAsJSON() {
  const [tree] = await chrome.bookmarks.getTree();
  const json   = JSON.stringify(tree, null, 2);
  const blob   = new Blob([json], { type: 'application/json' });
  const url    = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const anchor = document.createElement('a');
  anchor.href     = url;
  anchor.download = `bookmarks-backup-${timestamp}.json`;
  anchor.click();

  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
