/**
 * Production Transcription Service - Ultra-robust for meetings/interviews
 * Handles multiple providers with advanced error handling and quality optimization
 */

class TranscriptionService {
    constructor() {
        // Preferred order: OpenAI fast -> Gemini -> OpenAI Whisper
        this.providers = ['openai-fast', 'gemini', 'openai-whisper'];
        this.currentProvider = 'openai-fast';
        this.fallbackEnabled = true;
        this.qualitySettings = {
            sampleRate: 48000,
            bitRate: 128000,
            format: 'webm',
            codec: 'opus'
        };
        this.retrySettings = {
            maxRetries: 3,
            retryDelay: 1000,
            backoffMultiplier: 2
        };
        this.cache = new Map(); // Cache successful transcriptions
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageLatency: 0,
            providerUsage: {}
        };
        this.isFirstTranscription = true; // Track first transcription for special handling
    }

    /**
     * Main transcription method with robust error handling and fallbacks
     */
    async transcribe(audioData, options = {}) {
        const startTime = Date.now();
        this.metrics.totalRequests++;
        
        try {
            console.log(`[TRANSCRIPTION] Starting transcription with provider: ${this.currentProvider} (First: ${this.isFirstTranscription})`);

            // Special handling for first transcription to prevent corruption
            if (this.isFirstTranscription) {
                console.log('[TRANSCRIPTION] First transcription detected - using enhanced validation');

                // Validate audio data more strictly for first transcription
                if (!audioData || audioData.length === 0) {
                    throw new Error('Empty audio data on first transcription');
                }

                // Add small delay for first transcription to ensure audio buffer is stable
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Validate and optimize audio data
            const optimizedAudio = await this.optimizeAudioForTranscription(audioData, options);

            // Generate cache key for all transcriptions
            const cacheKey = this.generateCacheKey(optimizedAudio);

            // Skip cache for first transcription to ensure fresh processing
            let result;
            if (this.isFirstTranscription) {
                console.log('[TRANSCRIPTION] Skipping cache for first transcription');
                result = await this.transcribeWithFallback(optimizedAudio, options);

                // Validate result for first transcription
                if (result && result.text) {
                    const text = result.text.trim();

                    // Check for repetitive patterns that indicate corruption
                    if (this.isRepetitiveText(text)) {
                        console.warn('[TRANSCRIPTION] First transcription appears corrupted, retrying...');

                        // Wait a bit and retry
                        await new Promise(resolve => setTimeout(resolve, 500));
                        result = await this.transcribeWithFallback(optimizedAudio, options);
                    }
                }

                // Mark first transcription as complete
                this.isFirstTranscription = false;
                console.log('[TRANSCRIPTION] First transcription completed successfully');
            } else {
                // Check cache first (for duplicate audio) - only for non-first transcriptions
                if (this.cache.has(cacheKey)) {
                    console.log('[TRANSCRIPTION] Cache hit - returning cached result');
                    const cachedResult = this.cache.get(cacheKey);
                    this.updateMetrics(startTime, true, 'cache');
                    return cachedResult;
                }

                // Try transcription with fallback chain
                result = await this.transcribeWithFallback(optimizedAudio, options);
            }

            // Cache successful result (for both first and subsequent transcriptions)
            if (result && result.text) {
                this.cache.set(cacheKey, result);
            }
            
            // Clean old cache entries (keep last 100)
            if (this.cache.size > 100) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
            
            this.updateMetrics(startTime, true, this.currentProvider);
            console.log('[TRANSCRIPTION] Transcription successful:', result.text.substring(0, 100) + '...');
            
            return result;
            
        } catch (error) {
            this.updateMetrics(startTime, false, this.currentProvider);
            console.error('[TRANSCRIPTION] All transcription methods failed:', error);
            
            // Return structured error for better handling
            return {
                success: false,
                error: error.message,
                text: '[Transcription failed - please try again]',
                confidence: 0,
                provider: null,
                suggestions: this.getErrorSuggestions(error)
            };
        }
    }

    /**
     * Transcribe with fallback provider chain
     */
    async transcribeWithFallback(audioData, options) {
        let lastError = null;
        
        for (const provider of this.providers) {
            try {
                console.log(`[TRANSCRIPTION] Trying provider: ${provider}`);
                
                const result = await this.transcribeWithProvider(provider, audioData, options);
                
                // Validate result quality
                if (this.validateTranscriptionResult(result)) {
                    this.currentProvider = provider; // Update preferred provider
                    return {
                        success: true,
                        text: result.text,
                        confidence: result.confidence || 0.95,
                        provider: provider,
                        duration: result.duration,
                        language: result.language || 'en'
                    };
                } else {
                    throw new Error(`Low quality result from ${provider}`);
                }
                
            } catch (error) {
                console.warn(`[TRANSCRIPTION] Provider ${provider} failed:`, error.message);
                lastError = error;
                
                // Update provider usage metrics
                if (!this.metrics.providerUsage[provider]) {
                    this.metrics.providerUsage[provider] = { attempts: 0, failures: 0 };
                }
                this.metrics.providerUsage[provider].attempts++;
                this.metrics.providerUsage[provider].failures++;
                
                continue; // Try next provider
            }
        }
        
        throw new Error(`All transcription providers failed. Last error: ${lastError?.message}`);
    }

    /**
     * Transcribe with specific provider
     */
    async transcribeWithProvider(provider, audioData, options) {
        const { userOpenAIKey, userGeminiKey, interviewLanguageCode } = options;

        switch (provider) {
            case 'openai-fast':
                return await this.transcribeWithOpenAIFast(audioData, userOpenAIKey, interviewLanguageCode);
            case 'openai-whisper':
                return await this.transcribeWithOpenAIWhisper(audioData, userOpenAIKey, interviewLanguageCode);
            case 'gemini':
                return await this.transcribeWithGemini(audioData, userGeminiKey, interviewLanguageCode);
            default:
                throw new Error(`Unknown transcription provider: ${provider}`);
        }
    }

    /**
     * OpenAI Fast Transcription (primary method) - uses gpt-4o-mini-transcribe
     */
    async transcribeWithOpenAIFast(audioData, apiKey, language) {
        if (!apiKey) {
            throw new Error('OpenAI API key not available for transcription');
        }

        const lang = (typeof language === 'string' && language.trim()) ? language.trim() : 'en';

        const formData = new FormData();
        const audioBlob = new Blob([audioData], { type: 'audio/webm' });
        formData.append('file', audioBlob, 'audio.webm');
        formData.append('model', 'gpt-4o-mini-transcribe');
        formData.append('language', lang);
        formData.append('response_format', 'verbose_json');

        // Enhanced prompt for professional context
        formData.append('prompt', 'This is a professional interview or meeting conversation. Transcribe every word accurately including technical terms.');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

        try {
            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                body: formData,
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();

            return {
                text: result.text || '',
                confidence: this.calculateConfidence(result),
                duration: result.duration,
                language: result.language || lang,
                segments: result.segments || []
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * OpenAI gpt-4o-transcribe (highest quality backup method)
     */
    async transcribeWithOpenAIWhisper(audioData, apiKey, language) {
        if (!apiKey) {
            throw new Error('OpenAI API key not available for transcription');
        }

        const lang = (typeof language === 'string' && language.trim()) ? language.trim() : 'en';
        const langNames = { en: 'English', hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ta: 'Tamil', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic' };
        const langName = langNames[lang] || 'English';

        const formData = new FormData();
        const audioBlob = new Blob([audioData], { type: 'audio/webm' });
        formData.append('file', audioBlob, 'audio.webm');
        formData.append('model', 'gpt-4o-transcribe');
        formData.append('language', lang);
        formData.append('response_format', 'json');
        formData.append('prompt', `Transcribe this ${langName} audio from a professional interview or meeting with perfect accuracy. Capture every word including technical terms, names, and numbers.`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout for highest quality

        try {
            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                body: formData,
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`OpenAI gpt-4o-transcribe API error: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();

            return {
                text: result.text || '',
                confidence: 0.98, // gpt-4o-transcribe has best accuracy
                language: lang
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Gemini Transcription (fallback method) - gemini-2.5-flash with robust prompt
     */
    async transcribeWithGemini(audioData, apiKey, language) {
        if (!apiKey) {
            throw new Error('Gemini API key not available for transcription');
        }

        const lang = (typeof language === 'string' && language.trim()) ? language.trim() : 'en';
        const langNames = { en: 'English', hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ta: 'Tamil', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic' };
        const langName = langNames[lang] || 'English';

        // Convert audio data to base64 - handle large audio in chunks to avoid stack overflow
        const uint8 = new Uint8Array(audioData);
        let base64Audio = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8.length; i += chunkSize) {
            const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
            base64Audio += btoa(String.fromCharCode(...chunk));
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: `You are a professional audio transcription engine. Transcribe the following audio to ${langName} text with perfect accuracy. Capture every single word, including technical terms, names, numbers, and filler words. Do NOT summarize, paraphrase, or skip any content. Return ONLY the raw transcribed text with no formatting or comments.` },
                            {
                                inlineData: {
                                    mimeType: 'audio/webm',
                                    data: base64Audio
                                }
                            }
                        ]
                    }],
                    generationConfig: {
                        maxOutputTokens: 2000,
                        temperature: 0.05
                    }
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

            return {
                text: text.trim(),
                confidence: 0.90,
                language: lang
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Optimize audio for transcription quality
     */
    async optimizeAudioForTranscription(audioData, options) {
        try {
            // For now, return as-is, but this could include:
            // - Noise reduction
            // - Volume normalization  
            // - Format conversion
            // - Sample rate optimization
            
            console.log('[TRANSCRIPTION] Audio optimization - data size:', audioData.byteLength || audioData.length);
            
            // Basic validation
            if (!audioData || (audioData.byteLength || audioData.length) === 0) {
                throw new Error('Empty audio data provided');
            }
            
            return audioData;
        } catch (error) {
            console.error('[TRANSCRIPTION] Audio optimization failed:', error);
            throw error;
        }
    }

    /**
     * Validate transcription result quality
     */
    validateTranscriptionResult(result) {
        if (!result || !result.text) {
            return false;
        }
        
        const text = result.text.trim();
        
        // Basic quality checks
        if (text.length < 1) {
            return false;
        }
        
        // Check for common error patterns
        const errorPatterns = [
            /^[\s\.\,\-\_]+$/,  // Only punctuation/whitespace
            /^[^a-zA-Z]+$/,     // No letters at all
            /^(.)\1{10,}$/      // Repeated single character
        ];
        
        for (const pattern of errorPatterns) {
            if (pattern.test(text)) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Calculate confidence score from API response
     */
    calculateConfidence(result) {
        if (result.confidence) {
            return result.confidence;
        }
        
        // Estimate confidence based on available data
        if (result.segments && result.segments.length > 0) {
            const avgConfidence = result.segments.reduce((sum, seg) => 
                sum + (seg.avg_logprob || 0), 0) / result.segments.length;
            return Math.max(0, Math.min(1, (avgConfidence + 5) / 5)); // Normalize
        }
        
        return 0.9; // Default confidence
    }

    /**
     * Generate cache key for audio data using robust sampling hash.
     * Previous implementation only used length + 3 bytes which caused
     * constant cache collisions (WebM files share the same EBML header),
     * returning stale transcriptions from previous recordings.
     */
    generateCacheKey(audioData) {
        const data = new Uint8Array(audioData);
        const length = data.length;
        if (length === 0) return '0-empty';

        // Sample ~64 evenly-spaced bytes plus a running sum for a collision-resistant key
        const sampleCount = Math.min(64, length);
        const step = Math.max(1, Math.floor(length / sampleCount));
        let hash = 0;
        const samples = [];
        for (let i = 0; i < length; i += step) {
            const byte = data[i];
            samples.push(byte);
            // Simple DJB2-style hash mixing
            hash = ((hash << 5) + hash + byte) >>> 0;
        }

        // Include a timestamp component to guarantee uniqueness across recordings
        return `${length}-${hash}-${Date.now()}`;
    }

    /**
     * Update performance metrics
     */
    updateMetrics(startTime, success, provider) {
        const latency = Date.now() - startTime;
        
        if (success) {
            this.metrics.successfulRequests++;
        } else {
            this.metrics.failedRequests++;
        }
        
        // Update average latency
        const totalRequests = this.metrics.successfulRequests + this.metrics.failedRequests;
        this.metrics.averageLatency = (this.metrics.averageLatency * (totalRequests - 1) + latency) / totalRequests;
        
        // Update provider usage
        if (!this.metrics.providerUsage[provider]) {
            this.metrics.providerUsage[provider] = { attempts: 0, failures: 0 };
        }
        this.metrics.providerUsage[provider].attempts++;
        
        console.log(`[TRANSCRIPTION] Metrics - Success rate: ${(this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(1)}%`);
    }

    /**
     * Check if text appears to be repetitive (indicating corruption)
     */
    isRepetitiveText(text) {
        if (!text || text.length < 20) return false;

        const words = text.toLowerCase().split(/\s+/);
        if (words.length < 5) return false;

        // Check for repeated words (more than 50% repetition)
        const wordCounts = {};
        words.forEach(word => {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        });

        const maxCount = Math.max(...Object.values(wordCounts));
        const repetitionRatio = maxCount / words.length;

        // Also check for specific patterns that indicate corruption
        const hasRepetitivePattern =
            text.includes('Testing. Testing. Testing.') ||
            text.includes('Hello. Hello. Hello.') ||
            text.includes('interview conversation or interview conversation') ||
            /(\w+\.?\s*){5,}\1/.test(text); // Regex for repeated patterns

        const isRepetitive = repetitionRatio > 0.5 || hasRepetitivePattern;

        if (isRepetitive) {
            console.log(`[TRANSCRIPTION] Detected repetitive text: ${repetitionRatio.toFixed(2)} ratio, pattern: ${hasRepetitivePattern}`);
        }

        return isRepetitive;
    }

    /**
     * Get suggestions for handling transcription errors
     */
    getErrorSuggestions(error) {
        const suggestions = [];

        if (error.message.includes('API key')) {
            suggestions.push('Check your API keys in Settings → API Keys');
        }

        if (error.message.includes('network') || error.message.includes('timeout')) {
            suggestions.push('Check your internet connection');
            suggestions.push('Try again in a moment');
        }

        if (error.message.includes('Empty audio')) {
            suggestions.push('Make sure your microphone is working');
            suggestions.push('Check audio permissions in browser settings');
        }

        if (error.message.includes('Low quality')) {
            suggestions.push('Speak more clearly into the microphone');
            suggestions.push('Check for background noise');
        }

        return suggestions;
    }

    /**
     * Get transcription metrics and statistics
     */
    getMetrics() {
        return {
            ...this.metrics,
            successRate: this.metrics.totalRequests > 0 ? 
                (this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(1) + '%' : 
                'N/A',
            cacheSize: this.cache.size,
            currentProvider: this.currentProvider
        };
    }

    /**
     * Reset metrics and cache
     */
    reset() {
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageLatency: 0,
            providerUsage: {}
        };
        this.cache.clear();
        console.log('[TRANSCRIPTION] Service reset');
    }
}

// Export for both ES6 and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TranscriptionService;
} else {
    window.TranscriptionService = TranscriptionService;
}
