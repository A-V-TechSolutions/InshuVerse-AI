/**
 * Windows Audio Service - Optimized system audio capture for Windows
 * Handles Windows-specific audio capture methods with fallbacks
 */

class WindowsAudioService extends BaseAudioService {
    constructor() {
        super();
        this.preferredMethods = [
            'getDisplayMedia',
            'screenCapture', 
            'stereoMix'
        ];
        this.systemAudioStream = null;
    }

    /**
     * Capture system audio using Windows-optimized methods
     */
    async captureSystemAudio() {
        console.log('[WINDOWS_AUDIO] Starting system audio capture...');

        // Clean up any previous system audio stream to prevent stale data
        if (this.systemAudioStream) {
            console.log('[WINDOWS_AUDIO] Stopping previous system audio stream');
            this.systemAudioStream.getTracks().forEach(track => {
                try { track.stop(); } catch (e) { /* ignore */ }
            });
            this.systemAudioStream = null;
        }
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => {
                try { track.stop(); } catch (e) { /* ignore */ }
            });
            this.currentStream = null;
        }
        // Close stale AudioContext from previous monitoring
        if (this.audioContext && this.audioContext.state !== 'closed') {
            try { this.audioContext.close(); } catch (e) { /* ignore */ }
            this.audioContext = null;
        }
        this.isCapturing = false;

        for (const method of this.preferredMethods) {
            try {
                console.log(`[WINDOWS_AUDIO] Trying method: ${method}`);
                
                let stream = null;
                switch (method) {
                    case 'getDisplayMedia':
                        stream = await this.captureViaDisplayMedia();
                        break;
                    case 'screenCapture':
                        stream = await this.captureViaScreenShare();
                        break;
                    case 'stereoMix':
                        stream = await this.captureViaStereoMix();
                        break;
                    case 'defaultDevice':
                        stream = await this.captureViaDefaultDevice();
                        break;
                }
                
                if (stream && stream.getAudioTracks().length > 0) {
                    console.log(`[WINDOWS_AUDIO] SUCCESS: ${method} captured system audio`);
                    return this.finalizeSystemAudioStream(stream, method);
                }
                
            } catch (error) {
                console.log(`[WINDOWS_AUDIO] Method ${method} failed:`, error.message);
                continue;
            }
        }
        
        throw new Error('All Windows system audio capture methods failed. Try: 1) Enable Stereo Mix in Sound Settings, 2) Allow screen sharing, or 3) Install VB-Cable virtual audio.');
    }

    /**
     * Method 1: Direct display media audio capture via Electron's loopback (BEST quality)
     * The main process handler auto-grants with audio: 'loopback' for clean digital system audio.
	     * We request minimal video (required by Chromium). IMPORTANT: do NOT stop the video track
	     * immediately on Windows, because some loopback capture sessions will end early (cropped audio)
	     * if the associated video track is stopped.
     */
    async captureViaDisplayMedia() {
        console.log('[WINDOWS_AUDIO] captureViaDisplayMedia: requesting with loopback audio...');
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                displaySurface: 'monitor',
                width: { max: 1 },
                height: { max: 1 },
                frameRate: { max: 1 }
            },
            audio: {
                // For loopback/system audio: keep processing OFF for pristine digital audio
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000,
                channelCount: 2
            }
        });

        if (!stream || stream.getAudioTracks().length === 0) {
            // Clean up any video tracks before throwing
            stream && stream.getVideoTracks().forEach(track => track.stop());
            throw new Error('No audio tracks in display media');
        }

	        // Keep video track alive for session stability, but disable it to minimize overhead.
	        // The recorder will only use audio tracks (see AudioTranscriptionCoordinator).
	        stream.getVideoTracks().forEach(track => {
	            try { track.enabled = false; } catch (e) { /* ignore */ }
	        });

	        console.log('[WINDOWS_AUDIO] captureViaDisplayMedia: got stream with', stream.getAudioTracks().length, 'audio tracks');
	        return stream;
    }

    /**
     * Method 2: Screen capture with audio (fallback if display media fails)
     */
    async captureViaScreenShare() {
        console.log('[WINDOWS_AUDIO] captureViaScreenShare: requesting...');
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000,
                channelCount: 2
            }
        });

        if (!stream || stream.getAudioTracks().length === 0) {
            stream && stream.getVideoTracks().forEach(t => { try { t.stop(); } catch(e) {} });
            throw new Error('No audio tracks in screen capture');
        }

	        // Keep video track alive for stability, but disable it.
	        stream.getVideoTracks().forEach(track => { try { track.enabled = false; } catch(e) {} });
	        return stream;
    }

    /**
     * Method 3: Look for Stereo Mix or similar loopback device
     */
    async captureViaStereoMix() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const loopbackDevice = devices.find(device => {
            if (device.kind !== 'audioinput') return false;
            
            const label = (device.label || '').toLowerCase();
            return label.includes('stereo mix') || 
                   label.includes('wave out') || 
                   label.includes('what u hear') ||
                   label.includes('loopback');
        });
        
        if (!loopbackDevice) {
            throw new Error('No Stereo Mix device found');
        }
        
        console.log('[WINDOWS_AUDIO] Found loopback device:', loopbackDevice.label);
        
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: loopbackDevice.deviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000,
                channelCount: 2
            }
        });
        
        return stream;
    }

    /**
     * Method 4: Fallback to default device (may pick up some system audio)
     */
    async captureViaDefaultDevice() {
        console.log('[WINDOWS_AUDIO] Fallback: using default audio device');
        
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 44100,
                channelCount: 2
            }
        });
        
        return stream;
    }

    /**
     * Capture microphone audio (external voice)
     */
    async captureMicrophoneAudio(deviceId = null) {
        console.log('[WINDOWS_AUDIO] Capturing microphone audio...');
        
        try {
            // Find best microphone device if none specified
            if (!deviceId) {
                const devices = await this.getAudioDevices();
                const microphones = devices.filter(device => device.type === 'microphone');
                
                if (microphones.length > 0) {
                    // Prefer communications device for voice
                    const commsMic = microphones.find(mic => 
                        mic.label.toLowerCase().includes('communications') ||
                        mic.id === 'communications'
                    );
                    deviceId = commsMic ? commsMic.id : microphones[0].id;
                    console.log('[WINDOWS_AUDIO] Auto-selected microphone:', deviceId);
                }
            }
            
            const constraints = this.getAudioConstraints('speech', deviceId);
            console.log('[WINDOWS_AUDIO] Microphone constraints:', constraints);
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            this.currentStream = stream;
            this.isCapturing = true;
            this.setupAudioMonitoring(stream);
            
            if (this.callbacks.onStreamStart) {
                this.callbacks.onStreamStart(stream, 'microphone');
            }
            
            console.log('[WINDOWS_AUDIO] Microphone capture successful');
            return stream;
            
        } catch (error) {
            console.error('[WINDOWS_AUDIO] Microphone capture failed:', error);
            throw new Error(`Microphone capture failed: ${error.message}`);
        }
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
            console.log(`[WINDOWS_AUDIO] Track ${i}:`, {
                label: track.label,
                settings: track.getSettings(),
                enabled: track.enabled,
                muted: track.muted
            });
        });
        
        if (this.callbacks.onStreamStart) {
            this.callbacks.onStreamStart(stream, 'system_audio', method);
        }
        
        return stream;
    }

    /**
     * Get Windows-specific audio device recommendations
     */
    async getRecommendedDevices() {
        const devices = await this.getAudioDevices();
        
        const recommendations = {
            systemAudio: devices.filter(device => device.type === 'system_audio'),
            microphones: devices.filter(device => device.type === 'microphone'),
            communications: devices.filter(device => 
                device.label.toLowerCase().includes('communications')
            )
        };
        
        console.log('[WINDOWS_AUDIO] Device recommendations:', recommendations);
        return recommendations;
    }

    /**
     * Test system audio capabilities
     */
    async testSystemAudioCapabilities() {
        const results = {
            displayMediaAudio: false,
            screenCaptureAudio: false,
            stereoMixAvailable: false,
            defaultDeviceWorks: false
        };
        
        // Test display media audio
        try {
            const testStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: false, 
                audio: true 
            });
            results.displayMediaAudio = testStream.getAudioTracks().length > 0;
            testStream.getTracks().forEach(track => track.stop());
        } catch (e) {
            console.log('[WINDOWS_AUDIO] Display media audio not available');
        }
        
        // Test for Stereo Mix
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            results.stereoMixAvailable = devices.some(device => 
                device.kind === 'audioinput' && 
                (device.label || '').toLowerCase().includes('stereo mix')
            );
        } catch (e) {
            console.log('[WINDOWS_AUDIO] Cannot enumerate devices');
        }
        
        console.log('[WINDOWS_AUDIO] System audio capabilities:', results);
        return results;
    }
}

// Export for both ES6 and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WindowsAudioService;
} else {
    window.WindowsAudioService = WindowsAudioService;
}
