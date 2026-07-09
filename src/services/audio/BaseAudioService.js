/**
 * Base Audio Service - Common functionality for all platforms
 * Production-quality audio capture for interview/meeting helper tool
 */

class BaseAudioService {
    constructor() {
        this.currentStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.isCapturing = false;
        this.callbacks = {
            onLevelUpdate: null,
            onError: null,
            onStreamStart: null,
            onStreamEnd: null
        };
    }

    /**
     * Initialize audio context and common setup
     */
    async initialize() {
        let permissionStream = null;
        try {
            // Request microphone permissions to get device labels.
            // The stream is acquired purely as a permission probe — we never
            // attach it to an AudioContext or MediaRecorder. Releasing the
            // tracks in a `finally` block guarantees the OS mic indicator is
            // not left on if any post-acquisition code throws.
            permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            BaseAudioService._trackStream(permissionStream, 'base-init-probe');
            console.log('[AUDIO] Base service initialized');
            return true;
        } catch (error) {
            console.error('[AUDIO] Failed to initialize base service:', error);
            return false;
        } finally {
            if (permissionStream) {
                try {
                    permissionStream.getTracks().forEach(track => {
                        try { track.stop(); } catch (_) { /* ignore */ }
                    });
                } catch (_) { /* ignore */ }
            }
        }
    }

    // ── Active-stream leak instrumentation ────────────────────────────────
    // Increments window.__activeAudioStreams on every track acquired via
    // getUserMedia / getDisplayMedia and decrements it when the track stops
    // (either via track.stop() or the natural 'ended' event). The current
    // count is mirrored to the main process over `audio-active-streams` so
    // a leaked stream surfaces in the main-process log right next to any
    // [ERROR:audio_loopback_input_mac_impl] messages — no need to wait
    // for the macOS indicator to act as the canary. All static so subclasses
    // (MacOSAudioService) and AudioManager probe paths can call them
    // without holding a service instance.
    static _trackStream(stream, label) {
        try {
            if (!stream || typeof stream.getTracks !== 'function') return stream;
            stream.getTracks().forEach(track => {
                BaseAudioService._instrumentTrack(track, label);
            });
        } catch (_) { /* ignore */ }
        return stream;
    }

    static _instrumentTrack(track, label) {
        if (!track || track.__audioLeakInstrumented) return;
        track.__audioLeakInstrumented = true;
        BaseAudioService._incActiveStreamCount(label);

        const release = () => {
            if (track.__audioLeakReleased) return;
            track.__audioLeakReleased = true;
            try { track.removeEventListener('ended', release); } catch (_) {}
            BaseAudioService._decActiveStreamCount(label);
        };
        try { track.addEventListener('ended', release); } catch (_) {}

        // Wrap stop() so an explicit caller-driven stop also decrements.
        // Native track.stop() does NOT fire 'ended' on most platforms, so
        // we cannot rely on the listener alone.
        try {
            const origStop = track.stop ? track.stop.bind(track) : null;
            if (origStop) {
                track.stop = function () {
                    try { return origStop(); }
                    finally { release(); }
                };
            }
        } catch (_) { /* ignore */ }
    }

    static _incActiveStreamCount(label) {
        try {
            if (typeof window === 'undefined') return;
            window.__activeAudioStreams = (window.__activeAudioStreams || 0) + 1;
            BaseAudioService._reportActiveStreamCount(label, '+');
        } catch (_) { /* ignore */ }
    }

    static _decActiveStreamCount(label) {
        try {
            if (typeof window === 'undefined') return;
            const next = Math.max(0, (window.__activeAudioStreams || 0) - 1);
            window.__activeAudioStreams = next;
            BaseAudioService._reportActiveStreamCount(label, '-');
        } catch (_) { /* ignore */ }
    }

    static _reportActiveStreamCount(label, delta) {
        try {
            const count = (typeof window !== 'undefined' && typeof window.__activeAudioStreams === 'number')
                ? window.__activeAudioStreams : 0;
            console.log(`[AUDIO] active streams: ${count} (${delta} ${label || 'stream'})`);
            if (typeof window !== 'undefined' && typeof window.require === 'function') {
                try {
                    const { ipcRenderer } = window.require('electron');
                    if (ipcRenderer && typeof ipcRenderer.send === 'function') {
                        ipcRenderer.send('audio-active-streams', { count, delta, label });
                    }
                } catch (_) { /* ignore */ }
            }
        } catch (_) { /* ignore */ }
    }

    /**
     * Set up audio level monitoring
     */
    setupAudioMonitoring(stream) {
        try {
            // Close any existing AudioContext to prevent leaks
            if (this.audioContext && this.audioContext.state !== 'closed') {
                try { this.audioContext.close(); } catch (e) { /* ignore */ }
            }

            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            
            // Optimized settings for speech detection
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            source.connect(this.analyser);

            const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            const updateLevels = () => {
                if (!this.isCapturing) return;
                
                this.analyser.getByteFrequencyData(dataArray);
                
                // Calculate RMS for better speech detection
                const rms = Math.sqrt(dataArray.reduce((sum, value) => sum + value * value, 0) / dataArray.length);
                const level = Math.min(100, (rms / 128) * 100);
                
                if (this.callbacks.onLevelUpdate) {
                    this.callbacks.onLevelUpdate(level, rms);
                }
                
                requestAnimationFrame(updateLevels);
            };
            
            updateLevels();
            console.log('[AUDIO] Audio monitoring setup complete');
        } catch (error) {
            console.error('[AUDIO] Failed to setup audio monitoring:', error);
        }
    }

    /**
     * Get available audio input devices
     */
    async getAudioDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            
            return audioInputs.map(device => ({
                id: device.deviceId,
                label: device.label || `Audio Device ${device.deviceId.slice(0, 8)}`,
                type: this.classifyAudioDevice(device)
            }));
        } catch (error) {
            console.error('[AUDIO] Failed to get audio devices:', error);
            return [];
        }
    }

    /**
     * Classify audio device as microphone or system audio
     */
    classifyAudioDevice(device) {
        const label = (device.label || '').toLowerCase();
        
        // System audio indicators
        const systemKeywords = [
            'stereo mix', 'wave out', 'speakers', 'loopback', 
            'what u hear', 'line in', 'monitor', 'playback'
        ];
        
        // Microphone indicators  
        const micKeywords = [
            'microphone', 'mic', 'headset', 'webcam', 
            'usb', 'bluetooth', 'built-in', 'internal'
        ];
        
        // Check system audio first (more specific)
        if (systemKeywords.some(keyword => label.includes(keyword))) {
            return 'system_audio';
        }
        
        // Check microphone keywords
        if (micKeywords.some(keyword => label.includes(keyword))) {
            return 'microphone';
        }
        
        // Default/communications devices are usually microphones
        if (device.deviceId === 'default' || device.deviceId === 'communications') {
            return 'microphone';
        }
        
        return 'microphone'; // Default assumption
    }

    /**
     * Create optimized audio constraints for different scenarios
     */
    getAudioConstraints(purpose = 'speech', deviceId = null) {
        const baseConstraints = {
            echoCancellation: purpose === 'speech',
            noiseSuppression: purpose === 'speech', 
            autoGainControl: purpose === 'speech',
            sampleRate: purpose === 'music' ? 48000 : 44100,
            channelCount: purpose === 'music' ? 2 : 1
        };

        if (deviceId) {
            baseConstraints.deviceId = { exact: deviceId };
        }

        return { audio: baseConstraints };
    }

    /**
     * Set event callbacks
     */
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Stop current audio capture
     */
    stopCapture() {
        this.isCapturing = false;
        
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => track.stop());
            this.currentStream = null;
        }
        
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        if (this.callbacks.onStreamEnd) {
            this.callbacks.onStreamEnd();
        }
        
        console.log('[AUDIO] Capture stopped');
    }

    /**
     * Get platform information
     */
    getPlatform() {
        try {
            if (typeof process !== 'undefined' && process.platform) {
                return process.platform;
            }
        } catch (e) {
            // Fallback detection
        }
        
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes('mac')) return 'darwin';
        if (userAgent.includes('win')) return 'win32';
        if (userAgent.includes('linux')) return 'linux';
        return 'unknown';
    }

    /**
     * Check if browser supports required APIs
     */
    checkBrowserSupport() {
        const support = {
            getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
            getDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
            audioContext: !!(window.AudioContext || window.webkitAudioContext),
            mediaRecorder: !!window.MediaRecorder
        };
        
        console.log('[AUDIO] Browser support:', support);
        return support;
    }
}

// Export for both ES6 and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BaseAudioService;
} else {
    window.BaseAudioService = BaseAudioService;
}
