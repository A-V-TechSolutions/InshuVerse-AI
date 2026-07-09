const fs = require('fs');
const tmp = require('tmp');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { callWithFallback } = require('./model-registry');

// Validate audio buffer to prevent 400 errors
function validateAudioBuffer(audioBuffer) {
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Audio buffer is empty');
  }

  // Check minimum size (WebM header + some audio data)
  // WebM files have a minimum structure, typically > 100 bytes for even tiny audio
  if (audioBuffer.length < 100) {
    throw new Error('Audio buffer too small - likely corrupted or incomplete recording');
  }

  // Validate WebM file signature (first 4 bytes should be 0x1A 0x45 0xDF 0xA3)
  const webmSignature = Buffer.from([0x1A, 0x45, 0xDF, 0xA3]);
  const fileHeader = audioBuffer.slice(0, 4);

  if (!fileHeader.equals(webmSignature)) {
    console.warn('[TRANSCRIPTION] Invalid WebM signature:', fileHeader.toString('hex'));
    // Don't throw - some valid audio might have different encoding
    // Just log warning and continue
  }

  // Check for minimum audio duration by file size
  // Opus at 256kbps = 32KB/s, so 0.3s minimum = ~10KB
  if (audioBuffer.length < 8000) {
    throw new Error('Audio too short - please speak for at least 0.5 seconds');
  }

  return true;
}

// Attempt OpenAI fast transcription (gpt-4o-mini-transcribe) - optimized for speed
// interviewLanguageCode (optional) lets us hint the spoken language to the model.
async function transcribeWithOpenAIFast(audioBuffer, { userOpenAIKey, interviewLanguageCode }) {
  if (!userOpenAIKey) throw new Error('Lifetime plan requires your own OpenAI API key. Please set it in the API Keys tab of Settings (gear icon).');

  // Validate audio before sending to API
  validateAudioBuffer(audioBuffer);

  // 5s timeout, no SDK retries — the sequential fallback chain in
  // transcribeWithFallback IS the retry layer. SDK retries here just
  // delay falling through to Gemini/quality on transient errors. Healthy
  // requests complete in 1–3 s; 5 s caps the worst-case OpenAI-fast tail
  // at ~10 s before Gemini takes over (was 24+ s with the original 12 s
  // setting and the keypool's 2-attempt rotation). Auth errors (401/403)
  // already short-circuit the OpenAI quality fallback in the chain.
  const openai = new OpenAI({ apiKey: userOpenAIKey, maxRetries: 0, timeout: 5000 });
  const tmpFile = tmp.fileSync({ postfix: '.webm' });

  try {
    // Write buffer to file with error handling
    fs.writeFileSync(tmpFile.name, audioBuffer);

    const lang = (typeof interviewLanguageCode === 'string' && interviewLanguageCode.trim())
      ? interviewLanguageCode.trim()
      : 'en';

    // Model resolved via registry; rotates to whisper-1 if the upstream
    // returns 404 (e.g., gpt-4o-mini-transcribe deprecated). Override via
    // globalThis.userOpenAITranscribeModel is preserved.
    const response = await callWithFallback('TRANSCRIBE_FAST', (modelId) =>
      openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile.name),
        model: modelId,
        language: lang,
        response_format: 'text',
        prompt: 'This is a professional interview or meeting conversation. Transcribe every word accurately, including technical terms.',
      }),
      { override: globalThis?.userOpenAITranscribeModel },
    );

    const text = (typeof response === 'string') ? response : (response?.text ?? '');
    if (!text || text.trim().length === 0) {
      throw new Error('OpenAI fast transcription returned empty - no speech detected');
    }

    return { text: text.trim(), provider: 'openai-fast', confidence: 0.95 };

  } catch (error) {
    // Enhanced error handling with specific messages
    const errorMsg = error.message || String(error);

    if (error.status === 400 || errorMsg.includes('400')) {
      // Check specific 400 error causes
      if (errorMsg.includes('duration') || errorMsg.includes('too short')) {
        throw new Error('Audio too short - please speak for at least 0.5 seconds');
      }
      if (errorMsg.includes('format') || errorMsg.includes('invalid')) {
        throw new Error('Invalid audio format - please try recording again');
      }
      throw new Error('Audio processing failed - please try recording again');
    }

    if (error.status === 413 || errorMsg.includes('413') || errorMsg.includes('too large')) {
      throw new Error('Audio file too large - please record shorter segments (max 60 seconds)');
    }

    // Re-throw other errors as-is
    throw error;

  } finally {
    // Always clean up temp file
    try {
      tmpFile.removeCallback();
    } catch (cleanupErr) {
      console.warn('[TRANSCRIPTION] Temp file cleanup warning:', cleanupErr.message);
    }
  }
}

// OpenAI gpt-4o-transcribe - highest quality transcription model (better WER than whisper-1)
// interviewLanguageCode should be an ISO language code like 'en', 'hi', 'te', etc.
async function transcribeWithOpenAI(audioBuffer, { userOpenAIKey, interviewLanguageCode }) {
  if (!userOpenAIKey) throw new Error('Lifetime plan requires your own OpenAI API key. Please set it in the API Keys tab of Settings (gear icon).');

  // Validate audio before sending to API
  validateAudioBuffer(audioBuffer);

  // 18s timeout, no SDK retries (see transcribeWithOpenAIFast rationale).
  // gpt-4o-transcribe is slower than the mini variant — 18 s accommodates
  // longer clips while still bounding the worst-case fallback tail.
  const openai = new OpenAI({ apiKey: userOpenAIKey, maxRetries: 0, timeout: 18000 });
  const tmpFile = tmp.fileSync({ postfix: '.webm' });

  try {
    // Write buffer to file with error handling
    fs.writeFileSync(tmpFile.name, audioBuffer);

    const lang = (typeof interviewLanguageCode === 'string' && interviewLanguageCode.trim())
      ? interviewLanguageCode.trim()
      : 'en';

    const langNames = {
      en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese',
      it: 'Italian', ru: 'Russian', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese',
      ko: 'Korean', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', sv: 'Swedish',
      da: 'Danish', fi: 'Finnish', no: 'Norwegian', uk: 'Ukrainian', vi: 'Vietnamese',
      id: 'Indonesian', th: 'Thai', ms: 'Malay',
      hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ta: 'Tamil', ml: 'Malayalam',
      mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu'
    };
    const langName = langNames[lang] || 'English';

    const response = await callWithFallback('TRANSCRIBE_QUALITY', (modelId) =>
      openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile.name),
        model: modelId,
        language: lang,
        response_format: 'text',
        prompt: `Transcribe this ${langName} audio from a professional interview or meeting. Capture every word accurately including technical terms, names, and numbers. Do not skip or hallucinate any content.`,
      }),
    );

    const text = (typeof response === 'string') ? response : (response?.text ?? '');
    if (!text || text.trim().length === 0) {
      throw new Error('OpenAI gpt-4o-transcribe returned empty - no speech detected');
    }

    return { text: text.trim(), provider: 'openai-transcribe', confidence: 0.98 };

  } catch (error) {
    // Enhanced error handling with specific messages
    const errorMsg = error.message || String(error);

    if (error.status === 400 || errorMsg.includes('400')) {
      if (errorMsg.includes('duration') || errorMsg.includes('too short')) {
        throw new Error('Audio too short - please speak for at least 0.5 seconds');
      }
      if (errorMsg.includes('format') || errorMsg.includes('invalid')) {
        throw new Error('Invalid audio format - please try recording again');
      }
      throw new Error('Audio processing failed - please try recording again');
    }

    if (error.status === 413 || errorMsg.includes('413') || errorMsg.includes('too large')) {
      throw new Error('Audio file too large - please record shorter segments (max 60 seconds)');
    }

    throw error;

  } finally {
    try {
      tmpFile.removeCallback();
    } catch (cleanupErr) {
      console.warn('[TRANSCRIPTION] Temp file cleanup warning:', cleanupErr.message);
    }
  }
}

// Gemini transcription - optimized for speed with proper validation
async function transcribeWithGemini(audioBuffer, { userGeminiKey, interviewLanguageCode }) {
  if (!userGeminiKey) throw new Error('Lifetime plan requires your own Gemini API key. Please set it in the API Keys tab of Settings (gear icon).');

  // Validate audio before sending to API
  validateAudioBuffer(audioBuffer);

  const genAI = new GoogleGenerativeAI(userGeminiKey);
  // Model resolved through the registry (GEMINI_FLASH_LITE → 1.5-flash → 2.5-flash).
  const buildModel = (modelId) => genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      maxOutputTokens: 2000,
      temperature: 0.05 // Very low temperature for maximum accuracy
    }
  });

  const mimeType = 'audio/webm';
  const langCode = (typeof interviewLanguageCode === 'string' && interviewLanguageCode.trim())
    ? interviewLanguageCode.trim()
    : 'en';

  const langNames = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese',
    it: 'Italian', ru: 'Russian', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese',
    ko: 'Korean', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', sv: 'Swedish',
    da: 'Danish', fi: 'Finnish', no: 'Norwegian', uk: 'Ukrainian', vi: 'Vietnamese',
    id: 'Indonesian', th: 'Thai', ms: 'Malay',
    hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ta: 'Tamil', ml: 'Malayalam',
    mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu'
  };
  const langName = langNames[langCode] || 'English';

  const contents = [
    { text: `You are a professional audio transcription engine. Transcribe the following audio to ${langName} text with perfect accuracy. Capture every single word, including technical terms, names, numbers, and filler words. Do NOT summarize, paraphrase, or skip any content. Return ONLY the raw transcribed text with no formatting or comments.` },
    { inlineData: { data: audioBuffer.toString('base64'), mimeType } },
  ];

  // 6s timeout. Gemini audio inference typically returns in 1–3 s; 6 s
  // bounds the tail aggressively so a stalled request falls through to
  // OpenAI quality (the last resort) before the user perceives a hang.
  // callWithFallback rotates the model id on 404 / "not found for API version".
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Gemini transcription timeout')), 6000)
  );

  try {
    const result = await callWithFallback('GEMINI_FLASH_LITE', (modelId) =>
      Promise.race([buildModel(modelId).generateContent(contents), timeoutPromise]),
    );
    const text = result?.response?.text?.() || '';

    if (!text || text.trim().length === 0) {
      throw new Error('Gemini transcription returned empty - no speech detected');
    }

    return { text: text.trim(), provider: 'gemini', confidence: 0.90 };

  } catch (error) {
    const errorMsg = error.message || String(error);

    // Handle Gemini-specific errors
    if (errorMsg.includes('503') || errorMsg.includes('overloaded')) {
      throw new Error('Gemini service temporarily overloaded - will retry with OpenAI');
    }

    if (errorMsg.includes('quota') || errorMsg.includes('limit')) {
      throw new Error('Gemini API quota exceeded - please check your billing');
    }

    throw error;
  }
}

// Note: Grok API does not support audio transcription
// Grok transcription is not available - will fall back to other providers

// 401 / 403 indicates the key itself is rejected (expired, revoked, wrong
// project, free-tier exhausted on a per-key billing cap). Retrying a second
// model with the same key would burn another 6–18 s timeout for the same
// rejection, so the fallback chain skips remaining same-provider steps when
// it sees one of these statuses. The OpenAI SDK surfaces status both as
// `err.status` and inside the message string, so we sniff both.
function isAuthError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || (err.response && err.response.status);
  if (status === 401 || status === 403) return true;
  return /\b(401|403)\b/.test(String(err.message || ''));
}

// SEQUENTIAL FALLBACK — cheapest-first pipeline that is also KEY-AWARE.
// Order when both keys are present:
//   gpt-4o-mini-transcribe (fast/cheap) → gemini-2.5-flash-lite (cheap)
//                                       → gpt-4o-transcribe (quality, last resort)
// When only one provider has a key, the other steps are skipped entirely
// instead of relying on the synchronous "missing key" throw inside each
// helper. For Gemini-only users this means we go straight to Gemini
// (1–3 s typical) instead of producing two noisy "Lifetime plan requires
// your own OpenAI API key" log lines around it; for OpenAI-only users
// we skip the Gemini hop and use the fast/quality OpenAI pair.
async function transcribeWithFallback(audioBuffer, keys) {
	  const hasOpenAI = !!keys?.userOpenAIKey;
	  const hasGemini = !!keys?.userGeminiKey;

	  if (!hasOpenAI && !hasGemini) {
	    throw new Error('No transcription API key configured — please add an OpenAI or Gemini key in Settings → API Keys.');
	  }

	  console.log(`[TRANSCRIPTION] Sequential fallback (openai=${hasOpenAI}, gemini=${hasGemini})`);

	  let lastError;
	  let openaiAuthFailed = false;

	  // 1) Primary: OpenAI fast mini-transcribe — cheapest OpenAI option
	  if (hasOpenAI) {
	    try {
	      const result = await transcribeWithOpenAIFast(audioBuffer, keys);
	      return result.text;
	    } catch (e1) {
	      console.warn('[TRANSCRIPTION] OpenAI fast (mini) failed:', e1.message);
	      if (isAuthError(e1)) {
	        openaiAuthFailed = true;
	        console.warn('[TRANSCRIPTION] OpenAI key rejected (401/403); will skip OpenAI quality fallback.');
	      }
	      lastError = e1;
	    }
	  }

	  // 2) Backup: Gemini 2.5-flash-lite (if configured)
	  if (hasGemini) {
	    try {
	      const result = await transcribeWithGemini(audioBuffer, keys);
	      return result.text;
	    } catch (e2) {
	      console.warn('[TRANSCRIPTION] Gemini failed:', e2.message);
	      lastError = e2;
	    }
	  }

	  // 3) Last resort: OpenAI gpt-4o-transcribe (quality, higher cost) —
	  //    skipped when the same OpenAI key already returned 401/403, since
	  //    a second attempt would just hit the 18 s timeout for nothing.
	  if (hasOpenAI && !openaiAuthFailed) {
	    try {
	      const result = await transcribeWithOpenAI(audioBuffer, keys);
	      return result.text;
	    } catch (e3) {
	      console.warn('[TRANSCRIPTION] OpenAI quality failed:', e3.message);
	      lastError = e3;
	    }
	  }

	  throw lastError || new Error('All transcription providers failed');
}

// Model-aware transcription — SEQUENTIAL FALLBACK by default (parallel racing disabled)
// This is the main entry point for all transcription requests.
// A single request is dispatched per voice interaction to avoid redundant API calls.
async function transcribeWithModelSelection(audioBuffer, keys, sendStatus) {
	const { selectedModel } = keys;

	if (sendStatus) {
		sendStatus('🎤 Transcribing audio with AI...');
	}

	// Honour explicitly-selected model with a single sequential request
	if (selectedModel && selectedModel !== 'default') {
		try {
			let transcription;

			switch (selectedModel) {
				case 'openai':
					// Single request: fast model, then quality model as fallback
					if (sendStatus) sendStatus('🎤 Transcribing with OpenAI...');
					try {
						const result = await transcribeWithOpenAIFast(audioBuffer, keys);
						transcription = result.text;
					} catch (e) {
						console.warn('[TRANSCRIPTION] OpenAI fast failed, trying quality model:', e.message);
						if (sendStatus) sendStatus('🎤 Retrying with OpenAI quality model...');
						const result = await transcribeWithOpenAI(audioBuffer, keys);
						transcription = result.text;
					}
					break;

				case 'gemini':
					if (sendStatus) sendStatus('🎤 Transcribing with Gemini...');
					const result = await transcribeWithGemini(audioBuffer, keys);
					transcription = result.text;
					break;

				default:
					throw new Error(`Unknown model: ${selectedModel}`);
			}

			console.log(`[TRANSCRIPTION] ✅ Successfully used selected model: ${selectedModel}`);
			if (sendStatus) sendStatus('✅ Transcription completed');
			return transcription;

		} catch (error) {
			console.warn(`[TRANSCRIPTION] Selected model ${selectedModel} failed: ${error.message}, falling back to sequential fallback`);
			// Sequential fallback — single provider at a time, no parallel racing
			return await transcribeWithFallback(audioBuffer, keys);
		}
	}

	// DEFAULT BEHAVIOR: sequential fallback (Gemini → OpenAI) — one request at a time
	// Parallel racing has been disabled to reduce credit consumption.
	console.log('[TRANSCRIPTION] Using sequential fallback (default) — single request per interaction');
	try {
		const text = await transcribeWithFallback(audioBuffer, keys);
		if (sendStatus) sendStatus('✅ Transcription completed');
		return text;
	} catch (fallbackError) {
		console.warn('[TRANSCRIPTION] Sequential fallback failed:', fallbackError.message);
		if (sendStatus) sendStatus('❌ Transcription failed');
		throw fallbackError;
	}
}

module.exports = {
  transcribeWithModelSelection,
  // Exposed for behavioral tests that mock the OpenAI / Gemini SDKs and
  // assert the key-aware fallback chain is honoured. NOT for production
  // callers — the model-selection wrapper is the public entry point.
  transcribeWithFallback,
  isAuthError,
};
