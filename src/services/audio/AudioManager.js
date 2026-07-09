/**
 * Audio Manager - Main coordinator for cross-platform audio capture
 * Simple API for interview/meeting helper tool
 */

class AudioManager {
    constructor() {
        this.audioService = null;
        this.platform = this.detectPlatform();
        this.isInitialized = false;
        this.currentMode = null; // 'system_audio' or 'microphone'
        this.callbacks = {
            onLevelUpdate: null,
            onError: null,
            onStreamStart: null,
            onStreamEnd: null,
            onModeChange: null
        };
        
        console.log(`[AUDIO_MANAGER] Detected platform: ${this.platform}`);
    }

    /**
     * Initialize the audio manager with platform-specific service
     */
    async initialize() {
        try {
            console.log('[AUDIO_MANAGER] Initializing audio system...');
            
            // Load platform-specific service
            await this.loadPlatformService();
            
            // Initialize the service
            const success = await this.audioService.initialize();
            if (!success) {
                throw new Error('Failed to initialize audio service');
            }
            
            // Set up event forwarding
            this.audioService.setCallbacks({
                onLevelUpdate: (level, rms) => {
                    if (this.callbacks.onLevelUpdate) {
                        this.callbacks.onLevelUpdate(level, rms, this.currentMode);
                    }
                },
                onError: (error) => {
                    if (this.callbacks.onError) {
                        this.callbacks.onError(error);
                    }
                },
                onStreamStart: (stream, mode, method) => {
                    this.currentMode = mode;
                    if (this.callbacks.onStreamStart) {
                        this.callbacks.onStreamStart(stream, mode, method);
                    }
                    if (this.callbacks.onModeChange) {
                        this.callbacks.onModeChange(mode);
                    }
                },
                onStreamEnd: () => {
                    const prevMode = this.currentMode;
                    this.currentMode = null;
                    if (this.callbacks.onStreamEnd) {
                        this.callbacks.onStreamEnd(prevMode);
                    }
                    if (this.callbacks.onModeChange) {
                        this.callbacks.onModeChange(null);
                    }
                }
            });
            
            this.isInitialized = true;
            console.log('[AUDIO_MANAGER] Audio system initialized successfully');
            return true;
            
        } catch (error) {
            console.error('[AUDIO_MANAGER] Failed to initialize:', error);
            return false;
        }
    }

    /**
     * Capture system audio (for listening to meetings/interviews)
     */
    async captureSystemAudio() {
        this.ensureInitialized();
        
        try {
            console.log('[AUDIO_MANAGER] Starting system audio capture...');
            const stream = await this.audioService.captureSystemAudio();
            console.log('[AUDIO_MANAGER] System audio capture successful');
            return stream;
        } catch (error) {
            console.error('[AUDIO_MANAGER] System audio capture failed:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            throw error;
        }
    }

    /**
     * Capture microphone audio (for user speaking)
     */
    async captureMicrophoneAudio(deviceId = null) {
        this.ensureInitialized();
        
        try {
            console.log('[AUDIO_MANAGER] Starting microphone capture...');
            const stream = await this.audioService.captureMicrophoneAudio(deviceId);
            console.log('[AUDIO_MANAGER] Microphone capture successful');
            return stream;
        } catch (error) {
            console.error('[AUDIO_MANAGER] Microphone capture failed:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            throw error;
        }
    }

    /**
     * Stop current audio capture
     */
    stopCapture() {
        if (this.audioService) {
            this.audioService.stopCapture();
        }
        console.log('[AUDIO_MANAGER] Audio capture stopped');
    }

    /**
     * Get available audio devices with platform-specific recommendations
     */
    async getAudioDevices() {
        this.ensureInitialized();
        
        try {
            const devices = await this.audioService.getAudioDevices();
            
            // Get platform-specific recommendations
            let recommendations = {};
            if (this.audioService.getRecommendedDevices) {
                recommendations = await this.audioService.getRecommendedDevices();
            }
            
            return {
                devices,
                recommendations,
                platform: this.platform
            };
        } catch (error) {
            console.error('[AUDIO_MANAGER] Failed to get audio devices:', error);
            return { devices: [], recommendations: {}, platform: this.platform };
        }
    }

    /**
     * Test system audio capabilities
     */
    async testSystemAudioCapabilities() {
        this.ensureInitialized();
        
        try {
            if (this.audioService.testSystemAudioCapabilities) {
                return await this.audioService.testSystemAudioCapabilities();
            }
            
            // Basic test fallback
            return await this.basicSystemAudioTest();
        } catch (error) {
            console.error('[AUDIO_MANAGER] System audio test failed:', error);
            return { supported: false, error: error.message };
        }
    }

    /**
     * Check system permissions (especially important for macOS)
     */
    async checkPermissions() {
        this.ensureInitialized();
        
        try {
            if (this.audioService.checkSystemPermissions) {
                return await this.audioService.checkSystemPermissions();
            }
            
            // Basic permission check fallback
            return await this.basicPermissionCheck();
        } catch (error) {
            console.error('[AUDIO_MANAGER] Permission check failed:', error);
            return { microphone: false, screenRecording: false, systemAudio: false };
        }
    }

    /**
     * Set event callbacks
     */
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Get current capture mode
     */
    getCurrentMode() {
        return this.currentMode;
    }

    /**
     * Get platform information
     */
    getPlatform() {
        return this.platform;
    }

    /**
     * Check if audio system is ready
     */
    isReady() {
        return this.isInitialized && this.audioService !== null;
    }

    // --- Private Methods ---

    /**
     * Detect the current platform
     */
    detectPlatform() {
        try {
            if (typeof process !== 'undefined' && process.platform) {
                return process.platform;
            }
        } catch (e) {
            // Fallback to user agent detection
        }
        
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes('mac')) return 'darwin';
        if (userAgent.includes('win')) return 'win32';
        if (userAgent.includes('linux')) return 'linux';
        return 'unknown';
    }

    /**
     * Load platform-specific audio service
     */
    async loadPlatformService() {
        switch (this.platform) {
            case 'darwin':
                this.audioService = new MacOSAudioService();
                break;
            case 'win32':
                this.audioService = new WindowsAudioService();
                break;
            default:
                // Default to Windows service for unknown platforms
                this.audioService = new WindowsAudioService();
                break;
        }
        
        console.log(`[AUDIO_MANAGER] Loaded ${this.audioService.constructor.name}`);
    }

    /**
     * Ensure the audio manager is initialized
     */
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new Error('Audio manager not initialized. Call initialize() first.');
        }
    }

    /**
     * Basic system audio test for platforms without specific implementation
     */
    async basicSystemAudioTest() {
        let testStream = null;
        try {
            testStream = await navigator.mediaDevices.getDisplayMedia({
                video: false,
                audio: true
            });
            try { BaseAudioService._trackStream(testStream, 'manager-system-audio-test'); } catch (_) {}

            const hasAudio = testStream.getAudioTracks().length > 0;
            return {
                supported: hasAudio,
                method: 'getDisplayMedia',
                platform: this.platform
            };
        } catch (error) {
            return {
                supported: false,
                error: error.message,
                platform: this.platform
            };
        } finally {
            // Always release the probe stream — leaving it open keeps the
            // OS audio / screen-share indicator lit even though the test
            // has completed.
            if (testStream) {
                try {
                    testStream.getTracks().forEach(track => {
                        try { track.stop(); } catch (_) {}
                    });
                } catch (_) {}
            }
        }
    }

    /**
     * Basic permission check for platforms without specific implementation
     */
    async basicPermissionCheck() {
        const permissions = {
            microphone: false,
            screenRecording: false,
            systemAudio: false
        };

        // Test microphone — release in finally to guarantee the OS mic
        // indicator clears regardless of where execution exits.
        let micStream = null;
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            try { BaseAudioService._trackStream(micStream, 'manager-permission-mic-probe'); } catch (_) {}
            permissions.microphone = true;
        } catch (e) {
            console.log('[AUDIO_MANAGER] Microphone permission check failed');
        } finally {
            if (micStream) {
                try {
                    micStream.getTracks().forEach(track => {
                        try { track.stop(); } catch (_) {}
                    });
                } catch (_) {}
            }
        }

        // Test screen recording / system audio — same finally-guard pattern.
        let displayStream = null;
        try {
            displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: false,
                audio: true
            });
            try { BaseAudioService._trackStream(displayStream, 'manager-permission-display-probe'); } catch (_) {}
            permissions.screenRecording = true;
            permissions.systemAudio = displayStream.getAudioTracks().length > 0;
        } catch (e) {
            console.log('[AUDIO_MANAGER] Screen recording permission check failed');
        } finally {
            if (displayStream) {
                try {
                    displayStream.getTracks().forEach(track => {
                        try { track.stop(); } catch (_) {}
                    });
                } catch (_) {}
            }
        }

        return permissions;
    }
}

// Export for both ES6 and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioManager;
} else {
    window.AudioManager = AudioManager;
}
