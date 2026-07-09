// AssemblyAI Universal-Streaming (v3) WebSocket wrapper used by the
// proactive-listening pipeline as the primary provider for Free users
// and the secondary fallback for paid users (see main.js#proactive-start).
//
// Public API mirrors deepgram-stream.js exactly so a single call site can
// swap providers at runtime:
//   const aai = require('./assemblyai-stream');
//   const session = aai.start({
//     apiKey, languageCode, onPartial, onFinal, onTurn, onError, onClose, onOpen
//   });
//   session.sendAudio(buffer);   // 16-kHz mono linear-16 PCM
//   session.stop();
//
// Reference: https://www.assemblyai.com/docs/speech-to-text/universal-streaming

let WebSocket = null;
try { WebSocket = require('ws'); } catch (_) {}

const AAI_BASE = 'wss://streaming.assemblyai.com/v3/ws';
// Universal-Streaming v3 parameters. The turn-detection trio is tuned so the
// perceived end-of-turn cadence matches deepgram-stream.js (which uses
// `endpointing=300` plus `vad_events=true` for a confident ~half-second
// finalization with a longer fallback). Defaults (160ms / 0.7 / 2400ms) fired
// `end_of_turn` aggressively on every micro-pause, which the orchestration
// layer interpreted as a complete question and submitted to the LLM
// prematurely. The values below are caller-overridable via opts.params so
// future tuning does not require a wrapper change.
const AAI_PARAMS = {
  // Universal-Streaming English is the "traditional" streaming model that
  // emits partials word-by-word as audio is processed (each word revised
  // until stabilized). u3-rt-pro is more accurate but emits its first
  // partial only after ~750ms of continuous speech, then silence-based
  // partials — that 750ms gating is what made the bubble feel "stuck"
  // for the user. Trading some end-of-turn polish for true word-by-word
  // streaming was the right call for this UX. Non-English app codes are
  // already routed away by mapLanguage(), and the wrapper's existing
  // language fallback is unchanged.
  speech_model:                              'universal-streaming-english',
  sample_rate:                               '16000',
  // `format_turns` is intentionally omitted. universal-streaming-english
  // *does* support it, but enabling it would emit two terminal Turn
  // messages per turn_order (unformatted then formatted) — both carrying
  // the FULL turn transcript — which our renderer's append-final path
  // would render twice (visible stutter). The unformatted terminal
  // already carries reasonable casing; we trade ITN polish (numerals,
  // dates, phone numbers) for a single-shot terminal that fires onTurn
  // immediately, matching Deepgram's "one final per logical commit".
  // Minimum silence (ms) before an end-of-turn check fires. The
  // documented universal-streaming default is 400ms; we raise it so
  // brief mid-thought pauses do not trip the detector. NOTE: this is the
  // correct parameter name for universal-streaming-english (a previous
  // u3-rt-pro tuning used `min_end_of_turn_silence_when_confident`,
  // which is silently ignored by the universal-streaming server).
  min_turn_silence:                          '600',
  // Hard ceiling on intra-turn silence regardless of confidence (default
  // 1280ms). Raised so a slow speaker with a long pause mid-question is
  // still treated as one turn.
  max_turn_silence:                          '2400',
  // Confidence required for the model to declare a turn end (default
  // 0.4 / "balanced", 0.7 / "conservative"). 0.7 keeps premature
  // commits in check without inflating perceived latency the way 0.9
  // did on u3-rt-pro.
  end_of_turn_confidence_threshold:          '0.7',
};

// AssemblyAI Universal-Streaming v3 is currently English-only ("Universal"
// model). Non-English app codes still produce a working session but the
// transcripts will be best-effort English. Phase 2 will route non-English
// users to Deepgram automatically; for phase 1 we just expose the resolver
// so the call site can detect mismatches and pick a different provider.
function mapLanguage(code) {
  const c = String(code || '').trim().toLowerCase();
  // The endpoint does not accept a `language` parameter on the v3 path;
  // the model is multilingual-by-input. Returning a descriptor keeps the
  // public shape parallel to deepgram-stream.js#mapLanguage so any future
  // language gating in the call site stays symmetric.
  const supported = c === '' || c === 'en';
  return { language: c || 'en', supported, model: 'universal-streaming-english' };
}

function _buildUrl(extra) {
  const params = Object.assign({}, AAI_PARAMS, extra || {});
  const qs = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return AAI_BASE + '?' + qs;
}

function start(opts) {
  const apiKey = opts && opts.apiKey;
  if (!WebSocket) throw new Error('AssemblyAI unavailable: "ws" module is not installed');
  if (!apiKey)    throw new Error('AssemblyAI unavailable: missing API key');

  const mergedParams = Object.assign({}, (opts && opts.params) || {});
  const onPartial = typeof opts.onPartial === 'function' ? opts.onPartial : () => {};
  const onFinal   = typeof opts.onFinal   === 'function' ? opts.onFinal   : () => {};
  const onTurn    = typeof opts.onTurn    === 'function' ? opts.onTurn    : () => {};
  const onError   = typeof opts.onError   === 'function' ? opts.onError   : () => {};
  const onClose   = typeof opts.onClose   === 'function' ? opts.onClose   : () => {};
  const onOpen    = typeof opts.onOpen    === 'function' ? opts.onOpen    : () => {};

  let ws = null;
  let stopped = false;
  let openedAt = 0;
  let bytesSent = 0;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let lastTransientError = null;
  // Accumulator for the in-flight turn. Mirrors deepgram-stream.js so
  // onTurn fires once per logical end-of-turn. Preserved across reconnects
  // so an in-flight utterance is not lost mid-network-blip. With
  // format_turns omitted from the params the server emits exactly one
  // terminal Turn per turn_order, so a single dedup guard
  // (lastEmittedTurnOrder) is sufficient — onFinal and onTurn fire
  // together off the same terminal message.
  let pendingTurnText = '';
  let lastEmittedTurnOrder = -1;
  const RECONNECT_DELAYS_MS = [500, 1000, 2000];

  function _scheduleReconnect(why) {
    if (stopped) return;
    if (reconnectAttempts >= RECONNECT_DELAYS_MS.length) {
      const err = lastTransientError || new Error('AssemblyAI unreachable: ' + (why || 'unknown'));
      try { onError(err, { terminal: true }); } catch (_) {}
      const tail = pendingTurnText.trim();
      pendingTurnText = '';
      if (tail) { try { onTurn(tail, { reason: 'close' }); } catch (_) {} }
      try { onClose(1006, 'reconnect-exhausted'); } catch (_) {}
      return;
    }
    const delay = RECONNECT_DELAYS_MS[reconnectAttempts] || 2000;
    reconnectAttempts += 1;
    if (reconnectAttempts === 1) {
      try {
        onError(lastTransientError || new Error('AssemblyAI disconnected: ' + (why || 'unknown')),
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
      headers: { Authorization: apiKey },
    });

    ws.on('open', () => {
      const wasReconnecting = reconnectAttempts > 0;
      openedAt = Date.now();
      reconnectAttempts = 0;
      lastTransientError = null;
      try { onOpen({ reconnected: wasReconnecting }); } catch (_) {}
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (!msg || !msg.type) return;

      // AssemblyAI v3 message taxonomy:
      //   • Begin       — session metadata (id, expires_at). No transcript.
      //   • Turn        — transcript update. Same turn_order may appear many
      //                   times: ongoing word-by-word partials
      //                   (end_of_turn=false), then exactly one terminal
      //                   turn (end_of_turn=true). format_turns is omitted
      //                   from the params so the server does not emit the
      //                   second formatted-terminal that the dual-emit
      //                   path used to dedup against.
      //   • Termination — server-initiated close; the WS close handler runs next.
      //   • Error       — protocol/auth error; surfaced as a terminal-ish error.
      //
      // Cadence parity with Deepgram:
      //   • partial → onPartial (Deepgram: is_final=false)
      //   • final   → onFinal + onTurn (Deepgram: is_final=true / UtteranceEnd)
      // onTurn fires once per logical turn — guarded by lastEmittedTurnOrder
      // so any duplicate / out-of-order terminal can not double-fire.
      if (msg.type === 'Begin') {
        return;
      }
      if (msg.type === 'Turn') {
        const text  = (typeof msg.transcript === 'string') ? msg.transcript : '';
        const order = (typeof msg.turn_order === 'number') ? msg.turn_order : -1;
        if (!text) return;
        if (!msg.end_of_turn) {
          try { onPartial(text, msg); } catch (_) {}
          return;
        }
        // Terminal turn — Deepgram-style is_final analog. Replace (not
        // append) the pending buffer because AssemblyAI re-sends the full
        // turn transcript each message rather than incremental fragments.
        pendingTurnText = text;
        // onFinal + onTurn fire together off the first terminal Turn,
        // mirroring Deepgram's "one final per logical commit" cadence.
        // The earlier wrapper waited for a `turn_is_formatted:true`
        // terminal that never arrived, stranding onTurn until the
        // renderer's silence-fallback timer fired — the perceived 2–4s
        // "stuck" delay. With format_turns omitted there is only one
        // terminal per turn_order, so this single guard is sufficient.
        if (order !== lastEmittedTurnOrder) {
          lastEmittedTurnOrder = order;
          try { onFinal(text, msg); } catch (_) {}
          const turnText = pendingTurnText.trim();
          pendingTurnText = '';
          if (turnText) { try { onTurn(turnText, msg); } catch (_) {} }
        }
      } else if (msg.type === 'Termination') {
        // Server-initiated close — close handler will fire next.
      } else if (msg.type === 'Error') {
        try { onError(new Error(msg.error || msg.message || 'AssemblyAI error')); } catch (_) {}
      }
    });

    ws.on('error', (err) => { lastTransientError = err; });

    ws.on('close', (code, reason) => {
      const reasonStr = String(reason || '');
      const wasUserStop = stopped;
      ws = null;
      if (wasUserStop) {
        // Flush any in-flight turn so a question that was being formatted
        // when the user hit Stop is still surfaced to the orchestration
        // layer (parity with deepgram-stream.js close-handler).
        const tail = pendingTurnText.trim();
        pendingTurnText = '';
        if (tail) { try { onTurn(tail, { reason: 'close' }); } catch (_) {} }
        try { onClose(code, reasonStr); } catch (_) {}
        return;
      }
      // 401/403 / 4xxx auth-protocol failures are not retry-worthy.
      const isAuthFailure = code === 1008 || (code >= 4000 && code < 4500) ||
        /401|403|unauthor|forbid|invalid.*key/i.test(reasonStr);
      if (isAuthFailure) {
        const tail = pendingTurnText.trim();
        pendingTurnText = '';
        if (tail) { try { onTurn(tail, { reason: 'close' }); } catch (_) {} }
        try { onError(new Error('AssemblyAI auth failed: ' + reasonStr), { terminal: true }); } catch (_) {}
        try { onClose(code, reasonStr); } catch (_) {}
        return;
      }
      _scheduleReconnect(`close ${code} ${reasonStr}`);
    });
  }

  function sendAudio(buffer) {
    if (stopped || !ws || ws.readyState !== WebSocket.OPEN || !buffer) return;
    try { ws.send(buffer); bytesSent += buffer.length || 0; } catch (_) {}
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'Terminate' }));
      }
    } catch (_) {}
    setTimeout(() => { try { if (ws) ws.close(); } catch (_) {} }, 200);
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

module.exports = { start, mapLanguage, _buildUrl };
