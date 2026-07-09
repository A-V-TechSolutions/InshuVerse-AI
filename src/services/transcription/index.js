/**
 * Transcription System Entry Point - Production-quality voice pipeline
 * Simple API for meeting/interview transcription with zero audio loss
 */

// Global transcription coordinator
let transcriptionCoordinator = null;

/**
 * Initialize the transcription system
 */
async function initTranscriptionSystem(audioManager) {
    try {
        console.log('[TRANSCRIPTION_SYSTEM] Initializing production transcription system...');
        
        // Create coordinator
        transcriptionCoordinator = new AudioTranscriptionCoordinator();
        
        // Initialize with audio manager
        const success = await transcriptionCoordinator.initialize(audioManager);
        if (!success) {
            throw new Error('Failed to initialize transcription coordinator');
        }
        
        console.log('[TRANSCRIPTION_SYSTEM] Production transcription system ready!');
        return transcriptionCoordinator;
        
    } catch (error) {
        console.error('[TRANSCRIPTION_SYSTEM] Failed to initialize:', error);
        throw error;
    }
}

/**
 * Start recording for transcription
 * @param {string} audioSource - 'system' for system audio, 'microphone' for mic, 'default' for system+mic (Windows)
 * @param {Object} options - Recording options
 */
async function startTranscriptionRecording(audioSource = 'system', options = {}) {
    if (!transcriptionCoordinator) {
        throw new Error('Transcription system not initialized');
    }
    
    return await transcriptionCoordinator.startRecording(audioSource, options);
}

/**
 * Stop recording and get transcription
 */
async function stopTranscriptionRecording(reason = 'User requested') {
    if (!transcriptionCoordinator) {
        throw new Error('Transcription system not initialized');
    }
    
    return await transcriptionCoordinator.stopRecording(reason);
}

/**
 * Set transcription event callbacks
 * @param {Object} callbacks - Event callbacks
 * @param {Function} callbacks.onTranscriptionResult - (result) => {} - Transcription completed
 * @param {Function} callbacks.onRecordingStart - (audioSource, stream) => {} - Recording started
 * @param {Function} callbacks.onRecordingStop - (result, reason) => {} - Recording stopped
 * @param {Function} callbacks.onError - (error) => {} - Error occurred
 * @param {Function} callbacks.onProgress - (progress) => {} - Recording progress
 */
function setTranscriptionCallbacks(callbacks) {
    if (transcriptionCoordinator) {
        transcriptionCoordinator.setCallbacks(callbacks);
    }
}

/**
 * Get transcription system status
 */
function getTranscriptionStatus() {
    if (transcriptionCoordinator) {
        return transcriptionCoordinator.getStatus();
    }
    return null;
}

/**
 * Update transcription settings
 */
function updateTranscriptionSettings(settings) {
    if (transcriptionCoordinator) {
        transcriptionCoordinator.updateSettings(settings);
    }
}

/**
 * Check if currently recording
 */
function isTranscriptionRecording() {
    if (transcriptionCoordinator) {
        return transcriptionCoordinator.isRecording;
    }
    return false;
}

/**
 * Legacy compatibility: Process pre-recorded audio
 * @param {ArrayBuffer|string} audioData - Audio data (buffer or base64)
 * @param {Object} options - Processing options
 */
async function processAudioData(audioData, options = {}) {
    try {
        console.log('[TRANSCRIPTION_SYSTEM] Processing pre-recorded audio...');

        // Prefer binary payloads for IPC to avoid base64 expansion/truncation on large recordings.
        // Keep backward compatibility with legacy base64 strings.
        let base64Audio = null;
        let audioBytes = null;
        if (typeof audioData === 'string') {
            base64Audio = audioData;
        } else if (audioData instanceof ArrayBuffer) {
            audioBytes = new Uint8Array(audioData);
        } else if (ArrayBuffer.isView(audioData)) {
            audioBytes = new Uint8Array(audioData.buffer, audioData.byteOffset, audioData.byteLength);
        } else {
            throw new Error('Unsupported audioData type');
        }

        // Prefer secure main-process transcription (no keys in renderer)
        if (typeof ipcRenderer !== 'undefined') {
            try {
                const payload = audioBytes || base64Audio;
                const text = await ipcRenderer.invoke('transcribe-audio-buffer', payload);
                return { success: true, text, provider: null };
            } catch (err) {
                console.warn('[TRANSCRIPTION_SYSTEM] Main transcription failed, falling back in renderer:', err?.message);
            }
        }

        // Fallback: use renderer-side service ONLY if explicit keys are provided via options/localStorage
        const userOpenAIKey = options.userOpenAIKey || localStorage.getItem('openaiApiKey') || '';
        const userGeminiKey = options.userGeminiKey || localStorage.getItem('geminiApiKey') || '';
        const transcriptionService = new TranscriptionService();

        // Ensure we pass raw bytes to the renderer transcription service
        if (!audioBytes) {
            audioBytes = Uint8Array.from(atob(base64Audio || ''), c => c.charCodeAt(0));
        }
        const result = await transcriptionService.transcribe(
            audioBytes,
            { userOpenAIKey, userGeminiKey }
        );
        console.log('[TRANSCRIPTION_SYSTEM] Pre-recorded audio processed successfully (renderer fallback)');
        return result;

    } catch (error) {
        console.error('[TRANSCRIPTION_SYSTEM] Failed to process audio data:', error);
        throw error;
    }
}

/**
 * Get transcription quality metrics
 */
function getTranscriptionMetrics() {
    if (transcriptionCoordinator) {
        return transcriptionCoordinator.getStatus().transcriptionMetrics;
    }
    return null;
}

// Export the simple API
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initTranscriptionSystem,
        startTranscriptionRecording,
        stopTranscriptionRecording,
        setTranscriptionCallbacks,
        getTranscriptionStatus,
        updateTranscriptionSettings,
        isTranscriptionRecording,
        processAudioData,
        getTranscriptionMetrics
    };
} else {
    // Browser global functions
    window.initTranscriptionSystem = initTranscriptionSystem;
    window.startTranscriptionRecording = startTranscriptionRecording;
    window.stopTranscriptionRecording = stopTranscriptionRecording;
    window.setTranscriptionCallbacks = setTranscriptionCallbacks;
    window.getTranscriptionStatus = getTranscriptionStatus;
    window.updateTranscriptionSettings = updateTranscriptionSettings;
    window.isTranscriptionRecording = isTranscriptionRecording;
    window.processAudioData = processAudioData;
    window.getTranscriptionMetrics = getTranscriptionMetrics;
}
