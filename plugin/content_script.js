// content_script.js
(() => {
  const recentlySent = new Set();        // avoids spamming same url within tab
  const recentlyCheckedNoExt = new Set(); // avoid repeated HEAD requests for same URL
  const RECENT_TTL = 60 * 1000; // 60s
  const INTERVAL_MS = 100;

  function scheduleForget(setObj, key) {
    setTimeout(() => setObj.delete(key), RECENT_TTL);
  }

  function isHttpUrl(u) {
    return typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://'));
  }

  function isDataUrl(u) {
    return typeof u === 'string' && u.startsWith('data:');
  }

  function isBlobUrl(u) {
    return typeof u === 'string' && u.startsWith('blob:');
  }

  // map common mime -> ext
  const mimeToExt = {
    'image/jpeg': 'jpg',
    'image/pjpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'image/tiff': 'tif',
    'image/x-ms-bmp': 'bmp',
  };

  function extFromMime(mime) {
    if (!mime) return null;
    const m = mime.split(';')[0].trim().toLowerCase();
    return mimeToExt[m] || (m.includes('/') ? m.split('/').pop().replace(/\+/g, '-') : null);
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  }

  // try to extract extension from URL path, returns ext without dot or null
  function extFromUrlPath(url) {
    try {
      const u = new URL(url);
      const last = (u.pathname.split('/').filter(Boolean).pop() || '');
      const m = last.match(/\.([a-zA-Z0-9]{1,6})$/);
      return m ? m[1].toLowerCase() : null;
    } catch (e) {
      return null;
    }
  }

  // HEAD fetch with timeout to read Content-Type (only for urls without ext)
  async function headContentType(url, timeoutMs = 3000) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
      clearTimeout(id);
      if (!resp || !resp.ok) return null;
      const ct = resp.headers.get('Content-Type') || resp.headers.get('content-type');
      return ct;
    } catch (e) {
      return null;
    }
  }

  // compute SHA-256 hex from ArrayBuffer
  async function sha256Hex(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Blob -> dataURL
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => { reader.abort(); reject(new Error('FileReader failed')); };
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function handleHttpImage(img) {
  const src = img.src;

  // Skip invalid or chrome-internal URLs
  if (!src || src.startsWith("chrome://") || src.startsWith("chrome-extension://")) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "found_http_image",
    url: src
  });
}

  // handle data: URLs — only send if MIME indicates JPEG (or magic bytes if no MIME)
async function handleDataUrl(src) {
  if (recentlySent.has(src)) return;
  // quick dedupe in-tab
  recentlySent.add(src);
  scheduleForget(recentlySent, src);

  try {
    const comma = src.indexOf(',');
    const header = comma >= 0 ? src.slice(0, comma) : src;
    const m = header.match(/^data:([^;]+);/);
    const mime = m ? m[1] : null;

    // Accept iff mime contains 'jpeg' (covers image/jpeg and image/pjpeg)
    if (mime && mime.toLowerCase().includes('jpeg')) {
      // proceed as before
    } else if (!mime) {
      // If no MIME present, do a quick check of JPEG magic bytes from base64 payload.
      // We'll decode a small prefix of the base64 to inspect first 3 bytes (0xFF 0xD8 0xFF).
      // To get enough bytes we decode the first 32 base64 chars (that's 24 bytes).
      const payload = comma >= 0 ? src.slice(comma + 1) : '';
      if (!payload) {
        recentlySent.delete(src);
        return;
      }
      const prefix = payload.slice(0, 32); // small prefix
      let decoded;
      try {
        decoded = atob(prefix);
      } catch (e) {
        // invalid base64 prefix -> don't trust it
        recentlySent.delete(src);
        return;
      }
      if (decoded.length < 3 ||
          decoded.charCodeAt(0) !== 0xFF ||
          decoded.charCodeAt(1) !== 0xD8 ||
          decoded.charCodeAt(2) !== 0xFF) {
        // not JPEG
        recentlySent.delete(src);
        return;
      }
      // looks like JPEG; proceed
    } else {
      // mime exists but is not JPEG -> ignore
      recentlySent.delete(src);
      return;
    }

    // At this point we know it's JPEG — compute hash and filename as before
    const payload = comma >= 0 ? src.slice(comma + 1) : '';
    // decode full base64 to compute hash (we need the bytes)
    const binary = atob(payload);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    const hash = await sha256Hex(bytes.buffer);
    const ext = 'jpg';
    const filename = `image_${hash.slice(0,12)}.${ext}`;
    chrome.runtime.sendMessage({ type: 'found_dataurl', dataUrl: src, hash, filename }, () => {});
  } catch (e) {
    // on error, free the slot and bail
    recentlySent.delete(src);
  }
}

 // handle blob: URLs — only send if blob.type contains JPEG or blob bytes show JPEG magic
async function handleBlobUrl(src) {
  if (recentlySent.has(src)) return;
  recentlySent.add(src);
  scheduleForget(recentlySent, src);

  try {
    // fetch blob in page context
    const resp = await fetch(src);
    const blob = await resp.blob();

    // If MIME type present and indicates JPEG, accept
    const mime = (blob && blob.type) || '';
    if (mime && mime.toLowerCase().includes('jpeg')) {
      // ok proceed
    } else if (!mime) {
      // no MIME -> inspect first few bytes for JPEG magic
      const slice = await blob.slice(0, 16).arrayBuffer(); // small read
      const view = new Uint8Array(slice);
      if (view.length < 3 || view[0] !== 0xFF || view[1] !== 0xD8 || view[2] !== 0xFF) {
        // not JPEG
        recentlySent.delete(src);
        return;
      }
      // otherwise look like JPEG -> proceed
    } else {
      // MIME present but not JPEG -> ignore
      recentlySent.delete(src);
      return;
    }

    // Compute hash and dataUrl as before
    const buffer = await blob.arrayBuffer();
    const hash = await sha256Hex(buffer);
    const ext = 'jpg';
    const filename = `image_${hash.slice(0,12)}.${ext}`;

    // convert to data URL and send (background will download the data: URL)
    const dataUrl = await blobToDataURL(blob);
    chrome.runtime.sendMessage({ type: 'found_bloburl', dataUrl, hash, filename }, () => {});
  } catch (e) {
    // blob may be revoked or fetch failed; allow retry later
    recentlySent.delete(src);
  }
}


  // main scan loop
  function scanImages() {
    try {
      const imgs = document.images;
      for (let i = 0; i < imgs.length; ++i) {
        const src = imgs[i] && imgs[i].src;
        if (!src) continue;
        if (isHttpUrl(src)) {
          handleHttpImage(src);
          continue;
        }
        if (isDataUrl(src)) {
          handleDataUrl(src);
          continue;
        }
        if (isBlobUrl(src)) {
          handleBlobUrl(src);
          continue;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  const timerId = setInterval(scanImages, INTERVAL_MS);
  window.addEventListener('beforeunload', () => clearInterval(timerId));
})();
