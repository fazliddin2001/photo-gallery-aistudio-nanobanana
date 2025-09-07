// background.js (complete)

// Storage keys
const DOWNLOADED_URLS_KEY = 'downloaded_image_urls_v1';
const DOWNLOADED_HASHES_KEY = 'downloaded_image_hashes_v1';
const DOWNLOADED_FILES_KEY = 'downloaded_files_v1';

// Append entry
async function persistAddFile(entry) {
  try {
    const cur = await chrome.storage.local.get(DOWNLOADED_FILES_KEY);
    const arr = (cur && cur[DOWNLOADED_FILES_KEY]) || [];
    arr.push(entry);
    await chrome.storage.local.set({ [DOWNLOADED_FILES_KEY]: arr });
  } catch (e) {
    console.error("persistAddFile error", e);
  }
}


// In-memory caches
let downloadedUrls = new Set();
let downloadedHashes = new Set();
let pendingUrls = new Set();
let pendingHashes = new Set();

// Map of active downloadId -> { key, type } so we can rollback if interrupted
// type: 'url' | 'hash' | 'dataurl'
const activeDownloads = new Map();

// Initialization promise so message handler can await warm cache
let initPromise = null;
async function initCache() {
  try {
    const res = await chrome.storage.local.get([DOWNLOADED_URLS_KEY, DOWNLOADED_HASHES_KEY]);
    const arrUrls = (res && res[DOWNLOADED_URLS_KEY]) || [];
    const arrHashes = (res && res[DOWNLOADED_HASHES_KEY]) || [];
    downloadedUrls = new Set(Array.isArray(arrUrls) ? arrUrls : []);
    downloadedHashes = new Set(Array.isArray(arrHashes) ? arrHashes : []);
  } catch (e) {
    downloadedUrls = new Set();
    downloadedHashes = new Set();
  }
}
initPromise = initCache();

// Helpers to persist/remove entries (keeps storage small & avoids duplicates)
async function persistAddUrl(url) {
  downloadedUrls.add(url);
  try {
    const cur = await chrome.storage.local.get(DOWNLOADED_URLS_KEY);
    const arr = (cur && cur[DOWNLOADED_URLS_KEY]) || [];
    if (!arr.includes(url)) {
      arr.push(url);
      await chrome.storage.local.set({ [DOWNLOADED_URLS_KEY]: arr });
    }
  } catch (e) {
    // ignore storage write errors
  }
}
async function persistRemoveUrl(url) {
  downloadedUrls.delete(url);
  try {
    const cur = await chrome.storage.local.get(DOWNLOADED_URLS_KEY);
    const arr = (cur && cur[DOWNLOADED_URLS_KEY]) || [];
    const filtered = arr.filter(x => x !== url);
    await chrome.storage.local.set({ [DOWNLOADED_URLS_KEY]: filtered });
  } catch (e) {
    // ignore
  }
}
async function persistAddHash(hash) {
  downloadedHashes.add(hash);
  try {
    const cur = await chrome.storage.local.get(DOWNLOADED_HASHES_KEY);
    const arr = (cur && cur[DOWNLOADED_HASHES_KEY]) || [];
    if (!arr.includes(hash)) {
      arr.push(hash);
      await chrome.storage.local.set({ [DOWNLOADED_HASHES_KEY]: arr });
    }
  } catch (e) {
    // ignore
  }
}
async function persistRemoveHash(hash) {
  downloadedHashes.delete(hash);
  try {
    const cur = await chrome.storage.local.get(DOWNLOADED_HASHES_KEY);
    const arr = (cur && cur[DOWNLOADED_HASHES_KEY]) || [];
    const filtered = arr.filter(x => x !== hash);
    await chrome.storage.local.set({ [DOWNLOADED_HASHES_KEY]: filtered });
  } catch (e) {
    // ignore
  }
}

// Normalize http(s) url by removing fragment
function normalizeHttpUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch (e) {
    return url;
  }
}

// Utility to derive a safe filename when content script hasn't provided one
function fallbackFilenameFromUrl(url, fallbackBase = 'image') {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || fallbackBase;
    const fname = last.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    return fname;
  } catch (e) {
    return fallbackBase;
  }
}

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Fire-and-forget; handler awaits initPromise internally
  (async () => {
    await initPromise;

    if (!msg || !msg.type) return;

    // ---------- data: URL (may include hash & filename)
  if (msg.type === 'found_dataurl' && msg.dataUrl) {
    const hash = msg.hash || null;
    if (hash) {
      if (downloadedHashes.has(hash) || pendingHashes.has(hash)) return;
      pendingHashes.add(hash);
      const options = { url: msg.dataUrl, saveAs: false, conflictAction: 'overwrite' };
      if (msg.filename) options.filename = msg.filename;

      try {
        chrome.downloads.download(options, async (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          pendingHashes.delete(hash);
          return;
        }
        pendingHashes.delete(hash);

        await persistAddHash(hash);
        await persistAddFile({
          url: msg.dataUrl || msg.url || options.url,   // ✅ ensure it's valid
          filename: options.filename || ("image_" + hash + ".jpg"),
          hash
        });

        activeDownloads.set(downloadId, { key: hash, type: "hash" });
      });

      } catch (e) {
        pendingHashes.delete(hash);
      }
    } else {
      // fallback to using full dataUrl as key
      const key = msg.dataUrl;
      if (downloadedUrls.has(key) || pendingUrls.has(key)) return;
      pendingUrls.add(key);
      const options = { url: msg.dataUrl, saveAs: false, conflictAction: 'overwrite' };
      if (msg.filename) options.filename = msg.filename;

      try {
        chrome.downloads.download(options, async (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            pendingUrls.delete(key);
            return;
          }
          pendingUrls.delete(key);
          await persistAddUrl(key);
          await persistAddFile({
            url: msg.dataUrl || msg.url || options.url,          // ✅ persist for gallery
            filename: options.filename || ("image_" + hash + ".jpg"),
            hash: null
          });
          activeDownloads.set(downloadId, { key: key, type: 'dataurl' });
        });
      } catch (e) {
        pendingUrls.delete(key);
      }
    }
    return;
  }


  })();
  // no sendResponse (fire-and-forget)
});

// Listen for download state changes to rollback persisted keys when interrupted
chrome.downloads.onChanged.addListener((delta) => {
  try {
    if (!delta || !delta.id || !delta.state) return;
    const downloadId = delta.id;
    const state = delta.state.current; // 'in_progress' | 'complete' | 'interrupted'
    if (!activeDownloads.has(downloadId)) {
      // we didn't start or track this one
      return;
    }
    const info = activeDownloads.get(downloadId);
    if (state === 'complete') {
      // Download finished successfully — nothing to do; leave persisted key in storage.
      activeDownloads.delete(downloadId);
      return;
    }
    if (state === 'interrupted') {
      // Download failed after being accepted: remove persisted mark so future scans can retry.
      const { key, type } = info;
      activeDownloads.delete(downloadId);
      if (type === 'url') {
        // remove from persisted URLs
        persistRemoveUrl(key).catch(() => {});
      } else if (type === 'hash') {
        persistRemoveHash(key).catch(() => {});
      } else if (type === 'dataurl') {
        persistRemoveUrl(key).catch(() => {});
      }
      return;
    }
  } catch (e) {
    // ignore
  }
});

// Ensure cache is warmed when service worker starts
initPromise.catch(() => {});
// defensive: ensure dataUrl is JPEG before handling
function dataUrlIsJpeg(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return false;
  const header = dataUrl.slice(0, comma);
  const m = header.match(/^data:([^;]+);/);
  if (m && m[1] && m[1].toLowerCase().includes('jpeg')) return true;
  // If no MIME, we can't reliably inspect bytes here without the full data (and we want to avoid huge memory).
  // So be conservative and reject if MIME is not present.
  return false;
}
// open gallery in a new tab when the extension icon is clicked
chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL("gallery.html");
  chrome.tabs.create({ url });
});