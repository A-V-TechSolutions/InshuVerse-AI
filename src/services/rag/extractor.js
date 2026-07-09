// Document text extractor for the RAG pipeline. Runs in the renderer
// (nodeIntegration: true) so we can require() pure-JS parsers directly.
//
// Supported types:
//   .pdf  → pdfjs-dist@2 legacy CJS build. We pin to v2.16.105 deliberately
//           because v3 added an optional `canvas` (node-canvas) dep and v4
//           added a hard `@napi-rs/canvas` require at module-init — both ship
//           native .node bindings that crash the Electron renderer (exit 5)
//           when their ABI doesn't match Electron's bundled Node ABI.
//           v2's only deps are dommatrix + web-streams-polyfill (pure JS).
//   .docx → mammoth.extractRawText
//   .txt  → fs.readFile (utf-8)
//   .md   → fs.readFile (utf-8)
//
// Returns { text, pages } where `pages` is non-zero only for PDFs.
// Throws an Error with a user-friendly message on:
//   - unsupported extension
//   - empty / non-text content (likely a scanned PDF)
//   - parse failure

const fs = require('fs');
const path = require('path');
const { looksLikeRealText } = require('./chunker');

const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.txt', '.md', '.markdown']);
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB hard cap per file

function getExt(filePath) {
  return String(path.extname(filePath || '')).toLowerCase();
}

function isSupported(filePath) {
  return SUPPORTED_EXTS.has(getExt(filePath));
}

// Cache the loaded pdfjs module so subsequent uploads in the same session
// don't pay the require cost again. v2 ships a CommonJS legacy build, so a
// plain require() works — no dynamic import, no ESM resolver involvement.
let _pdfjs = null;
function _loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  return _pdfjs;
}

async function extractFromPdf(filePath) {
  console.log('[RAG] pdf: loading pdfjs-dist for', path.basename(filePath));
  // Lazy require — pdfjs-dist is heavy (~2 MB), defer until the first PDF
  // shows up so users who only upload TXT/MD never pay the cost.
  const pdfjs = _loadPdfjs();
  // pdfjs v2 always boots a worker (real or fake). Even with disableWorker
  // it consults GlobalWorkerOptions.workerSrc during fake-worker setup and
  // throws "No GlobalWorkerOptions.workerSrc specified" if empty. Point it
  // at the bundled worker file via require.resolve so it works in dev and
  // when packaged inside app.asar.
  try {
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc =
        require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
      console.log('[RAG] pdf: workerSrc=', pdfjs.GlobalWorkerOptions.workerSrc);
    }
  } catch (e) {
    console.warn('[RAG] pdf: could not resolve worker path:', e && e.message);
  }
  const data = new Uint8Array(fs.readFileSync(filePath));
  console.log('[RAG] pdf: read', data.length, 'bytes; opening document');
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const pages = pdf.numPages;
  console.log('[RAG] pdf: opened', pages, 'pages');
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = (content.items || [])
      .map(it => (typeof it.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (pageText) out.push(pageText);
  }
  try { await pdf.cleanup(); } catch (_) {}
  try { await pdf.destroy(); } catch (_) {}
  console.log('[RAG] pdf: extracted', out.length, 'non-empty pages');
  return { text: out.join('\n\n'), pages };
}

async function extractFromDocx(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return { text: String(result.value || '').trim(), pages: 0 };
}

function extractFromPlainText(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  return { text: String(text || '').trim(), pages: 0 };
}

async function extractDocument(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('extractDocument: filePath required');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${path.basename(filePath)}`);
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`File too large (${(stat.size / (1024 * 1024)).toFixed(1)} MB). Max 50 MB.`);
  }
  const ext = getExt(filePath);
  if (!SUPPORTED_EXTS.has(ext)) {
    throw new Error(`Unsupported file type: ${ext || '(none)'}. Supported: PDF, DOCX, TXT, MD.`);
  }

  let result;
  try {
    if (ext === '.pdf')                                    result = await extractFromPdf(filePath);
    else if (ext === '.docx')                              result = await extractFromDocx(filePath);
    else /* .txt / .md / .markdown */                      result = extractFromPlainText(filePath);
  } catch (e) {
    throw new Error(`Failed to read ${path.basename(filePath)}: ${e.message}`);
  }

  const text = (result.text || '').trim();
  if (!text) {
    throw new Error(
      ext === '.pdf'
        ? `${path.basename(filePath)} appears to be a scanned PDF (no extractable text). Please upload a text-based PDF.`
        : `${path.basename(filePath)} contains no readable text.`
    );
  }
  if (!looksLikeRealText(text)) {
    throw new Error(
      `${path.basename(filePath)} does not contain readable text (likely scanned or encoded). Please upload a text-based document.`
    );
  }
  return { text, pages: result.pages || 0, bytes: stat.size };
}

module.exports = {
  extractDocument,
  isSupported,
  getExt,
  SUPPORTED_EXTS,
  MAX_FILE_BYTES,
};
