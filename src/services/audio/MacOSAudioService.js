/**
 * macOS Audio Service - Optimized system audio capture for macOS
 * Handles macOS-specific audio capture with seamless system audio support
 */

class MacOSAudioService extends BaseAudioService {
    constructor() {
        super();
        this.systemAudioStream = null;
        this.hasSystemAudioPermission = false;
    }

    /**
     * Capture system audio using macOS-optimized methods
     */
    async captureSystemAudio() {
        console.log('[MACOS_AUDIO] Starting system audio capture...');
        
        try {
            // macOS has excellent system audio support via getDisplayMedia
            const stream = await this.captureViaDisplayMedia();
            return this.finalizeSystemAudioStream(stream, 'displayMedia');
            
        } catch (error) {
            console.error('[MACOS_AUDIO] Primary method failed, trying fallback:', error);
            
            // Fallback: Try with screen sharing
            try {
                const stream = await this.captureViaScreenShare();
                return this.finalizeSystemAudioStream(stream, 'screenShare');
            } catch (fallbackError) {
                throw new Error(`macOS system audio capture failed: ${fallbackError.message}. Please allow screen recording in System Preferences > Security & Privacy > Screen Recording.`);
            }
        }
    }

    /**
     * Primary method: Display media with audio (seamless on macOS)
     */
    async captureViaDisplayMedia() {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: false,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000,
                channelCount: 2,
                // macOS-specific optimizations
                suppressLocalAudioPlayback: false
            }
        });
        
        if (!stream || stream.getAudioTracks().length === 0) {
            throw new Error('No system audio tracks available');
        }

        BaseAudioService._trackStream(stream, 'macos-display-media');
        console.log('[MACOS_AUDIO] Display media audio capture successful');
        return stream;
    }

    /**
     * Fallback method: Screen capture with audio
     */
    async captureViaScreenShare() {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { 
                displaySurface: 'monitor',
                width: { min: 1, ideal: 1, max: 1 },  // Minimal video for performance
                height: { min: 1, ideal: 1, max: 1 }
            },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000,
                channelCount: 2
            }
        });
        
        if (!stream || stream.getAudioTracks().length === 0) {
            throw new Error('No audio tracks in screen capture');
        }
        
        // Stop video tracks to save resources, keep only audio
        stream.getVideoTracks().forEach(track => track.stop());
        const audioOnlyStream = new MediaStream(stream.getAudioTracks());

        BaseAudioService._trackStream(audioOnlyStream, 'macos-screen-share');
        console.log('[MACOS_AUDIO] Screen capture audio successful');
        return audioOnlyStream;
    }

    /**
     * Capture microphone audio (external voice)
     */
    async captureMicrophoneAudio(deviceId = null) {
        console.log('[MACOS_AUDIO] Capturing microphone audio...');
        
        try {
            // Find best microphone device if none specified
            if (!deviceId) {
                const devices = await this.getAudioDevices();
                const microphones = devices.filter(device => device.type === 'microphone');
                
                if (microphones.length > 0) {
                    // Prefer built-in microphone or first available
                    const builtInMic = microphones.find(mic => 
                        mic.label.toLowerCase().includes('built-in') ||
                        mic.label.toLowerCase().includes('internal')
                    );
                    deviceId = builtInMic ? builtInMic.id : microphones[0].id;
                    console.log('[MACOS_AUDIO] Auto-selected microphone:', deviceId);
                }
            }
            
            const constraints = this.getAudioConstraints('speech', deviceId);
            
            // macOS-specific optimizations for voice
            constraints.audio.sampleRate = 44100;  // Optimal for speech on macOS
            constraints.audio.latency = 0.01;      // Low latency for real-time
            
            console.log('[MACOS_AUDIO] Microphone constraints:', constraints);
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            BaseAudioService._trackStream(stream, 'macos-microphone');

            this.currentStream = stream;
            this.isCapturing = true;
            this.setupAudioMonitoring(stream);
            
            if (this.callbacks.onStreamStart) {
                this.callbacks.onStreamStart(stream, 'microphone');
            }
            
            console.log('[MACOS_AUDIO] Microphone capture successful');
            return stream;
            
        } catch (error) {
            console.error('[MACOS_AUDIO] Microphone capture failed:', error);
            
            if (error.name === 'NotAllowedError') {
                throw new Error('Microphone permission denied. Please allow microphone access in System Preferences > Security & Privacy > Microphone.');
            }
            
            throw new Error(`Microphone capture failed: ${error.message}`);
        }
    }

    /**
     * Check macOS system permissions
     */
    async checkSystemPermissions() {
        const permissions = {
            microphone: false,
            screenRecording: false,
            systemAudio: false
        };
        
        // Test microphone permission. Release the probe stream in a
        // `finally` block so the OS mic indicator is not left lit if any
        // intermediate statement throws.
        let micProbe = null;
        try {
            micProbe = await navigator.mediaDevices.getUserMedia({ audio: true });
            BaseAudioService._trackStream(micProbe, 'macos-permission-mic-probe');
            permissions.microphone = true;
        } catch (e) {
            console.log('[MACOS_AUDIO] Microphone permission not granted');
        } finally {
            if (micProbe) {
                try {
                    micProbe.getTracks().forEach(track => {
                        try { track.stop(); } catch (_) {}
                    });
                } catch (_) {}
            }
        }

        // Test screen recording permission (needed for system audio). Same
        // finally-guard pattern: the loopback indicator must release before
        // we return, even on the success path.
        let displayProbe = null;
        try {
            displayProbe = await navigator.mediaDevices.getDisplayMedia({
                video: false,
                audio: true
            });
            BaseAudioService._trackStream(displayProbe, 'macos-permission-display-probe');
            permissions.screenRecording = true;
            permissions.systemAudio = displayProbe.getAudioTracks().length > 0;
        } catch (e) {
            console.log('[MACOS_AUDIO] Screen recording permission not granted');
        } finally {
            if (displayProbe) {
                try {
                    displayProbe.getTracks().forEach(track => {
                        try { track.stop(); } catch (_) {}
                    });
                } catch (_) {}
            }
        }
        
        console.log('[MACOS_AUDIO] System permissions:', permissions);
        this.hasSystemAudioPermission = permissions.systemAudio;
        return permissions;
    }

    /**
     * Finalize system audio stream setup
     */
    finalizeSystemAudioStream(stream, method) {
        this.currentStream = stream;
        this.systemAudioStream = stream;
        this.isCapturing = true;
        
        // Setup monitoring optimized for system audio
        this.setupAudioMonitoring(stream);
        
        // Log stream details
        const audioTracks = stream.getAudioTracks();
        audioTracks.forEach((track, i) => {
            console.log(`[MACOS_AUDIO] Track ${i}:`, {
                label: track.label,
                settings: track.getSettings(),
                enabled: track.enabled,
                muted: track.muted,
                contentHint: track.contentHint
            });
        });
        
        if (this.callbacks.onStreamStart) {
            this.callbacks.onStreamStart(stream, 'system_audio', method);
        }
        
        return stream;
    }

    /**
     * Get macOS-specific audio device recommendations
     */
    async getRecommendedDevices() {
        const devices = await this.getAudioDevices();
        
        const recommendations = {
            systemAudio: ['Display Audio'], // macOS uses display audio for system capture
            microphones: devices.filter(device => device.type === 'microphone'),
            builtIn: devices.filter(device => 
                device.label.toLowerCase().includes('built-in') ||
                device.label.toLowerCase().includes('internal')
            ),
            external: devices.filter(device => 
                device.type === 'microphone' && 
                !device.label.toLowerCase().includes('built-in') &&
                !device.label.toLowerCase().includes('internal')
            )
        };
        
        console.log('[MACOS_AUDIO] Device recommendations:', recommendations);
        return recommendations;
    }

    /**
     * Optimize audio settings for macOS
     */
    getOptimizedConstraints(purpose = 'speech', deviceId = null) {
        const constraints = this.getAudioConstraints(purpose, deviceId);
        
        // macOS-specific optimizations
        if (purpose === 'speech') {
            constraints.audio.sampleRate = 44100;
            constraints.audio.latency = 0.01;
            constraints.audio.channelCount = 1;
        } else if (purpose === 'system_audio') {
            constraints.audio.sampleRate = 48000;
            constraints.audio.latency = 0.02;
            constraints.audio.channelCount = 2;
            constraints.audio.echoCancellation = false;
            constraints.audio.noiseSuppression = false;
            constraints.audio.autoGainControl = false;
        }
        
        return constraints;
    }

    /**
     * Handle macOS-specific permission prompts
     */
    async requestSystemAudioPermission() {
        let testStream = null;
        try {
            console.log('[MACOS_AUDIO] Requesting system audio permission...');

            // This will trigger the macOS permission prompt. Stream is a
            // permission probe only — released unconditionally in `finally`
            // so the loopback indicator does not stay lit.
            testStream = await navigator.mediaDevices.getDisplayMedia({
                video: false,
                audio: true
            });
            BaseAudioService._trackStream(testStream, 'macos-permission-request-probe');

            const hasAudio = testStream.getAudioTracks().length > 0;
            if (hasAudio) {
                this.hasSystemAudioPermission = true;
                console.log('[MACOS_AUDIO] System audio permission granted');
                return true;
            } else {
                throw new Error('No audio tracks available');
            }

        } catch (error) {
            console.error('[MACOS_AUDIO] System audio permission denied:', error);
            return false;
        } finally {
            if (testStream) {
                try {
                    testStream.getTracks().forEach(track => {
                        try { track.stop(); } catch (_) {}
                    });
                } catch (_) {}
            }
        }
    }
}

// Export for both ES6 and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MacOSAudioService;
} else {
    window.MacOSAudioService = MacOSAudioService;
}
