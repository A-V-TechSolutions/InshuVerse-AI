// Public RAG API for the renderer. Orchestrates the full lifecycle:
//
//   addFiles(filePaths, { onProgress })
//       extract → chunk → persist to IndexedDB
//       Returns { added: [{ id, name, chunkCount }], errors: [{ name, error }] }
//
//   listFiles()                — Promise<Array<doc-meta>>
//   removeFile(id)             — Promise<boolean>
//   clearAll()                 — Promise<void>
//   stats()                    — Promise<{ docCount, chunkCount }>
//
//   retrieve(query, { k }) — Promise<Array<{ text, source, score, chunkIndex }>>
//       Pure-JS BM25 lexical search across all stored chunks. No model load,
//       no native deps — runs entirely in V8 in the renderer.
//
//   warmup()                   — Promise<boolean> (no-op kept for API compat)
//
// Storage is IndexedDB (renderer-only). Designed to be used as window.AngelRag.

const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const { chunkText } = require('./chunker');
const { extractDocument, isSupported, getExt } = require('./extractor');
const { bm25Search } = require('./lexical-search');
const store = require('./store');

const MAX_DOCUMENTS = 25;
const MAX_TOTAL_CHUNKS = 4000;

// In-renderer LRU cache of all chunks across all docs. Refreshed on every
// add/remove/clear so we never serve stale data, yet we don't pay the
// IndexedDB getAll round-trip on every query.
let _chunksCache = null;
async function _getChunks() {
  if (_chunksCache) return _chunksCache;
  _chunksCache = await store.getAllChunks();
  return _chunksCache;
}

// BroadcastChannel keeps multiple windows/processes in sync. When one
// window mutates the corpus (add/remove/clear) it publishes 'invalidate'
// so every other listener drops its in-memory chunks cache and re-reads
// from IndexedDB on the next retrieve(). No-op outside the renderer
// (BroadcastChannel is a browser API; missing in plain node tests).
let _bc = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    _bc = new BroadcastChannel('angel-rag');
    _bc.onmessage = (ev) => {
      if (ev && ev.data && ev.data.type === 'invalidate') _chunksCache = null;
    };
  }
} catch (_) { _bc = null; }

function _invalidateCache() {
  _chunksCache = null;
  try { if (_bc) _bc.postMessage({ type: 'invalidate', t: Date.now() }); } catch (_) {}
}

function _hash(s) {
  return crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 16);
}

function _docId(name, textHash) {
  return `${textHash}-${_hash(name)}`;
}

async function listFiles() {
  return await store.listDocuments();
}

async function stats() {
  const [docs, chunkCount] = await Promise.all([store.listDocuments(), store.getChunkCount()]);
  return { docCount: docs.length, chunkCount };
}

async function removeFile(id) {
  const ok = await store.removeDocument(id);
  _invalidateCache();
  return ok;
}

async function clearAll() {
  await store.clearAll();
  _invalidateCache();
}

// onProgress receives:
//   { phase: 'extract'|'index'|'persist'|'done',
//     file?: string, fileIndex?: number, fileTotal?: number,
//     chunkIndex?: number, chunkTotal?: number, message?: string }
async function addFiles(filePaths, opts) {
  const o = opts || {};
  const onProgress = typeof o.onProgress === 'function' ? o.onProgress : () => {};
  const list = (filePaths || []).filter(p => p && isSupported(p));
  if (list.length === 0) {
    return { added: [], errors: [{ name: '', error: 'No supported files selected. Allowed: PDF, DOCX, TXT, MD.' }] };
  }

  // Enforce hard cap before starting work
  const existing = await store.listDocuments();
  if (existing.length + list.length > MAX_DOCUMENTS) {
    return {
      added: [],
      errors: [{ name: '', error: `Knowledge base limit reached (${MAX_DOCUMENTS} files). Remove some before adding more.` }],
    };
  }

  const added = [];
  const errors = [];
  let runningChunkTotal = await store.getChunkCount();

  for (let i = 0; i < list.length; i++) {
    const filePath = list[i];
    const name = path.basename(filePath);
    const ext = getExt(filePath);
    try {
      onProgress({ phase: 'extract', file: name, fileIndex: i + 1, fileTotal: list.length });
      const { text, pages, bytes } = await extractDocument(filePath);

      const chunks = chunkText(text, { targetTokens: 500, overlapTokens: 50 });
      if (chunks.length === 0) throw new Error('Document produced no chunks (text too short).');
      if (runningChunkTotal + chunks.length > MAX_TOTAL_CHUNKS) {
        throw new Error(`Adding this file would exceed the ${MAX_TOTAL_CHUNKS}-chunk corpus limit.`);
      }

      const textHash = _hash(text);
      const id = _docId(name, textHash);

      // Skip if an identical document is already indexed (same name + content hash)
      const existingDoc = await store.getDocument(id);
      if (existingDoc) {
        added.push({ id, name, chunkCount: existingDoc.chunkCount, skipped: true });
        continue;
      }

      // Lexical pipeline has no embed phase: emit one 'index' tick so the
      // modal advances visibly even on tiny files, then go straight to persist.
      onProgress({
        phase: 'index', file: name, fileIndex: i + 1, fileTotal: list.length,
        chunkIndex: chunks.length, chunkTotal: chunks.length,
      });

      const rows = chunks.map((text, idx) => ({
        id: `${id}-${idx}`,
        docId: id,
        chunkIndex: idx,
        text,
      }));
      const doc = {
        id,
        name,
        ext,
        bytes: bytes || 0,
        pages: pages || 0,
        chunkCount: rows.length,
        createdAt: Date.now(),
        textHash,
      };
      onProgress({ phase: 'persist', file: name, fileIndex: i + 1, fileTotal: list.length });
      await store.addDocument(doc, rows);
      runningChunkTotal += rows.length;
      added.push({ id, name, chunkCount: rows.length });
      _invalidateCache();
    } catch (e) {
      errors.push({ name, error: e.message || String(e) });
    }
  }

  onProgress({ phase: 'done', fileTotal: list.length });
  return { added, errors };
}

// Top-K retrieval via BM25 lexical scoring.
async function retrieve(query, opts) {
  const o = opts || {};
  const k = Number.isFinite(o.k) ? o.k : 4;
  const text = String(query || '').trim();
  if (!text) return [];
  const chunks = await _getChunks();
  if (chunks.length === 0) return [];

  const docs = await store.listDocuments();
  const nameById = new Map(docs.map(d => [d.id, d.name]));
  const rows = chunks.map(c => ({
    id: c.id,
    text: c.text,
    source: nameById.get(c.docId) || 'document',
    chunkIndex: c.chunkIndex,
  }));
  const hits = bm25Search(rows, text, { k });
  return hits.map(h => ({
    text: h.text,
    source: h.source,
    score: h.score,
    chunkIndex: h.chunkIndex,
  }));
}

// Kept for API compatibility; the lexical pipeline has nothing to warm up
// (no model, no native bindings). Resolves true so callers can `await` it.
async function warmup() { return true; }

// Fetch content from a URL and add it to the knowledge base
async function addLink(url, opts) {
  const o = opts || {};
  const onProgress = typeof o.onProgress === 'function' ? o.onProgress : () => {};

  try {
    onProgress({ phase: 'extract', message: `Fetching content from ${url}` });

    // Fetch content from URL
    const content = await fetchUrlContent(url);
    if (!content || content.trim().length === 0) {
      throw new Error('No content could be fetched from the URL');
    }

    // Generate a name from the URL
    const urlObj = new URL(url);
    const name = urlObj.hostname + urlObj.pathname.replace(/\/$/, '').split('/').pop() || urlObj.hostname;
    const ext = 'txt';

    // Check document limit
    const existing = await store.listDocuments();
    if (existing.length >= MAX_DOCUMENTS) {
      throw new Error(`Knowledge base limit reached (${MAX_DOCUMENTS} files). Remove some before adding more.`);
    }

    // Chunk the content
    onProgress({ phase: 'index', message: 'Processing content' });
    const chunks = chunkText(content, { targetTokens: 500, overlapTokens: 50 });
    if (chunks.length === 0) {
      throw new Error('URL content produced no chunks (text too short).');
    }

    // Check chunk limit
    const runningChunkTotal = await store.getChunkCount();
    if (runningChunkTotal + chunks.length > MAX_TOTAL_CHUNKS) {
      throw new Error(`Adding this URL would exceed the ${MAX_TOTAL_CHUNKS}-chunk corpus limit.`);
    }

    const textHash = _hash(content);
    const id = _docId(name, textHash);

    // Skip if identical content already exists
    const existingDoc = await store.getDocument(id);
    if (existingDoc) {
      return { added: [{ id, name, chunkCount: existingDoc.chunkCount, skipped: true }], errors: [] };
    }

    // Prepare document and chunks for storage
    const rows = chunks.map((text, idx) => ({
      id: `${id}-${idx}`,
      docId: id,
      chunkIndex: idx,
      text,
    }));

    const doc = {
      id,
      name: `${name} (from ${url})`,
      ext,
      bytes: content.length,
      pages: 1,
      chunkCount: rows.length,
      createdAt: Date.now(),
      textHash,
      sourceUrl: url,
    };

    onProgress({ phase: 'persist', message: 'Saving to knowledge base' });
    await store.addDocument(doc, rows);

    _invalidateCache();
    onProgress({ phase: 'done', message: 'Successfully added URL content' });

    return { added: [{ id, name: doc.name, chunkCount: rows.length }], errors: [] };
  } catch (e) {
    console.error('[RAG] addLink failed:', e);
    return { added: [], errors: [{ name: url, error: e.message || String(e) }] };
  }
}

// Helper function to fetch content from a URL
function fetchUrlContent(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 15000 // 15 second timeout
    };

    const req = protocol.request(url, options, (res) => {
      let data = '';

      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrlContent(res.headers.location).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }

      // Check content type
      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('text/') && !contentType.includes('html') && !contentType.includes('json')) {
        return reject(new Error('Unsupported content type. Only text-based content is supported.'));
      }

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        // Basic HTML tag removal if content is HTML
        if (contentType.includes('html')) {
          data = data
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
        resolve(data);
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to fetch URL: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

module.exports = {
  addFiles, addLink, listFiles, removeFile, clearAll, stats, retrieve, warmup,
  MAX_DOCUMENTS, MAX_TOTAL_CHUNKS,
};
