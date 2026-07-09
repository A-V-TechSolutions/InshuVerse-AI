// IndexedDB-backed persistent store for RAG documents and chunk text.
// Schema (database: "angel-rag", version 1):
//
//   documents    keyPath: id      → { id, name, ext, bytes, pages, chunkCount,
//                                     createdAt, textHash }
//   chunks       keyPath: id      → { id, docId, chunkIndex, text }
//                index: by_docId  on .docId (for cascading delete)
//
// All operations return Promises. Renderer-only (relies on window.indexedDB).

const DB_NAME = 'angel-rag';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';
const STORE_CHUNKS = 'chunks';

function _openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this context'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const cs = db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
        cs.createIndex('by_docId', 'docId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function _tx(db, stores, mode) {
  const tx = db.transaction(stores, mode);
  return {
    tx,
    done: new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction error'));
    }),
  };
}

function _req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function listDocuments() {
  const db = await _openDB();
  try {
    const { tx } = _tx(db, [STORE_DOCS], 'readonly');
    const docs = await _req(tx.objectStore(STORE_DOCS).getAll());
    return (docs || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } finally { db.close(); }
}

async function getDocument(id) {
  const db = await _openDB();
  try {
    const { tx } = _tx(db, [STORE_DOCS], 'readonly');
    return (await _req(tx.objectStore(STORE_DOCS).get(id))) || null;
  } finally { db.close(); }
}

// doc:    { id, name, ext, bytes, pages, chunkCount, createdAt, textHash }
// chunks: Array<{ id, docId, chunkIndex, text }>
async function addDocument(doc, chunks) {
  if (!doc || !doc.id) throw new Error('addDocument: doc.id required');
  const rows = Array.isArray(chunks) ? chunks : [];
  const db = await _openDB();
  try {
    const { tx, done } = _tx(db, [STORE_DOCS, STORE_CHUNKS], 'readwrite');
    tx.objectStore(STORE_DOCS).put(doc);
    const cs = tx.objectStore(STORE_CHUNKS);
    for (const c of rows) cs.put(c);
    await done;
    return doc;
  } finally { db.close(); }
}

async function removeDocument(id) {
  if (!id) return false;
  const db = await _openDB();
  try {
    const { tx, done } = _tx(db, [STORE_DOCS, STORE_CHUNKS], 'readwrite');
    tx.objectStore(STORE_DOCS).delete(id);
    const idx = tx.objectStore(STORE_CHUNKS).index('by_docId');
    const cur = idx.openCursor(IDBKeyRange.only(id));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { c.delete(); c.continue(); }
    };
    await done;
    return true;
  } finally { db.close(); }
}

async function clearAll() {
  const db = await _openDB();
  try {
    const { tx, done } = _tx(db, [STORE_DOCS, STORE_CHUNKS], 'readwrite');
    tx.objectStore(STORE_DOCS).clear();
    tx.objectStore(STORE_CHUNKS).clear();
    await done;
  } finally { db.close(); }
}

// Returns ALL chunks across all documents — call once per query and cache
// in the controller. Chunks are small (text-only, typically < 2 KB each)
// so even 5k chunks fits comfortably in memory.
async function getAllChunks() {
  const db = await _openDB();
  try {
    const { tx } = _tx(db, [STORE_CHUNKS], 'readonly');
    return (await _req(tx.objectStore(STORE_CHUNKS).getAll())) || [];
  } finally { db.close(); }
}

async function getChunkCount() {
  const db = await _openDB();
  try {
    const { tx } = _tx(db, [STORE_CHUNKS], 'readonly');
    return await _req(tx.objectStore(STORE_CHUNKS).count());
  } finally { db.close(); }
}

module.exports = {
  listDocuments, getDocument, addDocument, removeDocument,
  clearAll, getAllChunks, getChunkCount,
  DB_NAME, DB_VERSION,
};
