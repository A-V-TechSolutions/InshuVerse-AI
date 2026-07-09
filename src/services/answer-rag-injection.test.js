'use strict';
// Integration test for RAG context plumbing through getAnswerWithModelSelection.
// Stubs the OpenAI + Gemini SDKs in require.cache before loading ./answer so
// every model call is captured locally — no network, no credentials, no
// fallback chain side-effects. We then assert:
//
//   1. ragContext is appended to the system prompt for every eligible mode
//      (chatgpt, interview, meeting).
//   2. ragContext is ignored for non-eligible modes (e.g. unknown mode).
//   3. An empty ragContext is a no-op even in eligible modes.
//   4. The user's custom system instructions stay primary (block is appended,
//      not prepended) so the retrieved excerpts ground but never overwrite.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

// ── Stub OpenAI SDK ────────────────────────────────────────────────────────
const _capturedOpenAI = [];
class StubOpenAI {
  constructor() {
    this.chat = {
      completions: {
        // The implementation calls callWithFallback which calls this method.
        create: async (params) => {
          _capturedOpenAI.push(params);
          // Mimic an async iterator returning a single empty delta so the
          // streaming loop terminates cleanly.
          return {
            [Symbol.asyncIterator]: function* () {
              yield { choices: [{ delta: { content: '' } }] };
            },
          };
        },
      },
    };
  }
}

// ── Stub Gemini SDK ────────────────────────────────────────────────────────
const _capturedGemini = [];
class StubGemini {
  constructor() {}
  getGenerativeModel(opts) {
    return {
      generateContentStream: async (req) => {
        _capturedGemini.push({ modelOpts: opts, req });
        return {
          stream: (async function* () { yield { text: () => '' }; })(),
        };
      },
    };
  }
}

// Pre-populate require.cache so answer.js gets the stubs at top-level require.
function _seed(modName, exports) {
  const filename = require.resolve(modName);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
_seed('openai', StubOpenAI);
_seed('@google/generative-ai', { GoogleGenerativeAI: StubGemini });

// Stub model-registry's callWithFallback to invoke the call directly so
// we don't depend on key-pool / billing wiring inside the test process.
const mrPath = path.resolve(__dirname, 'model-registry.js');
require.cache[mrPath] = {
  id: mrPath, filename: mrPath, loaded: true,
  exports: {
    // Real signature: (category, fn, opts). fn receives a model-id string;
    // the stubs ignore it so any value works.
    callWithFallback: async (_category, fn, _opts) => {
      return await fn('stub-model');
    },
    isDeprecationError: () => false,
  },
};

const { getAnswerWithModelSelection } = require('./answer');

// ── Helpers ────────────────────────────────────────────────────────────────
const RAG_HITS = [
  { text: 'The CEO is Alice Liddell.',     source: 'company-handbook.pdf', score: 0.91, chunkIndex: 0 },
  { text: 'Headquartered in Wonderland.',  source: 'company-handbook.pdf', score: 0.83, chunkIndex: 4 },
];

function lastOpenAISystem() {
  const last = _capturedOpenAI[_capturedOpenAI.length - 1];
  return (last && last.messages || []).find(m => m.role === 'system')?.content || '';
}

async function callOpenAI(opts) {
  await getAnswerWithModelSelection('Who is the CEO?', {
    selectedModel: 'default',
    userOpenAIKey: 'sk-stub',
    userGeminiKey: '',
    userResume: '',
    userJobDescription: '',
    responseSize: 'short',
    conversationHistory: [],
    send: () => {},
    systemPromptOverride: 'You are a helpful research assistant. Be precise.',
    openaiModel: 'gpt-4o-mini',
    ...opts,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────
test('RAG: chatgpt mode WITH hits → context block appended to system prompt', async () => {
  _capturedOpenAI.length = 0;
  await callOpenAI({
    userConfiguration: { mode: 'chatgpt', customPrompt: 'Be precise.' },
    ragContext: RAG_HITS,
  });
  const sys = lastOpenAISystem();
  assert.ok(sys.includes('You are a helpful research assistant.'),
    'override stays primary');
  assert.ok(/RELEVANT KNOWLEDGE BASE CONTEXT/i.test(sys),
    'context block header appended');
  assert.ok(sys.includes('Alice Liddell'),
    'top-1 chunk text appears verbatim');
  assert.ok(sys.indexOf('You are a helpful research assistant.') < sys.indexOf('Alice Liddell'),
    'override appears BEFORE the context block (appended, not prepended)');
});

test('RAG: chatgpt mode WITHOUT hits → no context block', async () => {
  _capturedOpenAI.length = 0;
  await callOpenAI({
    userConfiguration: { mode: 'chatgpt', customPrompt: 'Be precise.' },
    ragContext: [],
  });
  const sys = lastOpenAISystem();
  assert.equal(/RELEVANT KNOWLEDGE BASE CONTEXT/i.test(sys), false,
    'empty ragContext must not inject a block');
});

test('RAG: interview mode WITH hits → context block appended', async () => {
  _capturedOpenAI.length = 0;
  await callOpenAI({
    userConfiguration: { mode: 'interview', profile: 'r', jobDescription: 'j' },
    ragContext: RAG_HITS,
  });
  const sys = lastOpenAISystem();
  assert.ok(/RELEVANT KNOWLEDGE BASE CONTEXT/i.test(sys),
    'interview mode must see RAG block');
  assert.ok(sys.includes('Alice Liddell'),
    'top-1 chunk text appears verbatim in interview mode');
});

test('RAG: meeting mode WITH hits → context block appended', async () => {
  _capturedOpenAI.length = 0;
  await callOpenAI({
    userConfiguration: { mode: 'meeting', meetingContext: 'sync with sales' },
    ragContext: RAG_HITS,
  });
  assert.ok(/RELEVANT KNOWLEDGE BASE CONTEXT/i.test(lastOpenAISystem()),
    'meeting mode must see RAG block');
});

test('RAG: non-eligible mode IGNORES ragContext even if present', async () => {
  _capturedOpenAI.length = 0;
  // userResume is provided so the upstream config validation passes via
  // the backward-compat branch; we're only exercising the RAG gate.
  await callOpenAI({
    userConfiguration: { mode: 'highlight', customPrompt: 'x' },
    userResume: 'fallback resume',
    ragContext: RAG_HITS,
  });
  assert.equal(/RELEVANT KNOWLEDGE BASE CONTEXT/i.test(lastOpenAISystem()), false,
    'non-eligible modes must not see RAG block');
});
