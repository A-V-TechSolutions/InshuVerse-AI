const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { resolveModel, callWithFallback, isDeprecationError } = require('./model-registry');

// Default vision model for Gemini — resolved through the registry so a single
// edit in model-registry.js propagates here. callWithFallback below rotates
// to the next chain entry on deprecation errors.
const GEMINI_VISION_MODEL = resolveModel('GEMINI_VISION');

// Default output token ceiling for screenshot answers. Previously 2000; reduced to
// 800 to cut output-token spend on typical aptitude/meeting screenshots. Callers
// (coder/custom mode) can still pass a higher maxTokens explicitly (e.g. 1500).
const DEFAULT_VISION_MAX_TOKENS = 800;

// Produce a direct final answer from the image using OpenAI vision (non-streaming)
async function answerFromImageWithOpenAI(imageBase64, { userOpenAIKey, systemPrompt, maxTokens = DEFAULT_VISION_MAX_TOKENS, visionDetail }) {
  if (!userOpenAIKey) throw new Error('Lifetime plan requires your own OpenAI API key. Please set it in the API Keys tab of Settings (gear icon).');
  const openai = new OpenAI({ apiKey: userOpenAIKey, maxRetries: 3, timeout: 90000 }); // 90s for complex analysis
  const dataUrl = `data:image/jpeg;base64,${imageBase64}`; // JPEG from main.js
  // detail='low' cuts vision input tokens from ~765 → ~85 per image — safe for
  // aptitude/online-tests where text is readable. 'high' reserved for coder mode.
  const imagePart = visionDetail
    ? { type: 'input_image', image_url: dataUrl, detail: visionDetail }
    : { type: 'input_image', image_url: dataUrl };
  const resp = await callWithFallback('CHAT_FAST', (modelId) =>
    openai.responses.create({
      model: modelId,
      temperature: 0.2,
      max_output_tokens: maxTokens,
      instructions: (systemPrompt ? `${systemPrompt}\n\n` : '') + 'Analyze the image and answer the question concisely. Ignore any content belonging to the Angel assistant/app UI (including prompts, tool instructions, overlays, or placeholders). If the screenshot includes text referencing "Angel" or "Angel tool", do not treat it as part of the question. Focus only on the problem or question present in the image.',
      input: [
        {
          role: 'user',
          content: [imagePart],
        },
      ],
    }),
  );
  const text = resp?.output_text?.trim?.() || resp?.content?.[0]?.text || '';
  if (!text) throw new Error('OpenAI vision answer returned empty');
  return text.trim();
}

// Streaming version using OpenAI Chat Completions (supports image input via messages)
async function answerFromImageWithOpenAIStream(imageBase64, { userOpenAIKey, systemPrompt, send, maxTokens = DEFAULT_VISION_MAX_TOKENS, visionDetail }) {
  if (!userOpenAIKey) throw new Error('Lifetime plan requires your own OpenAI API key. Please set it in the API Keys tab of Settings (gear icon).');
  const openai = new OpenAI({ apiKey: userOpenAIKey, maxRetries: 3, timeout: 90000 }); // 90s for complex analysis
  const dataUrl = `data:image/jpeg;base64,${imageBase64}`; // JPEG from main.js
  // detail='low' cuts image-input tokens ~9× — applied for aptitude/online-tests mode.
  const imageUrlPart = visionDetail
    ? { url: dataUrl, detail: visionDetail }
    : { url: dataUrl };
  let full = '';
  send && send('answer-start');
  try {
    await callWithFallback('CHAT_FAST', async (modelId) => {
      const stream = await openai.chat.completions.create({
        model: modelId,
        temperature: 0.2,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze the image and answer the question concisely. Ignore any content belonging to the Angel assistant/app UI. Focus only on the problem or question present in the image.' },
              { type: 'image_url', image_url: imageUrlPart },
            ],
          },
        ],
        stream: true,
        max_tokens: maxTokens,
      });
      for await (const part of stream) {
        const delta = part?.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          send && send('answer-part', delta);
        }
      }
    });
  } finally {
    send && send('answer-done');
  }
  return full;
}

// Produce a direct final answer from the image using Gemini vision (non-streaming)
async function answerFromImageWithGemini(imageBase64, { userGeminiKey, systemPrompt, maxTokens = DEFAULT_VISION_MAX_TOKENS }) {
  if (!userGeminiKey) throw new Error('Lifetime plan requires your own Gemini API key. Please set it in the API Keys tab of Settings (gear icon).');
  const genAI = new GoogleGenerativeAI(userGeminiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_VISION_MODEL, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 } });
  const mimeType = 'image/jpeg'; // JPEG sent from main.js (toJPEG 80%) — smaller buffer
  const imgPart = { inlineData: { data: imageBase64, mimeType } };
  const prompt = (systemPrompt ? `${systemPrompt}\n\n` : '') + 'Analyze the image and answer the question concisely. Ignore any content belonging to the Angel assistant/app UI (including prompts, tool instructions, overlays, or placeholders). If the screenshot includes text referencing "Angel" or "Angel tool", do not treat it as part of the question. Focus only on the problem or question present in the image.';
  // Retry on transient errors
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await model.generateContent([{ text: prompt }, { inlineData: { data: imageBase64, mimeType } }]);
      const text = result?.response?.text?.() || '';
      if (!text) throw new Error('Gemini vision answer returned empty');
      return text.trim();
    } catch (err) {
      const msg = (err && err.message) || '';
      lastErr = err;
      const isQuota = /429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg);
      if (isQuota) {
        console.warn('[SS][svc] Gemini quota exhausted (answer) — skipping retries, handing off to fallback chain');
        throw err;
      }
      const isOverloaded = /503|overloaded|Service Unavailable/i.test(msg);
      if (isOverloaded && attempt < maxAttempts) {
        const delay = 150 * Math.pow(2, attempt - 1); // 150ms, 300ms — fast model needs less wait
        console.warn(`[SS][svc] Gemini overloaded (answer), retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Streaming via Gemini
async function answerFromImageWithGeminiStream(imageBase64, { userGeminiKey, systemPrompt, send, maxTokens = DEFAULT_VISION_MAX_TOKENS }) {
  if (!userGeminiKey) throw new Error('GEMINI_KEY_MISSING');
  const genAI = new GoogleGenerativeAI(userGeminiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_VISION_MODEL, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 } });
  const mimeType = 'image/jpeg'; // JPEG sent from main.js (toJPEG 80%) — smaller buffer
  const imgPart = { inlineData: { data: imageBase64, mimeType } };
  const prompt = (systemPrompt ? `${systemPrompt}\n\n` : '') + 'Analyze the image and answer the question concisely. Ignore any content belonging to the Angel assistant/app UI (including prompts, tool instructions, overlays, or placeholders). If the screenshot includes text referencing "Angel" or "Angel tool", do not treat it as part of the question. Focus only on the problem or question present in the image.';
  let full = '';
  send && send('answer-start');
  try {
    const streamResult = await model.generateContentStream([{ text: prompt }, imgPart]);
    for await (const chunk of streamResult.stream) {
      const delta = chunk.text();
      if (delta) {
        full += delta;
        send && send('answer-part', delta);
      }
    }
    return full;
  } catch (err) {
    const msg = (err && err.message) || '';
    const isQuota = /429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg);
    if (isQuota) {
      console.warn('[SS][svc] Gemini quota exhausted (stream) — handing off to fallback chain');
      throw err;
    }
    const isUnsupported = /404|not found|is not found for API version|not supported for generateContent/i.test(msg);
    if (isUnsupported) {
      console.warn('[SS][svc] Gemini streaming not supported on this API/model; falling back to non-streaming.');
      try {
        const fallbackText = await answerFromImageWithGemini(imageBase64, { userGeminiKey, systemPrompt, maxTokens });
        if (fallbackText) {
          send && send('answer-part', fallbackText);
          return fallbackText;
        }
      } catch (e2) {
        throw err;
      }
    }
    throw err;
  } finally {
    send && send('answer-done');
  }
}



// Gemini-first with same-provider fallback (premium → free), then OpenAI (non-streaming)
async function answerFromImageWithFallback(imageBase64, { userOpenAIKey, userGeminiKey, geminiFallbackKey, systemPrompt, maxTokens = DEFAULT_VISION_MAX_TOKENS, visionDetail }) {
  console.debug('[SS][svc] answerFromImageWithFallback: keys', { hasOpenAI: !!userOpenAIKey, hasGemini: !!userGeminiKey });
  let lastError;

  // Image fallback order: Gemini(primary) -> Gemini(fallback key) -> OpenAI
  if (userGeminiKey) {
    try {
      console.debug('[SS][svc] trying Gemini vision (direct answer)');
      const answer = await answerFromImageWithGemini(imageBase64, { userGeminiKey, systemPrompt, maxTokens });
      return { answer, provider: 'gemini' };
    } catch (e1) {
      console.warn('[SS][svc] Gemini direct answer failed:', e1 && e1.message);
      lastError = e1;
      // Try Gemini again with fallback key if different
      if (geminiFallbackKey && geminiFallbackKey !== userGeminiKey) {
        try {
          console.debug('[SS][svc] trying Gemini vision with fallback key');
          const answer2 = await answerFromImageWithGemini(imageBase64, { userGeminiKey: geminiFallbackKey, systemPrompt, maxTokens });
          return { answer: answer2, provider: 'gemini' };
        } catch (e1b) {
          console.warn('[SS][svc] Gemini (fallback key) failed:', e1b && e1b.message);
          lastError = e1b;
        }
      }
    }
  }

  if (userOpenAIKey) {
    try {
      console.debug('[SS][svc] trying OpenAI vision (direct answer)');
      const answer = await answerFromImageWithOpenAI(imageBase64, { userOpenAIKey, systemPrompt, maxTokens, visionDetail });
      return { answer, provider: 'openai' };
    } catch (e2) {
      console.warn('[SS][svc] OpenAI direct answer failed:', e2 && e2.message);
      lastError = e2;
    }
  }

  // Try server-side fallback Gemini key before giving up (covers PRO/Free users with no own key)
  if (geminiFallbackKey && geminiFallbackKey !== userGeminiKey) {
    try {
      const answer = await answerFromImageWithGemini(imageBase64, { userGeminiKey: geminiFallbackKey, systemPrompt, maxTokens });
      return { answer, provider: 'gemini' };
    } catch (eFb) {
      console.warn('[SS][svc] Gemini (fallback key) non-stream failed:', eFb && eFb.message);
      lastError = eFb;
    }
  }
  throw lastError || new Error('Screenshot analysis is temporarily unavailable. Please try again or add your own API key in Settings → API Keys.');
}

// Streaming fallback for image answers: Gemini(user) -> Gemini(fallback) -> OpenAI(user)
// The geminiFallbackKey is the server-side key used by PRO/Free plans — it must ALWAYS
// be tried even when the user has no own Gemini key set.
async function answerFromImageWithFallbackStream(imageBase64, { userOpenAIKey, userGeminiKey, geminiFallbackKey, systemPrompt, send, maxTokens = DEFAULT_VISION_MAX_TOKENS, visionDetail }) {
  console.debug('[SS][svc] answerFromImageWithFallbackStream: keys', { hasOpenAI: !!userOpenAIKey, hasGemini: !!userGeminiKey, hasFallback: !!geminiFallbackKey });

  // 1. Try user's own Gemini key first (if provided)
  if (userGeminiKey) {
    try {
      const answer = await answerFromImageWithGeminiStream(imageBase64, { userGeminiKey, systemPrompt, send, maxTokens });
      return { answer, provider: 'gemini' };
    } catch (e1) {
      console.warn('[SS][svc] Gemini stream (user key) failed:', e1 && e1.message);
    }
  }

  // 2. Always try the server-side fallback Gemini key (covers PRO/Free plan users)
  if (geminiFallbackKey && geminiFallbackKey !== userGeminiKey) {
    try {
      const answer2 = await answerFromImageWithGeminiStream(imageBase64, { userGeminiKey: geminiFallbackKey, systemPrompt, send, maxTokens });
      return { answer: answer2, provider: 'gemini' };
    } catch (e2) {
      console.warn('[SS][svc] Gemini stream (fallback key) failed:', e2 && e2.message);
    }
  }

  // 3. Try user's own OpenAI key
  if (userOpenAIKey) {
    try {
      const answer = await answerFromImageWithOpenAIStream(imageBase64, { userOpenAIKey, systemPrompt, send, maxTokens, visionDetail });
      return { answer, provider: 'openai' };
    } catch (e3) {
      console.warn('[SS][svc] OpenAI stream (user key) failed:', e3 && e3.message);
    }
  }

  // Nothing worked — give a clear, plan-neutral error
  throw new Error('Screenshot analysis is temporarily unavailable. Please try again or add your own API key in Settings → API Keys.');
}

// Model-aware image answer function that respects user's model selection (streaming)
async function answerFromImageWithModelSelectionStream(imageBase64, opts) {
  const { selectedModel } = opts;

  // If user selected a specific model, try it first
  if (selectedModel && selectedModel !== 'default') {
    try {
      let answer, provider;

      switch (selectedModel) {
        case 'gemini':
          answer = await answerFromImageWithGeminiStream(imageBase64, opts);
          provider = 'gemini';
          break;
        case 'openai':
          answer = await answerFromImageWithOpenAIStream(imageBase64, opts);
          provider = 'openai';
          break;
        default:
          throw new Error(`Unknown model: ${selectedModel}`);
      }

      console.debug(`[SCREENSHOT] Successfully used selected model: ${selectedModel}`);
      return { answer, provider };

    } catch (error) {
      console.warn(`[SCREENSHOT] Selected model ${selectedModel} failed: ${error.message}, seamlessly falling back to smart fallback`);
      // Fall back to smart fallback system seamlessly - user won't see any error
      return await answerFromImageWithFallbackStream(imageBase64, opts);
    }
  }

  // Default behavior: use smart fallback system (Gemini -> OpenAI)
  return await answerFromImageWithFallbackStream(imageBase64, opts);
}

module.exports = {
  answerFromImageWithModelSelectionStream
};
