/**
 * Audio System Entry Point - Production-quality audio for interview helper
 * Simple API: just call initAudioSystem() and use captureSystemAudio() or captureMicrophoneAudio()
 */

// Load all audio services
async function loadAudioServices() {
    // Services are already loaded via script tags in HTML
    // This function exists for future dynamic loading if needed
    return true;
}

/**
 * Initialize the complete audio system
 */
async function initAudioSystem() {
    try {
        console.log('[AUDIO_SYSTEM] Initializing production audio system...');
        
        // Create the global audio manager
        window.audioManager = new AudioManager();
        
        // Initialize the manager
        const success = await window.audioManager.initialize();
        if (!success) {
            throw new Error('Failed to initialize audio manager');
        }
        
        console.log('[AUDIO_SYSTEM] Audio system ready!');
        return window.audioManager;
        
    } catch (error) {
        console.error('[AUDIO_SYSTEM] Failed to initialize audio system:', error);
        throw error;
    }
}

/**
 * Simple API: Capture system audio for listening to meetings
 */
async function captureSystemAudio() {
    if (!window.audioManager) {
        throw new Error('Audio system not initialized. Call initAudioSystem() first.');
    }
    
    return await window.audioManager.captureSystemAudio();
}

/**
 * Simple API: Capture microphone audio for user speaking  
 */
async function captureMicrophoneAudio(deviceId = null) {
    if (!window.audioManager) {
        throw new Error('Audio system not initialized. Call initAudioSystem() first.');
    }
    
    return await window.audioManager.captureMicrophoneAudio(deviceId);
}

/**
 * Stop any current audio capture
 */
function stopAudioCapture() {
    if (window.audioManager) {
        window.audioManager.stopCapture();
    }
}

/**
 * Get available audio devices with platform-specific recommendations
 */
async function getAudioDevices() {
    if (!window.audioManager) {
        throw new Error('Audio system not initialized. Call initAudioSystem() first.');
    }
    
    return await window.audioManager.getAudioDevices();
}

/**
 * Set audio event callbacks
 * 
 * @param {Object} callbacks - Event callbacks
 * @param {Function} callbacks.onLevelUpdate - (level, rms, mode) => {} - Audio level updates
 * @param {Function} callbacks.onError - (error) => {} - Error events
 * @param {Function} callbacks.onStreamStart - (stream, mode, method) => {} - Stream started
 * @param {Function} callbacks.onStreamEnd - (prevMode) => {} - Stream ended
 * @param {Function} callbacks.onModeChange - (mode) => {} - Mode changed (system_audio/microphone/null)
 */
function setAudioCallbacks(callbacks) {
    if (window.audioManager) {
        window.audioManager.setCallbacks(callbacks);
    }
}

/**
 * Get current capture mode
 */
function getCurrentAudioMode() {
    if (window.audioManager) {
        return window.audioManager.getCurrentMode();
    }
    return null;
}

/**
 * Check system audio capabilities
 */
async function testSystemAudioCapabilities() {
    if (!window.audioManager) {
        throw new Error('Audio system not initialized. Call initAudioSystem() first.');
    }
    
    return await window.audioManager.testSystemAudioCapabilities();
}

/**
 * Check system permissions
 */
async function checkAudioPermissions() {
    if (!window.audioManager) {
        throw new Error('Audio system not initialized. Call initAudioSystem() first.');
    }
    
    return await window.audioManager.checkPermissions();
}

/**
 * Get platform information
 */
function getAudioPlatform() {
    if (window.audioManager) {
        return window.audioManager.getPlatform();
    }
    return 'unknown';
}

/**
 * Check if audio system is ready
 */
function isAudioSystemReady() {
    return window.audioManager && window.audioManager.isReady();
}

// Export the simple API
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initAudioSystem,
        captureSystemAudio,
        captureMicrophoneAudio,
        stopAudioCapture,
        getAudioDevices,
        setAudioCallbacks,
        getCurrentAudioMode,
        testSystemAudioCapabilities,
        checkAudioPermissions,
        getAudioPlatform,
        isAudioSystemReady
    };
} else {
    // Browser global functions
    window.initAudioSystem = initAudioSystem;
    window.captureSystemAudio = captureSystemAudio;
    window.captureMicrophoneAudio = captureMicrophoneAudio;
    window.stopAudioCapture = stopAudioCapture;
    window.getAudioDevices = getAudioDevices;
    window.setAudioCallbacks = setAudioCallbacks;
    window.getCurrentAudioMode = getCurrentAudioMode;
    window.testSystemAudioCapabilities = testSystemAudioCapabilities;
    window.checkAudioPermissions = checkAudioPermissions;
    window.getAudioPlatform = getAudioPlatform;
    window.isAudioSystemReady = isAudioSystemReady;
}
