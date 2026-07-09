/**
 * Audio-Transcription Coordinator - Bridges new audio system with transcription
 * Production-quality pipeline for meetings/interviews with zero audio loss
 */

class AudioTranscriptionCoordinator {
    constructor() {
        this.transcriptionService = new TranscriptionService();
        this.audioManager = null;
        this.isRecording = false;
	        this.isStopping = false;
        this.currentStream = null;
	        // When using System Default on Windows we capture both system loopback + microphone and mix them.
	        this.defaultMix = {
	            active: false,
	            systemStream: null,
	            micStream: null,
	            mixedStream: null,
	            audioContext: null
	        };
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingStartTime = null;
	        this.progressIntervalId = null;
        this.settings = {
            chunkDuration: 30000, // 30 seconds for real-time processing
            maxRecordingDuration: 3600000, // 1 hour max
            audioFormat: 'webm',
            audioCodec: 'opus',
            audioBitsPerSecond: 256000, // Increased from 128k to 256k for better audio quality
            sampleRate: 48000,
            enableRealTimeTranscription: false,
            autoStop: true
        };
        this.callbacks = {
            onTranscriptionResult: null,
            onRecordingStart: null,
            onRecordingStop: null,
            onError: null,
            onProgress: null
        };
	        this.qualityMonitor = {
	            audioLevels: [],
	            silenceDetected: false,
	            averageLevel: 0
	        };
	        // OpenAI Realtime (WebSocket) integration state - DISABLED for simple HTTP-only pipeline
	        this.realtime = {
	            enabled: false,     // Voice path now uses HTTP Whisper only (no Realtime)
	            active: false,
	            error: null,
	            audioContext: null,
	            sourceNode: null,
	            processorNode: null
	        };
    }

    /**
     * Initialize coordinator with audio manager
     */
    async initialize(audioManager) {
        try {
            this.audioManager = audioManager;
            
            // Set up audio system callbacks
            if (this.audioManager) {
                this.audioManager.setCallbacks({
                    onLevelUpdate: (level, rms, mode) => {
                        this.monitorAudioQuality(level, rms, mode);
                    },
                    onError: (error) => {
                        this.handleAudioError(error);
                    },
                    onStreamEnd: (prevMode) => {
                        if (this.isRecording) {
                            this.stopRecording('Stream ended unexpectedly');
                        }
                    }
                });
            }
            
            console.log('[AUDIO_TRANSCRIPTION] Coordinator initialized successfully');
            return true;
        } catch (error) {
            console.error('[AUDIO_TRANSCRIPTION] Failed to initialize coordinator:', error);
            return false;
        }
    }

    /**
     * Start recording with specified audio source (system, microphone, or default)
     */
    async startRecording(audioSource = 'system', options = {}) {
        try {
            if (this.isRecording) {
                throw new Error('Recording already in progress');
            }
	            if (this.isStopping) {
	                throw new Error('Recording is stopping, please wait');
	            }

            console.log(`[AUDIO_TRANSCRIPTION] Starting recording with source: ${audioSource}`);

            // Ensure audio manager is ready
            if (!this.audioManager || !this.audioManager.isReady()) {
                throw new Error('Audio manager not initialized');
            }

            // ── CRITICAL: Clean up previous state before starting new recording ──
	            // Tear down any previous System Default mixer state (AudioContext etc.)
	            this.cleanupDefaultMix({ stopStreams: true });

            // Stop any lingering streams in the underlying audio service
            try {
                this.audioManager.stopCapture();
            } catch (e) {
                console.warn('[AUDIO_TRANSCRIPTION] Pre-start cleanup warning:', e.message);
            }

            // Ensure previous MediaRecorder / stream references are fully cleared
            if (this.currentStream) {
                this.currentStream.getTracks().forEach(track => {
                    try { track.stop(); } catch (e) { /* ignore */ }
                });
                this.currentStream = null;
            }
            this.mediaRecorder = null;
            this.audioChunks = [];

            // Clear transcription cache to prevent returning stale results
            // from a previous recording session
            if (this.transcriptionService && this.transcriptionService.cache) {
                this.transcriptionService.cache.clear();
                console.log('[AUDIO_TRANSCRIPTION] Cleared transcription cache for fresh recording');
            }
            // ── End cleanup ──

            // Capture audio stream based on source.
            // Note: for 'default' on Windows we mix system loopback + microphone.
            let lifetimeStream;
            let recordSourceStream;
            if (audioSource === 'system') {
                lifetimeStream = await this.audioManager.captureSystemAudio();
                recordSourceStream = lifetimeStream;
            } else if (audioSource === 'default') {
                const captured = await this.captureDefaultStream(options);
                lifetimeStream = captured.lifetimeStream;
                recordSourceStream = captured.recordSourceStream;
            } else {
                lifetimeStream = await this.audioManager.captureMicrophoneAudio(options.deviceId);
                recordSourceStream = lifetimeStream;
            }

            if (!recordSourceStream || recordSourceStream.getAudioTracks().length === 0) {
                throw new Error('Failed to get audio stream');
            }

	            // IMPORTANT (Windows system audio reliability): keep any video track alive if present,
	            // but only record the audio tracks. Stopping/omitting the video track too early can
	            // prematurely end some Windows loopback capture sessions.
	            const recordingStream = new MediaStream(recordSourceStream.getAudioTracks());

            // Set up MediaRecorder with optimal settings
            const mimeType = this.getBestMimeType();
	            this.mediaRecorder = new MediaRecorder(recordingStream, {
                mimeType: mimeType,
                audioBitsPerSecond: this.settings.audioBitsPerSecond
            });

            // Reset recording state
            this.audioChunks = [];
            this.recordingStartTime = Date.now();
	            // Track lifecycle stream (may include video track for loopback stability, and/or both system+mic)
            this.currentStream = lifetimeStream;
	            this.qualityMonitor = {
	                audioLevels: [],
	                silenceDetected: false,
	                averageLevel: 0
	            };

	            // NOTE: Realtime audio pipeline is intentionally disabled.
	            // We now use a simple HTTP-only pipeline:
	            //   Record audio -> send buffer to main -> Whisper transcription -> OpenAI answer.

            // Set up MediaRecorder event handlers
            this.setupMediaRecorderEvents();

	            // Start recording WITHOUT a timeslice to avoid WebM chunk reassembly issues on Windows loopback.
	            // This produces a single, continuous Blob when stop() is called.
	            this.mediaRecorder.start();
            this.isRecording = true;
	            this.isStopping = false;

	            console.log('[AUDIO_TRANSCRIPTION] MediaRecorder started (no timeslice; single blob on stop)');

	            // Provide UI progress updates even without chunked MediaRecorder data.
	            if (this.progressIntervalId) {
	                clearInterval(this.progressIntervalId);
	            }
	            this.progressIntervalId = setInterval(() => {
	                if (!this.isRecording) return;
	                if (!this.callbacks.onProgress) return;
	                const currentDuration = Date.now() - this.recordingStartTime;
	                this.callbacks.onProgress({
	                    duration: currentDuration,
	                    chunks: this.audioChunks.length,
	                    audioQuality: this.calculateAudioQuality()
	                });
	            }, 500);

            // Set up automatic stop if configured
            if (this.settings.autoStop && this.settings.maxRecordingDuration > 0) {
                setTimeout(() => {
                    if (this.isRecording) {
                        this.stopRecording('Maximum recording duration reached');
                    }
                }, this.settings.maxRecordingDuration);
            }

            // Callback for recording start
            if (this.callbacks.onRecordingStart) {
                this.callbacks.onRecordingStart(audioSource, lifetimeStream);
            }

            console.log(`[AUDIO_TRANSCRIPTION] Recording started successfully with ${audioSource} audio`);
            return true;

        } catch (error) {
            console.error('[AUDIO_TRANSCRIPTION] Failed to start recording:', error);
            this.cleanup();
            
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            throw error;
        }
    }

    /**
     * Stop recording and process audio for transcription
     */
    async stopRecording(reason = 'User requested') {
        try {
            if (!this.isRecording) {
                console.warn('[AUDIO_TRANSCRIPTION] Stop called but not recording');
                return null;
            }
	            if (this.isStopping) {
	                console.warn('[AUDIO_TRANSCRIPTION] Stop called but already stopping');
	                return null;
	            }
	            this.isStopping = true;

            console.log(`[AUDIO_TRANSCRIPTION] Stopping recording: ${reason}`);

	            return new Promise((resolve, reject) => {
	                // Store mimeType before stop (mediaRecorder ref may be cleared)
	                const recordedMimeType = this.mediaRecorder?.mimeType || 'audio/webm';

	                // Set up stop handler
	                this.mediaRecorder.onstop = async () => {
	                    try {
	                        console.log('[AUDIO_TRANSCRIPTION] Processing recorded audio...');
		                        await this.yieldToUi();

	                        // Combine all audio chunks
	                        const audioBlob = new Blob(this.audioChunks, {
	                            type: recordedMimeType
	                        });
	
	                        // Validate audio data
	                        if (audioBlob.size === 0) {
	                            throw new Error('No audio data recorded');
	                        }
	
	                        const recordingDuration = Date.now() - this.recordingStartTime;
	                        console.log(`[AUDIO_TRANSCRIPTION] Audio recorded: ${audioBlob.size} bytes, ${recordingDuration}ms`);
	                        
	                        const metadata = {
	                            duration: recordingDuration,
	                            format: recordedMimeType,
		                            quality: this.calculateAudioQuality(),
		                            sizeBytes: audioBlob.size
	                        };

	                        // Single, robust HTTP-based pipeline via main/renderer services
		                        let transcriptionResult = await this.processAudioForTranscription(audioBlob, metadata);

	                        // Cleanup
	                        this.cleanup();
	                        this.isStopping = false;

	                        // Callback for recording stop
	                        if (this.callbacks.onRecordingStop) {
	                            this.callbacks.onRecordingStop(transcriptionResult, reason);
	                        }

	                        resolve(transcriptionResult);
	
	                    } catch (error) {
	                        console.error('[AUDIO_TRANSCRIPTION] Error processing audio:', error);
	                        this.cleanup();
	                        this.isStopping = false;
	                        
	                        if (this.callbacks.onError) {
	                            this.callbacks.onError(error);
	                        }
	                        reject(error);
	                    }
	                };

	                // Ensure very short captures still contain audio.
	                // Some Chromium builds can produce empty/partial blobs if stop() is called too quickly.
	                const minRecordMs = 400;
	                const elapsed = Date.now() - (this.recordingStartTime || Date.now());
	                const delayMs = Math.max(0, minRecordMs - elapsed);
	
	                setTimeout(() => {
	                    try {
	                        // Stop the recorder (this will emit a final dataavailable, then onstop)
	                        this.mediaRecorder.stop();
	                        this.isRecording = false;
	                    } catch (e) {
	                        console.error('[AUDIO_TRANSCRIPTION] Error calling MediaRecorder.stop():', e);
	                        this.cleanup();
	                        this.isStopping = false;
	                        reject(e);
	                    }
	                }, delayMs);
            });

        } catch (error) {
            console.error('[AUDIO_TRANSCRIPTION] Error stopping recording:', error);
            this.cleanup();
            throw error;
        }
    }

    /**
     * Process audio buffer for transcription
     */
	    async processAudioForTranscription(audioInput, metadata = {}) {
        try {
            console.log('[AUDIO_TRANSCRIPTION] Starting transcription process...');

	            const audioBlob = (typeof Blob !== 'undefined' && audioInput instanceof Blob) ? audioInput : null;
	            let audioBuffer = null;
	            if (audioInput instanceof ArrayBuffer) {
	                audioBuffer = audioInput;
	            } else if (ArrayBuffer.isView(audioInput)) {
	                // TypedArray/DataView
	                audioBuffer = audioInput.buffer.slice(audioInput.byteOffset, audioInput.byteOffset + audioInput.byteLength);
	            }

	            const sizeBytes = metadata.sizeBytes || (audioBlob ? audioBlob.size : (audioBuffer ? audioBuffer.byteLength : 0));
	            console.log(`[AUDIO_TRANSCRIPTION] Transcription input size: ${sizeBytes} bytes`);

            // Prefer secure main-process transcription via IPC (no keys in renderer)
            if (typeof ipcRenderer !== 'undefined') {
                try {
		                    // Large recordings can hang/freeze Electron IPC when sent as multi-MB buffers.
		                    // For those, write the Blob to a temp file and send ONLY the path.
		                    const threshold = this.getFileTransferThresholdBytes();
		                    let text;
		                    if (audioBlob && audioBlob.size >= threshold) {
		                        const ext = this.inferFileExtensionFromMime(audioBlob.type || metadata.format);
		                        console.log(`[AUDIO_TRANSCRIPTION] Large audio (${audioBlob.size} bytes) → using temp-file IPC transfer (${ext})`);
		                        const tmpPath = await this.writeBlobToTempFile(audioBlob, { ext });
		                        // Use transcribe-audio-file for large files (transcription-only, 1 credit)
		                        text = await ipcRenderer.invoke('transcribe-audio-file', { path: tmpPath, deleteAfter: true });
		                    } else {
		                        if (!audioBuffer) {
		                            if (!audioBlob) throw new Error('No audio data available');
		                            audioBuffer = await audioBlob.arrayBuffer();
		                        }
		                        // Send binary over IPC (avoid base64 expansion)
		                        const bytes = new Uint8Array(audioBuffer);
		                        // Use transcribe-audio-buffer for normal-sized audio (transcription-only, 1 credit)
		                        // NOTE: For full voice feature (transcription + answer), the renderer will send
		                        // the transcription to 'text-input' which deducts another 1 credit (total 2 credits)
		                        text = await ipcRenderer.invoke('transcribe-audio-buffer', bytes);
		                    }
                    const enhancedResult = {
                        success: true,
                        text,
                        provider: null,
                        recordingDuration: metadata.duration,
                        audioQuality: metadata.quality,
                        timestamp: new Date().toISOString(),
                        audioFormat: metadata.format
                    };

                    if (this.callbacks.onTranscriptionResult) {
                        this.callbacks.onTranscriptionResult(enhancedResult);
                    }
                    console.log('[AUDIO_TRANSCRIPTION] Transcription completed successfully (main IPC)');
                    return enhancedResult;
                } catch (err) {
	                    console.warn('[AUDIO_TRANSCRIPTION] Main transcription failed, falling back in renderer:', err?.message);
                }
            }

            // Fallback: use renderer-side service
	            if (!audioBuffer) {
	                if (!audioBlob) throw new Error('No audio data available');
	                audioBuffer = await audioBlob.arrayBuffer();
	            }
            const apiKeys = await this.getAPIKeys();
            // Retrieve interview language from localStorage for renderer-side transcription
            let interviewLanguageCode = 'en';
            try {
                const stored = localStorage.getItem('preferredTranslationLang');
                if (stored && stored.trim()) interviewLanguageCode = stored.trim();
            } catch (_) {}
            const result = await this.transcriptionService.transcribe(audioBuffer, {
                ...apiKeys,
                interviewLanguageCode,
                metadata: metadata,
                optimize: true
            });

            const enhancedResult = {
                ...result,
                recordingDuration: metadata.duration,
                audioQuality: metadata.quality,
                timestamp: new Date().toISOString(),
                audioFormat: metadata.format
            };

            if (this.callbacks.onTranscriptionResult) {
                this.callbacks.onTranscriptionResult(enhancedResult);
            }

            console.log('[AUDIO_TRANSCRIPTION] Transcription completed successfully (renderer fallback)');
            return enhancedResult;

        } catch (error) {
            console.error('[AUDIO_TRANSCRIPTION] Transcription failed:', error);
            
            // Return error result
            return {
                success: false,
                text: '[Transcription failed - please try again]',
                error: error.message,
                timestamp: new Date().toISOString(),
                recordingDuration: metadata.duration || 0
            };
        }
    }

    /**
     * Set up MediaRecorder event handlers
     */
    setupMediaRecorderEvents() {
        this.mediaRecorder.ondataavailable = (event) => {
	            const size = event?.data?.size || 0;
	            const type = event?.data?.type || '';
	            console.log(`[AUDIO_TRANSCRIPTION] ondataavailable: ${size} bytes${type ? ` (${type})` : ''}`);
	            if (size > 0) {
	                this.audioChunks.push(event.data);
	            }
        };

        this.mediaRecorder.onerror = (event) => {
            console.error('[AUDIO_TRANSCRIPTION] MediaRecorder error:', event.error);
            this.cleanup();
            
            if (this.callbacks.onError) {
                this.callbacks.onError(event.error);
            }
        };
    }

	    /**
	     * Start OpenAI Realtime transcription session in main process (best-effort).
	     * This does NOT block recording start – if it fails, we silently fall back.
	     */
	    async startRealtimeSession(audioSource) {
	        if (typeof ipcRenderer === 'undefined') {
	            console.warn('[AUDIO_TRANSCRIPTION] ipcRenderer not available, realtime disabled');
	            this.realtime.enabled = false;
	            return;
	        }
	        try {
	            const response = await ipcRenderer.invoke('openai-realtime-start', {
	                source: audioSource || 'system'
	            });
	            if (!response || response.success === false) {
	                console.warn('[AUDIO_TRANSCRIPTION] Failed to start OpenAI Realtime session:', response && response.error);
	                this.realtime.enabled = false;
	            } else {
	                this.realtime.enabled = true;
	            }
	        } catch (error) {
	            console.warn('[AUDIO_TRANSCRIPTION] OpenAI Realtime start failed, disabling realtime:', error);
	            this.realtime.enabled = false;
	            this.realtime.error = error;
	        }
	    }

	    /**
	     * Yield to UI thread to avoid long synchronous stalls after stop.
	     */
	    async yieldToUi() {
	        try {
	            await new Promise(resolve => setTimeout(resolve, 0));
	        } catch (_) {}
	    }

	    /**
	     * Above this size, use temp-file IPC transfer instead of sending multi-MB buffers.
	     */
	    getFileTransferThresholdBytes() {
	        // 1MB default: enough to route ~30-60s recordings to file on 256kbps,
	        // avoiding IPC freezes/hangs on Windows.
	        return 1024 * 1024;
	    }

	    inferFileExtensionFromMime(mimeType) {
	        const mt = (mimeType || '').toLowerCase();
	        if (mt.includes('ogg')) return 'ogg';
	        if (mt.includes('mp4')) return 'mp4';
	        // Default for MediaRecorder on Windows/Chromium
	        return 'webm';
	    }

	    /**
	     * Write a Blob to a temp file using streaming when possible (prevents large memory spikes).
	     */
	    async writeBlobToTempFile(blob, { ext = 'webm' } = {}) {
	        // Lazily require Node modules (renderer runs with nodeIntegration in this app)
	        let fs, os, path, Readable, pipeline;
	        try {
	            fs = require('fs');
	            os = require('os');
	            path = require('path');
	            ({ Readable } = require('stream'));
	            ({ pipeline } = require('stream/promises'));
	        } catch (e) {
	            // If nodeIntegration is disabled in some context, we cannot file-transfer.
	            throw new Error('File-based audio transfer unavailable in this context');
	        }

	        const tmpDir = os.tmpdir();
	        const safeExt = String(ext || 'webm').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
	        const filePath = path.join(
	            tmpDir,
	            `angel-audio-${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`
	        );

	        // Prefer streaming Blob->file
	        try {
	            if (blob && typeof blob.stream === 'function' && Readable && typeof Readable.fromWeb === 'function') {
	                const nodeReadable = Readable.fromWeb(blob.stream());
	                await pipeline(nodeReadable, fs.createWriteStream(filePath));
	                return filePath;
	            }
	        } catch (e) {
	            console.warn('[AUDIO_TRANSCRIPTION] Streaming blob->file failed; falling back to arrayBuffer write:', e?.message);
	        }

	        // Fallback: buffer whole blob (may be large)
	        const buf = Buffer.from(await blob.arrayBuffer());
	        await fs.promises.writeFile(filePath, buf);
	        return filePath;
	    }

	    /**
	     * Start local Web Audio pipeline to feed PCM chunks to OpenAI Realtime via IPC.
	     */
	    startRealtimeAudioPipeline(stream) {
	        try {
	            if (!this.realtime.enabled) {
	                return;
	            }
	            const AudioCtx = window.AudioContext || window.webkitAudioContext;
	            if (!AudioCtx) {
	                console.warn('[AUDIO_TRANSCRIPTION] Web Audio API not available, cannot start realtime pipeline');
	                this.realtime.enabled = false;
	                return;
	            }

	            this.realtime.audioContext = new AudioCtx();
	            this.realtime.sourceNode = this.realtime.audioContext.createMediaStreamSource(stream);

	            // 4096 samples is a good compromise between latency and overhead
	            this.realtime.processorNode = this.realtime.audioContext.createScriptProcessor(4096, 1, 1);

	            this.realtime.processorNode.onaudioprocess = (event) => {
	                if (!this.isRecording || !this.realtime.enabled || this.realtime.error) {
	                    return;
	                }
	                try {
	                    const inputBuffer = event.inputBuffer;
	                    const channelData = inputBuffer.getChannelData(0);
	                    const pcm16 = this.convertFloat32ToInt16(channelData);
	                    if (typeof ipcRenderer !== 'undefined' && pcm16 && pcm16.length) {
	                        const uint8 = new Uint8Array(pcm16.buffer);
	                        ipcRenderer.send('openai-realtime-audio-chunk', uint8);
	                    }
	                } catch (e) {
	                    console.warn('[AUDIO_TRANSCRIPTION] Realtime audio processing failed:', e);
	                    this.realtime.error = e;
	                }
	            };

	            this.realtime.sourceNode.connect(this.realtime.processorNode);
	            this.realtime.processorNode.connect(this.realtime.audioContext.destination);
	            this.realtime.active = true;

	            console.log('[AUDIO_TRANSCRIPTION] Realtime audio pipeline started');
	        } catch (error) {
	            console.warn('[AUDIO_TRANSCRIPTION] Failed to start realtime audio pipeline:', error);
	            this.realtime.error = error;
	            this.realtime.active = false;
	        }
	    }

	    /**
	     * Convert floating-point PCM (-1..1) to 16‑bit signed integers.
	     */
	    convertFloat32ToInt16(float32Array) {
	        const len = float32Array.length;
	        const result = new Int16Array(len);
	        for (let i = 0; i < len; i++) {
	            let s = float32Array[i];
	            if (s < 0) {
	                s = s * 0x8000;
	            } else {
	                s = s * 0x7FFF;
	            }
	            result[i] = s;
	        }
	        return result;
	    }

	    /**
	     * Stop the local realtime audio pipeline.
	     */
	    stopRealtimeAudioPipeline() {
	        if (!this.realtime) return;
	        try {
	            if (this.realtime.processorNode) {
	                this.realtime.processorNode.disconnect();
	            }
	        } catch (e) {
	            console.warn('[AUDIO_TRANSCRIPTION] Error disconnecting realtime processor node:', e);
	        }
	        try {
	            if (this.realtime.sourceNode) {
	                this.realtime.sourceNode.disconnect();
	            }
	        } catch (e) {
	            console.warn('[AUDIO_TRANSCRIPTION] Error disconnecting realtime source node:', e);
	        }
	        if (this.realtime.audioContext) {
	            try {
	                this.realtime.audioContext.close();
	            } catch (e) {
	                console.warn('[AUDIO_TRANSCRIPTION] Error closing realtime audio context:', e);
	            }
	        }
	        this.realtime.audioContext = null;
	        this.realtime.sourceNode = null;
	        this.realtime.processorNode = null;
	        this.realtime.active = false;
	        this.realtime.error = null;
	    }

    /**
     * Monitor audio quality in real-time
     */
    monitorAudioQuality(level, rms, mode) {
        this.qualityMonitor.audioLevels.push(level);
        
        // Keep only last 100 readings
        if (this.qualityMonitor.audioLevels.length > 100) {
            this.qualityMonitor.audioLevels.shift();
        }
        
        // Calculate average level
        this.qualityMonitor.averageLevel = this.qualityMonitor.audioLevels.reduce((a, b) => a + b, 0) / this.qualityMonitor.audioLevels.length;
        
        // Detect silence (levels consistently below threshold)
        const recentLevels = this.qualityMonitor.audioLevels.slice(-10);
        this.qualityMonitor.silenceDetected = recentLevels.every(level => level < 5);
        
        // Log quality issues
        if (this.qualityMonitor.silenceDetected && this.isRecording) {
            console.warn('[AUDIO_TRANSCRIPTION] Silence detected - check audio input');
        }
    }

    /**
     * Calculate overall audio quality score
     */
    calculateAudioQuality() {
        if (this.qualityMonitor.audioLevels.length === 0) {
            return 0.5; // Unknown quality
        }
        
        const avgLevel = this.qualityMonitor.averageLevel;
        const hasVariation = Math.max(...this.qualityMonitor.audioLevels) - Math.min(...this.qualityMonitor.audioLevels) > 10;
        
        let quality = 0;
        
        // Good if average level is between 10-80%
        if (avgLevel >= 10 && avgLevel <= 80) {
            quality += 0.4;
        }
        
        // Good if there's audio variation (not flat)
        if (hasVariation) {
            quality += 0.3;
        }
        
        // Good if not mostly silence
        if (!this.qualityMonitor.silenceDetected) {
            quality += 0.3;
        }
        
        return Math.min(1, Math.max(0, quality));
    }

    /**
     * Get best available MIME type for recording
     */
    getBestMimeType() {
        const preferredTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/ogg;codecs=opus'
        ];
        
        for (const type of preferredTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        
        return 'audio/webm'; // Fallback
    }

    /**
     * Get API keys using plan-based logic from main process
     */
    async getAPIKeys() {
        try {
            // Use IPC to get keys with proper plan-based logic
            if (typeof ipcRenderer !== 'undefined') {
                const apiKeys = await ipcRenderer.invoke('get-api-keys');
                
                // Check if this is a lifetime plan without keys
                if (apiKeys.isLifetimePlan && (!apiKeys.openai && !apiKeys.gemini)) {
                    throw new Error('Lifetime plan requires your own API keys. Please set them in Settings → API Keys');
                }
                
                return {
                    userOpenAIKey: apiKeys.openai || '',
                    userGeminiKey: apiKeys.gemini || ''
                };
            } else {
                // Fallback to localStorage for development/testing
                console.warn('[AUDIO_TRANSCRIPTION] IPC not available, using localStorage fallback');
                return {
                    userOpenAIKey: localStorage.getItem('openaiApiKey') || '',
                    userGeminiKey: localStorage.getItem('geminiApiKey') || ''
                };
            }
        } catch (error) {
            console.warn('[AUDIO_TRANSCRIPTION] Could not get API keys:', error);
            return {
                userOpenAIKey: '',
                userGeminiKey: ''
            };
        }
    }

    /**
     * Handle audio system errors
     */
    handleAudioError(error) {
        console.error('[AUDIO_TRANSCRIPTION] Audio system error:', error);
        
        if (this.isRecording) {
            this.stopRecording('Audio error occurred');
        }
        
        if (this.callbacks.onError) {
            this.callbacks.onError(error);
        }
    }

    /**
     * Clean up resources
     */
    cleanup() {
	        // Always tear down realtime pipeline first
	        this.stopRealtimeAudioPipeline();

	        // Always tear down System Default mixer (if any)
	        this.cleanupDefaultMix({ stopStreams: true });

	        if (this.progressIntervalId) {
	            try { clearInterval(this.progressIntervalId); } catch (_) { /* ignore */ }
	            this.progressIntervalId = null;
	        }

        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => {
                try { track.stop(); } catch (e) { /* ignore */ }
            });
            this.currentStream = null;
        }

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            try {
                this.mediaRecorder.stop();
            } catch (e) {
                console.warn('[AUDIO_TRANSCRIPTION] Error stopping MediaRecorder:', e);
            }
        }

        // Also clean up the underlying audio service (AudioContext, monitoring, etc.)
        if (this.audioManager) {
            try {
                this.audioManager.stopCapture();
            } catch (e) {
                console.warn('[AUDIO_TRANSCRIPTION] Error stopping audio manager capture:', e);
            }
        }

        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
	        this.isStopping = false;
    }

	/**
	 * Capture System Default stream.
	 * On Windows: capture system loopback + mic simultaneously and mix into one audio track.
	 * Elsewhere: fall back to microphone capture.
	 */
	async captureDefaultStream(options = {}) {
	    const platform = (typeof process !== 'undefined' && process.platform) ? process.platform : 'unknown';

	    // Only Windows gets the mixed system+mic behavior for now.
	    if (platform !== 'win32') {
	        const mic = await this.audioManager.captureMicrophoneAudio(options.deviceId);
	        return { lifetimeStream: mic, recordSourceStream: mic };
	    }

	    let systemStream = null;
	    let micStream = null;

	    // 1) Try system loopback first (best for speaker audio)
	    try {
	        systemStream = await this.audioManager.captureSystemAudio();
	    } catch (e) {
	        console.warn('[AUDIO_TRANSCRIPTION] System Default: system audio capture failed, will fall back:', e?.message || e);
	    }

	    // 2) Capture microphone directly (do NOT call audioManager.captureMicrophoneAudio here,
	    // because WindowsAudioService uses a single currentStream and would stop the system stream).
	    try {
	        micStream = await navigator.mediaDevices.getUserMedia({
	            audio: {
	                echoCancellation: true,
	                noiseSuppression: true,
	                autoGainControl: true,
	                sampleRate: 44100,
	                channelCount: 1
	            }
	        });
	    } catch (e) {
	        console.warn('[AUDIO_TRANSCRIPTION] System Default: microphone capture failed, will fall back:', e?.message || e);
	    }

	    if (!systemStream && !micStream) {
	        throw new Error('System Default failed: could not capture system audio or microphone');
	    }
	    if (systemStream && !micStream) {
	        return { lifetimeStream: systemStream, recordSourceStream: systemStream };
	    }
	    if (!systemStream && micStream) {
	        return { lifetimeStream: micStream, recordSourceStream: micStream };
	    }

	    // 3) Mix both into a single MediaStream for recording
	    const mixed = await this.mixSystemAndMicStreams(systemStream, micStream);
	    const lifetime = new MediaStream([
	        ...systemStream.getTracks(),
	        ...micStream.getTracks(),
	        ...mixed.getTracks()
	    ]);

	    return { lifetimeStream: lifetime, recordSourceStream: mixed };
	}

	/**
	 * Mix system and mic streams into a single audio track via WebAudio.
	 */
	async mixSystemAndMicStreams(systemStream, micStream) {
	    const AudioCtx = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
	    if (!AudioCtx) throw new Error('AudioContext not available for mixing');

	    // Tear down any existing mixer first
	    this.cleanupDefaultMix({ stopStreams: false });

	    const audioContext = new AudioCtx({ sampleRate: 48000 });
	    const destination = audioContext.createMediaStreamDestination();

	    const sysSource = audioContext.createMediaStreamSource(systemStream);
	    const micSource = audioContext.createMediaStreamSource(micStream);

	    // Optional gain nodes for future tuning (keep 1.0 for now)
	    const sysGain = audioContext.createGain();
	    const micGain = audioContext.createGain();
	    sysGain.gain.value = 1.0;
	    micGain.gain.value = 1.0;

	    sysSource.connect(sysGain).connect(destination);
	    micSource.connect(micGain).connect(destination);

	    try {
	        if (audioContext.state === 'suspended') {
	            await audioContext.resume();
	        }
	    } catch (_) {
	        // Ignore resume errors; recording may still work.
	    }

	    const mixedStream = destination.stream;
	    if (!mixedStream || mixedStream.getAudioTracks().length === 0) {
	        try { await audioContext.close(); } catch (_) {}
	        throw new Error('Failed to create mixed audio stream');
	    }

	    this.defaultMix.active = true;
	    this.defaultMix.systemStream = systemStream;
	    this.defaultMix.micStream = micStream;
	    this.defaultMix.mixedStream = mixedStream;
	    this.defaultMix.audioContext = audioContext;

	    console.log('[AUDIO_TRANSCRIPTION] System Default: mixing system+mic into one stream');
	    return mixedStream;
	}

	/**
	 * Clean up mixer state used for System Default.
	 */
	cleanupDefaultMix({ stopStreams = false } = {}) {
	    const dm = this.defaultMix;
	    if (!dm) return;

	    if (stopStreams) {
	        const toStop = [dm.mixedStream, dm.micStream, dm.systemStream];
	        for (const s of toStop) {
	            try {
	                if (s && s.getTracks) {
	                    s.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
	                }
	            } catch (_) {}
	        }
	    }

	    if (dm.audioContext && dm.audioContext.state !== 'closed') {
	        try { dm.audioContext.close(); } catch (_) {}
	    }

	    dm.active = false;
	    dm.systemStream = null;
	    dm.micStream = null;
	    dm.mixedStream = null;
	    dm.audioContext = null;
	}

    /**
     * Set event callbacks
     */
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Get coordinator status and metrics
     */
    getStatus() {
        return {
            isRecording: this.isRecording,
            recordingDuration: this.isRecording ? Date.now() - this.recordingStartTime : 0,
            audioQuality: this.calculateAudioQuality(),
            audioLevels: this.qualityMonitor.audioLevels.slice(-10), // Last 10 readings
            silenceDetected: this.qualityMonitor.silenceDetected,
            transcriptionMetrics: this.transcriptionService.getMetrics()
        };
    }

    /**
     * Update settings
     */
    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        console.log('[AUDIO_TRANSCRIPTION] Settings updated:', this.settings);
    }
}

// Export for both ES6 and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioTranscriptionCoordinator;
} else {
    window.AudioTranscriptionCoordinator = AudioTranscriptionCoordinator;
}
