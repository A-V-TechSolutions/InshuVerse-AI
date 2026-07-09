const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { callWithFallback, isDeprecationError } = require('./model-registry');
const { appendRagContext, isRagEligibleMode } = require('./rag/prompt-assembly');

// Stable, byte-identical prefix placed at the START of every system prompt so
// OpenAI prefix caching can kick in (requires ≥1024 input tokens total; the
// cache matches at 128-token boundaries on the exact prefix). Keeping this
// text as a module constant — no interpolation — guarantees the bytes are
// identical across every call, which is what the cache needs.
const STABLE_SYSTEM_PREFIX = [
  'You are Angel AI, an assistant that helps the user during live interviews, meetings, and general Q&A.',
  '',
  'HARD LIMIT: Your entire answer MUST fit within the target token budget provided below. Never exceed it. If needed, compress, summarize, or omit extras so the response is complete within the budget. Do not start lists or code you cannot finish within the limit.',
  '',
  'Language: Detect the language of the latest user message or question and respond in that same language only. Do not switch to a different language unless the user explicitly asks for translation or a different language.',
  '',
  'Conversation memory and modalities: Treat the entire conversation history as a single continuous chat. Messages may come from normal text the user typed, audio that was transcribed from the user\'s speech (for example using Whisper), screenshots or images that were analyzed into text, and follow-up questions triggered from quick suggestion buttons. All of these messages share the same chat memory. When the user asks follow-up questions (even after a screenshot answer, audio answer, or suggestion), you MUST use the previous messages as context and continue naturally from them.',
  '',
  'Style: Use simple, natural, conversational language in whatever language you are responding. Prefer short, clear sentences. If asked to elaborate, do so within the token budget.',
  'Coding: If a coding question, include code and explain briefly. Keep explanations concise to stay within the token budget.',
].join('\n');

// Gemini's generateContentStream delivers coarse chunks (often 50-200+ chars
// in one shot, and occasionally the entire response in a single chunk when
// the backend buffers a fast completion) while OpenAI streams per-token
// deltas naturally paced by the SSE channel (~10-50 ms apart).
//
// To match the OpenAI typewriter feel for Gemini we slice large deltas at
// word boundaries and gate each fragment behind a setTimeout. setImmediate
// was tried first, but its microsecond resolution means all fragments hit
// the renderer inside the same animation frame — the browser then batches
// every appendChild into one repaint, so a 1000-char "stream" visually
// appears as a single blob.
//
// 8 ms ≈ half a 60 Hz frame, so each fragment lands on its own paint.
// Total added latency is ≈ (delta.length / FRAGMENT_MAX) * STEP_MS, e.g.
// ~330 ms for a 1000-char response — bounded and only paid when Gemini
// hands us a single large chunk; small chunks (<= FRAGMENT_MAX) bypass
// fragmentation entirely and ship through with zero added latency.
const GEMINI_FRAGMENT_MAX = 24;
const GEMINI_FRAGMENT_STEP_MS = 8;
async function emitDeltaSmoothly(send, delta) {
  if (!delta) return;
  if (delta.length <= GEMINI_FRAGMENT_MAX) {
    send('answer-part', delta);
    return;
  }
  let i = 0;
  const len = delta.length;
  let first = true;
  while (i < len) {
    let end = Math.min(i + GEMINI_FRAGMENT_MAX, len);
    if (end < len) {
      const wsIdx = delta.lastIndexOf(' ', end);
      if (wsIdx > i) end = wsIdx + 1;
    }
    const fragment = delta.slice(i, end);
    if (fragment) send('answer-part', fragment);
    i = end;
    // First fragment ships immediately so the user sees text the instant
    // the chunk arrives; subsequent fragments are paced for visual cadence.
    if (first) {
      first = false;
      await new Promise((resolve) => setImmediate(resolve));
    } else if (i < len) {
      await new Promise((resolve) => setTimeout(resolve, GEMINI_FRAGMENT_STEP_MS));
    }
  }
}

// Gemini occasionally falls into "mode collapse" where it repeats the same
// short phrase ad-infinitum until maxOutputTokens is reached (observed with
// gemini-2.5-flash-lite on simple prompts — e.g. "I'm not in the mood I'm not
// in the mood ..." for hundreds of tokens). Detect a tail of length
// [minChunkLen..maxChunkLen] that has been repeated immediately before itself
// minRepeat times in a row. When detected, the caller breaks out of the
// streaming loop early.
function detectDegeneracy(text, opts) {
  const o = opts || {};
  const minRepeat = o.minRepeat || 4;
  const minChunkLen = o.minChunkLen || 8;
  const maxChunkLen = o.maxChunkLen || 40;
  if (!text || typeof text !== 'string') return false;
  if (text.length < minChunkLen * minRepeat) return false;
  const upper = Math.min(maxChunkLen, Math.floor(text.length / minRepeat));
  for (let n = upper; n >= minChunkLen; n--) {
    const tail = text.slice(text.length - n);
    let ok = true;
    for (let k = 1; k < minRepeat; k++) {
      const start = text.length - n * (k + 1);
      if (start < 0) { ok = false; break; }
      if (text.slice(start, start + n) !== tail) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function sizeToLimits(responseSize) {
  // Token budgets tuned to prevent mid-sentence truncation in the chat
  // bubble. Each guidance string instructs the model to *fit within* the
  // budget rather than to fill it — completion is preferred over verbosity.
  if (responseSize === 'small') return { maxTokens: 500,  aim: 'concise and brief',         guidance: 'Keep it concise: 4-6 sentences. Focus on the key points. Stay well within the token budget so the answer ends with a complete sentence.' };
  if (responseSize === 'big')   return { maxTokens: 2200, aim: 'comprehensive and detailed', guidance: 'Provide a comprehensive answer with examples, explanations, code snippets, and step-by-step details as needed. Plan the structure first and ensure the response fits within the available token budget — finish every thought, code block, and list completely. Never stop mid-sentence.' };
  /* medium / default */        return { maxTokens: 1100, aim: 'balanced and complete',      guidance: 'Provide a balanced answer: clear explanation with relevant details and examples. Plan the response so it fits within the token budget and ends with a complete sentence — never stop mid-thought.' };
}

// Helper: prefer summarized, then base, then full, then legacy fallback
function prefer(config, baseKey, summaryKey, fullKey, legacyFallback) {
  if (config && config[summaryKey]) return config[summaryKey];
  if (config && config[baseKey]) return config[baseKey];
  if (config && config[fullKey]) return config[fullKey];
  return legacyFallback || '';
}

function buildSystemPrompt(userConfiguration, userResume, userJobDescription, responseSize) {
  const { aim, guidance } = sizeToLimits(responseSize);

  // Get configuration or fallback to legacy format
  const config = userConfiguration || {
    mode: 'interview',
    profile: userResume,
    jobDescription: userJobDescription
  };

  let contextPrompt = '';

  // Pre-resolve preferred texts for each mode. The unified `instructions`
  // field (introduced when interview / meeting / custom were merged into
  // one body) is the new source of truth; the per-mode legacy keys
  // (profile / meetingContext / customPrompt) remain as fallbacks so
  // profiles saved before the refactor still produce the same prompt.
  const instructions = prefer(config, 'instructions', 'instructionsSummary', 'instructionsFull', '');
  const profileText = instructions || prefer(config, 'profile', 'profileSummary', 'profileFull', userResume);
  const jobText = prefer(config, 'jobDescription', 'jobDescriptionSummary', 'jobDescriptionFull', userJobDescription);
  const meetingCtx = instructions || prefer(config, 'meetingContext', 'meetingContextSummary', 'meetingContextFull', '');
  const customPrompt = instructions || prefer(config, 'customPrompt', 'customPromptSummary', 'customPromptFull', '');

  switch (config.mode) {
    case 'interview':
      contextPrompt = `You are in a live interview. Act as the candidate with this profile: ${profileText}.`;
      if (jobText) {
        contextPrompt += `\n\nJob you're interviewing for: ${jobText}`;
      }
      break;

    case 'meeting':
      contextPrompt = `You are in a meeting. Understand the meeting context and respond appropriately.`;
      if (meetingCtx) {
        contextPrompt += `\n\nMeeting context: ${meetingCtx}`;
      }
      if (config.meetingType) {
        contextPrompt += `\nMeeting type: ${config.meetingType}`;
      }
      contextPrompt += `\n\nBehave as a helpful meeting participant. Provide relevant insights, ask clarifying questions when appropriate, and contribute meaningfully to the discussion.`;
      break;

    case 'chatgpt':
      if (customPrompt) {
        contextPrompt = customPrompt;
      } else {
        // Fallback based on assistant role
        switch (config.assistantRole) {
          case 'technical':
            contextPrompt = 'You are a technical expert assistant. Provide detailed, accurate technical information and solutions.';
            break;
          case 'creative':
            contextPrompt = 'You are a creative assistant. Help with brainstorming, creative writing, and innovative solutions.';
            break;
          case 'business':
            contextPrompt = 'You are a business advisor. Provide strategic insights, business analysis, and professional guidance.';
            break;
          case 'educational':
            contextPrompt = 'You are an educational tutor. Explain concepts clearly, provide examples, and help with learning.';
            break;
          default:
            contextPrompt = 'You are a helpful assistant. Provide accurate, helpful, and relevant responses to user queries.';
        }
      }
      break;

    default:
      // Fallback to interview mode
      contextPrompt = `You are in a live interview. Act as the candidate with this profile: ${profileText}.`;
      if (jobText) {
        contextPrompt += `\n\nJob you're interviewing for: ${jobText}`;
      }
  }

	  // STABLE_SYSTEM_PREFIX goes first so OpenAI can prefix-cache it across
	  // requests (50% input-token discount on cached tokens). The dynamic
	  // part (aim/guidance + mode-specific context) is appended after.
	  return `${STABLE_SYSTEM_PREFIX}\n\n---\n\nTarget ${aim}. ${guidance}\n\n${contextPrompt}`;
}

async function getAnswerFromOpenAI(transcription, { userOpenAIKey, userResume, userJobDescription, userConfiguration, responseSize, conversationHistory = [], send, systemPromptOverride, openaiModel, ragContext }) {
  if (!userOpenAIKey) throw new Error('Lifetime plan requires your own OpenAI API key. Please set it in the API Keys tab of Settings (gear icon).');

  // Check if we have any configuration - be more flexible for non-interview modes.
  // The unified `instructions` field counts for every mode (interview/meeting/chatgpt)
  // since the modal now writes there; the legacy per-mode keys remain as fallbacks.
  const config = userConfiguration || { mode: 'interview', profile: userResume, jobDescription: userJobDescription };
  const hasInstructions = !!(config && (config.instructions || config.instructionsSummary || config.instructionsFull));
  const hasValidConfig = config && (
    (config.mode === 'interview' && (hasInstructions || config.profile || config.profileSummary || config.profileFull || userResume)) ||
    (config.mode === 'meeting' && (hasInstructions || config.meetingContext || config.meetingContextSummary || config.meetingContextFull)) ||
    (config.mode === 'chatgpt') ||
    userResume // Backward compatibility
  );

  if (!hasValidConfig) {
    const modeMessages = {
      interview: 'Please provide your profile information first.',
      meeting: 'Please provide meeting context first.',
      chatgpt: 'Custom mode is ready to use.'
    };
    throw new Error(modeMessages[config.mode] || 'Please provide your configuration first.');
  }

  const { maxTokens } = sizeToLimits(responseSize);
  let systemPrompt = systemPromptOverride || buildSystemPrompt(userConfiguration, userResume, userJobDescription, responseSize);
  // RAG injection — eligible modes only (chatgpt/interview/meeting).
  // The renderer pre-computes top-K chunks against the user's local
  // IndexedDB knowledge base and forwards them as `ragContext`. We append
  // (not replace) so the user's custom system instructions stay primary;
  // the retrieved excerpts become the authoritative source the model
  // cites for facts. Highlight and screenshot are intentionally excluded.
  if (Array.isArray(ragContext) && ragContext.length > 0 && userConfiguration && isRagEligibleMode(userConfiguration.mode)) {
    systemPrompt = appendRagContext(systemPrompt, ragContext);
  }

  // Build messages array ensuring latest user input is last
  // 1) validate history
  const validHistory = conversationHistory
    .filter(msg => {
      if (!msg || !msg.content || !msg.role) return false;
      const content = String(msg.content || '').trim();
      if (!content) return false;
      if (content.includes('interview conversation or interview conversation')) return false;
      if (content.length > 5000) return false;
      if (content.split(' ').length < 2) return false;
      return true;
    })
    .slice(-80); // keep a bit more then trim below

  // 2) remove any trailing user messages so we never end on a previous question
  let trimmedHistory = [...validHistory];
  while (trimmedHistory.length && trimmedHistory[trimmedHistory.length - 1].role === 'user') {
    trimmedHistory.pop();
  }
  trimmedHistory = trimmedHistory.slice(-10); // final cap - 5 turns (5 user + 5 assistant)

  // 3) clean system prompt
  const cleanSystemPrompt = systemPrompt.replace(/(\w+\s+){10,}\1/g, '');

  // 4) compose final messages with current user last
  const messages = [
    { role: 'system', content: cleanSystemPrompt },
    ...trimmedHistory,
    { role: 'user', content: transcription }
  ];

  console.debug(`[ANSWER] Using ${trimmedHistory.length} conversation history messages for context`);
  console.debug(`[ANSWER] System prompt length: ${cleanSystemPrompt.length} characters`);

  // Default chat model resolved through the registry; callers may override
  // (e.g., highlight uses CHAT_NANO via openaiModel='gpt-4.1-nano' for cheaper
  // one-shot explanations). callWithFallback rotates to the next model in the
  // chain if the upstream returns 404 / model_not_found / deprecated.
  const openai = new OpenAI({ apiKey: userOpenAIKey, maxRetries: 1, timeout: 20000 });
  let fullAnswer = '';
  send('answer-start');
  try {
    await callWithFallback('CHAT_FAST', async (modelId) => {
      try {
        const stream = await openai.chat.completions.create({
          model: modelId,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens,
          stream: true,
        });
        for await (const part of stream) {
          const choice = part?.choices?.[0];
          let delta = '';
          if (choice?.delta?.content && typeof choice.delta.content === 'string') {
            delta = choice.delta.content;
          } else if (Array.isArray(choice?.delta?.content) && choice.delta.content[0]?.text) {
            delta = choice.delta.content[0].text;
          } else if (typeof part?.text === 'string') {
            delta = part.text;
          }
          if (delta) {
            fullAnswer += delta;
            send('answer-part', delta);
          }
        }
      } catch (err) {
        // If streaming itself failed for non-deprecation reasons, fall back to
        // a single non-streaming completion against the SAME model. Deprecation
        // errors are re-thrown so callWithFallback can rotate the model id.
        if (isDeprecationError(err)) throw err;
        console.warn('[ANSWER] OpenAI streaming failed, trying non-streaming:', err.message);
        const completion = await openai.chat.completions.create({
          model: modelId,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens,
        });
        fullAnswer = completion.choices?.[0]?.message?.content || '';
        if (fullAnswer) send('answer-part', fullAnswer);
      }
    }, { override: openaiModel });
  } finally {
    send('answer-done');
  }
  return fullAnswer;
}

async function getAnswerFromGemini(transcription, { userGeminiKey, userResume, userJobDescription, userConfiguration, responseSize, conversationHistory = [], send, systemPromptOverride, ragContext }) {
  if (!userGeminiKey) throw new Error('Lifetime plan requires your own Gemini API key. Please set it in the API Keys tab of Settings (gear icon).');

  // Check if we have any configuration - be more flexible for non-interview modes.
  // Mirrors the OpenAI path: unified `instructions` satisfies every mode,
  // legacy per-mode keys remain as fallbacks for older saved profiles.
  const config = userConfiguration || { mode: 'interview', profile: userResume, jobDescription: userJobDescription };
  const hasInstructions = !!(config && (config.instructions || config.instructionsSummary || config.instructionsFull));
  const hasValidConfig = config && (
    (config.mode === 'interview' && (hasInstructions || config.profile || config.profileSummary || config.profileFull || userResume)) ||
    (config.mode === 'meeting' && (hasInstructions || config.meetingContext || config.meetingContextSummary || config.meetingContextFull)) ||
    (config.mode === 'chatgpt') ||
    userResume // Backward compatibility
  );

  if (!hasValidConfig) {
    const modeMessages = {
      interview: 'Please provide your profile information first.',
      meeting: 'Please provide meeting context first.',
      chatgpt: 'Custom mode is ready to use.'
    };
    throw new Error(modeMessages[config.mode] || 'Please provide your configuration first.');
  }

  const { maxTokens } = sizeToLimits(responseSize);
	  const basePrompt = buildSystemPrompt(userConfiguration, userResume, userJobDescription, responseSize);
	  const defaultSystemPrompt = `${basePrompt}\n\nIMPORTANT: Always complete your thoughts fully. Never cut off mid-sentence or mid-explanation. If providing code or lists, finish them completely.`;
  let systemPrompt = systemPromptOverride || defaultSystemPrompt;
  // RAG injection — see getAnswerFromOpenAI for rationale. Same contract.
  if (Array.isArray(ragContext) && ragContext.length > 0 && userConfiguration && isRagEligibleMode(userConfiguration.mode)) {
    systemPrompt = appendRagContext(systemPrompt, ragContext);
  }

  const genAI = new GoogleGenerativeAI(userGeminiKey);
  // Model id resolved from the registry; callWithFallback below rotates to
  // the next chain entry (gemini-2.5-flash-lite → gemini-1.5-flash) if the
  // upstream returns 404 / "not found for API version" / "deprecated".
  // topP/topK + slightly raised temperature widen the sampling distribution
  // enough to break the gemini-2.5-flash-lite repetition trap without making
  // answers wander. candidateCount stays at 1 to keep latency tight.
  const buildModel = (modelId) => genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.5,
      topP: 0.9,
      topK: 40,
      candidateCount: 1
    },
  });

  // Build conversation context ensuring latest user input is last
  const validHistory = conversationHistory
    .filter(msg => {
      if (!msg || !msg.content || !msg.role) return false;
      const content = String(msg.content || '').trim();
      if (!content) return false;
      if (content.includes('interview conversation or interview conversation')) return false;
      if (content.length > 5000) return false;
      if (content.split(' ').length < 2) return false;
      return true;
    })
    .slice(-80);

  let trimmedHistory = [...validHistory];
  while (trimmedHistory.length && trimmedHistory[trimmedHistory.length - 1].role === 'user') {
    trimmedHistory.pop();
  }
  trimmedHistory = trimmedHistory.slice(-10); // final cap - 5 turns (5 user + 5 assistant)

  // Ensure system prompt is clean and not corrupted
  const cleanSystemPrompt = systemPrompt.replace(/(\w+\s+){10,}\1/g, '');

  let conversationText = cleanSystemPrompt;
  if (trimmedHistory.length > 0) {
    conversationText += '\n\nConversation history:\n';
    trimmedHistory.forEach(msg => {
      const role = msg.role === 'user' ? 'Human' : 'Assistant';
      conversationText += `${role}: ${msg.content}\n`;
    });
  }
  // Always end with current user message
  conversationText += `\n\nHuman: ${transcription}`;

  console.debug(`[GEMINI] Using ${trimmedHistory.length} conversation history messages for context`);
  console.debug(`[GEMINI] System prompt length: ${cleanSystemPrompt.length} characters`);

  let fullAnswer = '';
  send('answer-start');
  try {
    await callWithFallback('GEMINI_CHAT', async (modelId) => {
      const model = buildModel(modelId);
      try {
        // Single sequential request — no parallel racing
        const streamResult = await model.generateContentStream([{ text: conversationText }]);
        for await (const chunk of streamResult.stream) {
          const delta = chunk.text();
          if (delta) {
            fullAnswer += delta;
            await emitDeltaSmoothly(send, delta);
            // Abort early on mode-collapse — keeps the UI from rendering
            // hundreds of repeated phrases and stops billable token waste.
            if (detectDegeneracy(fullAnswer)) {
              console.warn('[GEMINI] Degeneracy detected, aborting stream early');
              break;
            }
          }
        }
      } catch (error) {
        if (isDeprecationError(error)) throw error;
        console.warn('[ANSWER] Gemini streaming failed:', error.message);
        // Try non-streaming Gemini as fallback against the SAME model id
        const result = await model.generateContent([{ text: conversationText }]);
        fullAnswer = result?.response?.text?.() || '';
        if (fullAnswer) await emitDeltaSmoothly(send, fullAnswer);
      }
    });
  } finally {
    send('answer-done');
  }
  return fullAnswer;
}


// ─────────────────────────────────────────────────────────────────────────────
// SEQUENTIAL FALLBACK — OpenAI first (using the tier-appropriate key from
// main.js: DEFAULT_OPENAI_KEY for free users, PREMIUM_OPENAI_KEY for paid
// users). Gemini acts as a shared fallback for ALL tiers when OpenAI fails.
//
// Provider-aware shortcut: Lifetime BYOK users who only configured a Gemini
// key would otherwise pay a 5–10 s wait while OpenAI's client times out
// against the missing key. When we can prove OpenAI is unavailable up-front
// (no key) and Gemini is configured, we skip the OpenAI attempt entirely.
// ─────────────────────────────────────────────────────────────────────────────
async function getAnswerWithFallback(transcription, opts) {
  const planName = String(opts && opts.planName || '').toLowerCase();
  const isLifetime = planName === 'lifetime' || !!(opts && opts.isLifetimePlan);
  const hasOpenAIKey = !!(opts && opts.userOpenAIKey);
  const hasGeminiKey = !!(opts && opts.userGeminiKey);

  if (isLifetime && !hasOpenAIKey && hasGeminiKey) {
    console.log('[ANSWER] Lifetime BYOK: no OpenAI key — calling Gemini directly');
    if (opts.send) opts.send('answer-status', 'Generating answer...');
    const answer = await getAnswerFromGemini(transcription, opts);
    return { answer, provider: 'gemini' };
  }

  console.log('[ANSWER] Using sequential fallback (OpenAI → Gemini)...');
  if (opts.send) opts.send('answer-status', 'Generating answer...');
  try {
    const answer = await getAnswerFromOpenAI(transcription, opts);
    return { answer, provider: 'openai' };
  } catch (e1) {
    console.warn('[ANSWER] OpenAI failed, trying Gemini fallback:', e1.message);
    try {
      const answer = await getAnswerFromGemini(transcription, opts);
      return { answer, provider: 'gemini' };
    } catch (e2) {
      console.error('[ANSWER] Both providers failed. OpenAI:', e1.message, '| Gemini:', e2.message);
      throw new Error(`All answer providers failed. Last error: ${e2.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL-AWARE ENTRY POINT
// Default: sequential OpenAI → Gemini fallback (saves credits; only one call
// per request under normal conditions).
// If user explicitly picked a model in settings: try it first, then fall back
// to the full sequential chain.
// ─────────────────────────────────────────────────────────────────────────────
async function getAnswerWithModelSelection(transcription, opts) {
  const { selectedModel } = opts;

  if (selectedModel && selectedModel !== 'default') {
    try {
      let answer, provider;
      switch (selectedModel) {
        case 'openai':
          answer = await getAnswerFromOpenAI(transcription, opts);
          provider = 'openai';
          break;
        case 'gemini':
          answer = await getAnswerFromGemini(transcription, opts);
          provider = 'gemini';
          break;
        default:
          throw new Error(`Unknown model: ${selectedModel}`);
      }
      console.debug(`[ANSWER] Used selected model: ${selectedModel}`);
      return { answer, provider };
    } catch (error) {
      console.warn(`[ANSWER] Selected model ${selectedModel} failed (${error.message}), falling back to sequential`);
      return await getAnswerWithFallback(transcription, opts);
    }
  }

  // Default: OpenAI → Gemini sequential fallback
  return await getAnswerWithFallback(transcription, opts);
}

module.exports = {
  getAnswerWithModelSelection,
  emitDeltaSmoothly,
  detectDegeneracy,
};
