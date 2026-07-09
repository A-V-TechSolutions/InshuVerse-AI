// Deepgram Live (WebSocket) wrapper used by the proactive-listening pipeline.
// Streams 16-kHz mono linear-16 PCM and emits incremental + finalized
// transcripts plus an EndOfTurn signal for downstream question detection.
//
// Usage:
//   const dg = require('./deepgram-stream');
//   const session = dg.start({
//     apiKey, onPartial, onFinal, onTurn, onError, onClose
//   });
//   session.sendAudio(buffer);
//   session.stop();

let WebSocket = null;
try { WebSocket = require('ws'); } catch (_) {}

const DG_BASE = 'wss://api.deepgram.com/v1/listen';
// nova-3 (released Feb 2025): 54% WER reduction vs nova-2 for English
// streaming; latency is comparable. nova-2 is kept in DG_PARAMS_MULTI
// for non-English languages not yet covered by nova-3.
const DG_PARAMS = {
  model:           'nova-3',
  language:        'en-US',
  encoding:        'linear16',
  sample_rate:     '16000',
  channels:        '1',
  smart_format:    'true',
  interim_results: 'true',
  punctuate:       'true',
  endpointing:     '300',
  vad_events:      'true',
};

// Map the app's interview-language codes (Whisper-style ISO-639-1) onto the
// language codes Deepgram Nova-2 streaming actually accepts. App codes that
// have a direct Nova-2 equivalent map 1:1; unsupported codes fall through to
// `multi` (Deepgram's multilingual code-switching mode), which keeps the
// proactive pipeline functional for users who pick e.g. Telugu / Tamil /
// Bhojpuri instead of silently transcribing their speech as English.
//
// Sources:
//   • https://developers.deepgram.com/docs/models-languages-overview
//   • https://developers.deepgram.com/docs/multilingual-code-switching
const DG_LANG_MAP = {
  en:  'en-US',
  es:  'es',
  fr:  'fr',
  de:  'de',
  pt:  'pt',
  it:  'it',
  ru:  'ru',
  zh:  'zh',
  ja:  'ja',
  ko:  'ko',
  nl:  'nl',
  pl:  'pl',
  tr:  'tr',
  sv:  'sv',
  da:  'da',
  fi:  'fi',
  no:  'no',
  uk:  'uk',
  vi:  'vi',
  id:  'id',
  th:  'th',
  ms:  'ms',
  hi:  'hi',
};
// Codes the renderer exposes that Nova-2 streaming does NOT support directly.
// We route them through `multi` so the user still gets transcripts (with
// imperfect accuracy on under-resourced languages) instead of a hard failure.
const DG_MULTI_FALLBACK = new Set([
  'ar', 'te', 'kn', 'ta', 'mr', 'bn', 'gu', 'ml', 'pa', 'ur', 'bho',
]);

function mapLanguage(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return { language: 'en-US', model: 'nova-3' };
  if (DG_LANG_MAP[c]) {
    // nova-3 is recommended for English (best accuracy + lowest WER).
    // Non-English single-language streaming uses nova-2 until nova-3 reaches
    // full multilingual coverage (expected H2 2026 per Deepgram roadmap).
    const isEnglish = c === 'en';
    return { language: DG_LANG_MAP[c], model: isEnglish ? 'nova-3' : 'nova-2' };
  }
  if (DG_MULTI_FALLBACK.has(c)) {
    return { language: 'multi', model: 'nova-2' };
  }
  // Unknown code — fall back to multi rather than fail the WS handshake.
  return { language: 'multi', model: 'nova-2' };
}

function _buildUrl(extra) {
  const params = Object.assign({}, DG_PARAMS, extra || {});
  const qs = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return DG_BASE + '?' + qs;
}

function start(opts) {
  const apiKey = opts && opts.apiKey;
  if (!WebSocket) {
    throw new Error('Deepgram unavailable: "ws" module is not installed');
  }
  if (!apiKey) {
    throw new Error('Deepgram unavailable: missing API key');
  }

  // Resolve the language code → Deepgram language + model. Caller-supplied
  // `opts.params` still wins so existing tests / advanced overrides are
  // unaffected; the language mapping only fills in defaults.
  const langResolved = mapLanguage(opts && opts.languageCode);
  const mergedParams = Object.assign(
    { language: langResolved.language, model: langResolved.model },
    (opts && opts.params) || {}
  );

  const onPartial = typeof opts.onPartial === 'function' ? opts.onPartial : () => {};
  const onFinal   = typeof opts.onFinal   === 'function' ? opts.onFinal   : () => {};
  const onTurn    = typeof opts.onTurn    === 'function' ? opts.onTurn    : () => {};
  const onError   = typeof opts.onError   === 'function' ? opts.onError   : () => {};
  const onClose   = typeof opts.onClose   === 'function' ? opts.onClose   : () => {};
  const onOpen    = typeof opts.onOpen    === 'function' ? opts.onOpen    : () => {};

  let ws = null;
  let keepaliveTimer = null;
  let sessionRefreshTimer = null;
  let stopped = false;
  let openedAt = 0;
  let bytesSent = 0;
  let pendingTurnText = '';
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let lastTransientError = null;
  let plannedRefresh = false;
  const RECONNECT_DELAYS_MS = [500, 1000, 2000];
  // Periodic session refresh — Deepgram streaming has documented (and
  // tier-dependent) maximum session lengths and load-balancer-driven idle
  // disconnects that have stranded long-running interview sessions. Closing
  // the WS at a fixed cadence and letting the existing reconnect path rebuild
  // it sidesteps both. 25 min is well below the documented ceilings.
  const MAX_SESSION_MS = 25 * 60 * 1000;

  function _scheduleReconnect(why) {
    if (stopped) return;
    if (reconnectAttempts >= RECONNECT_DELAYS_MS.length) {
      const err = lastTransientError || new Error('Deepgram unreachable: ' + (why || 'unknown'));
      try { onError(err, { terminal: true }); } catch (_) {}
      const tail = pendingTurnText.trim();
      pendingTurnText = '';
      if (tail) { try { onTurn(tail, { reason: 'close' }); } catch (_) {} }
      try { onClose(1006, 'reconnect-exhausted'); } catch (_) {}
      return;
    }
    const delay = RECONNECT_DELAYS_MS[reconnectAttempts] || 2000;
    reconnectAttempts += 1;
    // First transient drop: surface a non-terminal hint so the renderer can
    // show a discreet "Reconnecting…" status while we backoff. Subsequent
    // attempts stay silent to avoid flicker. Planned refreshes are silent —
    // the user shouldn't see a reconnect toast for a healthy rotation.
    if (reconnectAttempts === 1 && !plannedRefresh) {
      try {
        onError(lastTransientError || new Error('Deepgram disconnected: ' + (why || 'unknown')),
          { reconnecting: true, attempt: reconnectAttempts });
      } catch (_) {}
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (stopped) return;
      try { _connect(); }
      catch (e) { lastTransientError = e; _scheduleReconnect('reconnect-throw'); }
    }, delay);
  }

  function _connect() {
    ws = new WebSocket(_buildUrl(mergedParams), {
      headers: { Authorization: 'Token ' + apiKey },
    });

    ws.on('open', () => {
      const wasReconnecting = reconnectAttempts > 0;
      const wasPlannedRefresh = plannedRefresh;
      plannedRefresh = false;
      openedAt = Date.now();
      reconnectAttempts = 0;
      lastTransientError = null;
      keepaliveTimer = setInterval(() => {
        try {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        } catch (_) {}
      }, 5000);
      // Schedule the next planned refresh. Suppress the renderer-facing
      // reconnect notice for the rotation so users see no flicker.
      if (sessionRefreshTimer) { clearTimeout(sessionRefreshTimer); sessionRefreshTimer = null; }
      sessionRefreshTimer = setTimeout(() => {
        if (stopped) return;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        plannedRefresh = true;
        try { ws.close(1000, 'planned-refresh'); } catch (_) {}
      }, MAX_SESSION_MS);
      // Suppress the "Reconnected" status when the open is the result of a
      // planned refresh — nothing was wrong, the user shouldn't see a toast.
      try { onOpen({ reconnected: wasReconnecting && !wasPlannedRefresh }); } catch (_) {}
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (!msg || !msg.type) return;

      if (msg.type === 'Results') {
        const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
        const text = (alt && alt.transcript) ? String(alt.transcript) : '';
        if (!text) return;
        if (msg.is_final) {
          pendingTurnText = (pendingTurnText ? pendingTurnText + ' ' : '') + text;
          try { onFinal(text, msg); } catch (_) {}
          if (msg.speech_final) {
            const turnText = pendingTurnText.trim();
            pendingTurnText = '';
            if (turnText) { try { onTurn(turnText, msg); } catch (_) {} }
          }
        } else {
          try { onPartial(text, msg); } catch (_) {}
        }
      } else if (msg.type === 'UtteranceEnd') {
        const turnText = pendingTurnText.trim();
        pendingTurnText = '';
        if (turnText) { try { onTurn(turnText, msg); } catch (_) {} }
      } else if (msg.type === 'Error') {
        try { onError(new Error(msg.description || 'Deepgram error')); } catch (_) {}
      }
    });

    // Transient errors are deferred — the close handler decides whether to
    // reconnect or surface a terminal failure. This avoids spamming the
    // renderer with a 'proactive-error' toast on every flaky packet.
    ws.on('error', (err) => { lastTransientError = err; });

    ws.on('close', (code, reason) => {
      if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
      if (sessionRefreshTimer) { clearTimeout(sessionRefreshTimer); sessionRefreshTimer = null; }
      const reasonStr = String(reason || '');
      const wasUserStop = stopped;
      ws = null;

      if (wasUserStop) {
        const tail = pendingTurnText.trim();
        pendingTurnText = '';
        if (tail) { try { onTurn(tail, { reason: 'close' }); } catch (_) {} }
        try { onClose(code, reasonStr); } catch (_) {}
        return;
      }

      // Auth/protocol failures (1008, 4xxx) are not retry-worthy.
      const isAuthFailure = code === 1008 || (code >= 4000 && code < 4500) ||
        /401|403|unauthor|forbid|invalid.*key/i.test(reasonStr);
      if (isAuthFailure) {
        const tail = pendingTurnText.trim();
        pendingTurnText = '';
        if (tail) { try { onTurn(tail, { reason: 'close' }); } catch (_) {} }
        try { onError(new Error('Deepgram auth failed: ' + reasonStr), { terminal: true }); } catch (_) {}
        try { onClose(code, reasonStr); } catch (_) {}
        return;
      }

      // Transient: schedule a backoff reconnect. pendingTurnText is preserved
      // across the reconnect so an in-flight utterance is not lost.
      _scheduleReconnect(`close ${code} ${reasonStr}`);
    });
  }

  function sendAudio(buffer) {
    if (stopped || !ws || ws.readyState !== WebSocket.OPEN || !buffer) return;
    try {
      ws.send(buffer);
      bytesSent += buffer.length || 0;
    } catch (_) {}
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    if (sessionRefreshTimer) { clearTimeout(sessionRefreshTimer); sessionRefreshTimer = null; }
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
    } catch (_) {}
    setTimeout(() => {
      try { if (ws) ws.close(); } catch (_) {}
    }, 200);
  }

  function status() {
    return {
      connected: !!(ws && ws.readyState === WebSocket.OPEN),
      bytesSent,
      uptimeMs: openedAt ? (Date.now() - openedAt) : 0,
    };
  }

  _connect();
  return { sendAudio, stop, status };
}

module.exports = { start, mapLanguage };
