const { desktopCapturer } = require('electron');
const { ipcRenderer } = require('electron');

class RecordingService {
    constructor() {
        this.mediaRecorder = null;
        this.isRecording = false;
        this.chunks = [];
        this.selectedAudioSource = 'default';
        this.currentStream = null;
    }

    // Set the audio source to use for recording
    setAudioSource(sourceId) {
        this.selectedAudioSource = sourceId;
        console.log('[RecordingService] Audio source set to:', sourceId);
    }



    // Check if we're on macOS
    isMacOS() {
        return typeof process !== 'undefined' && process.platform === 'darwin';
    }

    // Check screen recording permission
    async checkScreenRecordingPermission() {
        try {
            if (this.isMacOS()) {
                const hasPermission = await ipcRenderer.invoke('check-screen-permission');
                console.log('[RecordingService] Screen recording permission:', hasPermission);
                return hasPermission;
            }
            return true; // Non-macOS platforms
        } catch (e) {
            console.warn('[RecordingService] Permission check failed:', e);
            return false;
        }
    }

    // Get system audio via display media with proper error handling
    async getSystemAudioViaDisplayMedia() {
        try {
            console.log('[RecordingService] Attempting system audio capture via getDisplayMedia');

            // Check permission first on macOS
            if (this.isMacOS()) {
                const hasPermission = await this.checkScreenRecordingPermission();
                if (!hasPermission) {
                    throw new Error('SCREEN_PERMISSION_REQUIRED');
                }
            }

            // Request display media with audio
            // NOTE: On Windows/Chromium, getDisplayMedia REQUIRES video: true.
            // We request minimal video and immediately discard the video tracks.
            const constraints = {
                video: {
                    displaySurface: 'monitor',
                    width: { max: 1 },
                    height: { max: 1 },
                    frameRate: { max: 1 }
                },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 48000
                }
            };

            console.log('[RecordingService] Requesting getDisplayMedia with constraints:', constraints);
            const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();

            console.log('[RecordingService] getDisplayMedia result:', {
                audioTracks: audioTracks.length,
                videoTracks: videoTracks.length,
                audioSettings: audioTracks[0]?.getSettings()
            });

            if (!audioTracks || audioTracks.length === 0) {
                // Stop video tracks since we don't need them
                videoTracks.forEach(track => track.stop());
                throw new Error('NO_SYSTEM_AUDIO_AVAILABLE');
            }

            // Create audio-only stream and stop video tracks
            const audioOnlyStream = new MediaStream(audioTracks);
            videoTracks.forEach(track => track.stop());

            return audioOnlyStream;
        } catch (e) {
            console.error('[RecordingService] getSystemAudioViaDisplayMedia failed:', e);

            if (e.name === 'NotAllowedError') {
                throw new Error('SCREEN_PERMISSION_DENIED');
            } else if (e.name === 'NotSupportedError') {
                throw new Error('SYSTEM_AUDIO_NOT_SUPPORTED');
            } else if (e.message === 'SCREEN_PERMISSION_REQUIRED') {
                throw e;
            } else if (e.message === 'NO_SYSTEM_AUDIO_AVAILABLE') {
                throw e;
            } else {
                throw new Error('SYSTEM_AUDIO_CAPTURE_FAILED');
            }
        }
    }

    async start() {
        if (this.isRecording) return;

        try {
            // Clean up any previous stream to prevent stale audio data
            if (this.currentStream) {
                this.currentStream.getTracks().forEach(track => {
                    try { track.stop(); } catch (e) { /* ignore */ }
                });
                this.currentStream = null;
            }
            this.chunks = [];
            this.mediaRecorder = null;

            let stream;
            let audioConstraints;
            const selectedSource = this.selectedAudioSource;

            console.log('Starting recording with audio source:', selectedSource);

            // Handle different audio source types
            if (selectedSource === '__system_capture__') {
                // System audio via screen capture
                console.log('Using system audio via screen capture');
                try {
                    const sysStream = await this.getSystemAudioViaDisplayMedia();
                    stream = new MediaStream(sysStream.getAudioTracks());
                } catch (e) {
                    throw new Error('System audio capture via screen capture failed. Please enable Screen Recording permission or use a different audio source.');
                }

            } else if (selectedSource === '__system_only__') {
                // Try system audio capture
                console.log('Using system audio capture');
                try {
                    const sysStream = await this.getSystemAudioViaDisplayMedia();
                    stream = new MediaStream(sysStream.getAudioTracks());
                } catch (e) {
                    throw new Error('System audio capture failed. Please try microphone instead or ensure proper permissions.');
                }

            } else {
                // Regular microphone or specific device
                console.log('Using microphone input');
                audioConstraints = {
                    deviceId: selectedSource === 'default' ? undefined : { exact: selectedSource },
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1
                };

                stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            }

            // Verify stream is valid
            if (!stream || stream.getTracks().length === 0) {
                throw new Error('Failed to get audio stream from selected source');
            }

            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                throw new Error('No audio tracks found in stream');
            }

            console.log('Audio stream obtained successfully:', {
                tracks: audioTracks.length,
                settings: audioTracks[0].getSettings()
            });

            // Store stream reference for proper cleanup on next recording
            this.currentStream = stream;

            // 64 kbps Opus is the sweet-spot for speech STT:
            // - Indistinguishable transcription accuracy vs 256 kbps (STT models are trained on 16 kHz)
            // - 4× smaller audioChunks[] array in RAM during recording
            // - 4× less data uploaded to OpenAI / Gemini per interaction
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 64000
            });

            // Clear previous chunks and ensure clean state for first recording
            this.chunks = [];
            console.log('[RECORDING] Cleared audio chunks for new recording session');

            // Handle data available event
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    console.log(`[RECORDING] Audio chunk received: ${event.data.size} bytes`);
                    this.chunks.push(event.data);
                }
            };

            // Start recording with proper interval to prevent first-recording corruption
            // Use 1000ms (1 second) instead of 100ms to prevent audio buffer issues
            this.mediaRecorder.start(1000); // Collect data every 1 second for stability
            this.isRecording = true;

            console.log('[RECORDING] MediaRecorder started with 1-second intervals');

            return true;
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.stop();
            throw error;
        }
    }

    stop() {
        if (!this.isRecording) return null;

        return new Promise((resolve, reject) => {
            try {
                // Flush any buffered audio data before stopping to prevent partial capture
                try {
                    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                        this.mediaRecorder.requestData();
                        console.log('[RECORDING] Flushed buffered audio data before stop');
                    }
                } catch (flushErr) {
                    console.warn('[RECORDING] requestData flush warning:', flushErr.message);
                }

                this.mediaRecorder.onstop = async () => {
                    try {
                        console.log(`[RECORDING] Processing ${this.chunks.length} audio chunks`);

                        // Validate chunks before processing
                        const validChunks = this.chunks.filter(chunk => chunk && chunk.size > 0);
                        if (validChunks.length === 0) {
                            console.warn('[RECORDING] No valid audio chunks found');
                            reject(new Error('No valid audio data recorded'));
                            return;
                        }

                        // Convert chunks to base64
                        const blob = new Blob(validChunks, { type: 'audio/webm' });
                        const buffer = await blob.arrayBuffer();

                        // Validate buffer size
                        if (buffer.byteLength === 0) {
                            console.warn('[RECORDING] Empty audio buffer');
                            reject(new Error('Empty audio buffer'));
                            return;
                        }

                        const base64Data = Buffer.from(buffer).toString('base64');
                        console.log(`[RECORDING] Audio processed: ${buffer.byteLength} bytes -> ${base64Data.length} base64 chars`);

                        // Clean up
                        this.chunks = [];
                        this.isRecording = false;
                        this.mediaRecorder = null;

                        resolve(base64Data);
                    } catch (error) {
                        console.error('[RECORDING] Error processing audio:', error);
                        reject(error);
                    }
                };

                // Stop recording
                this.mediaRecorder.stop();

                // Stop all tracks
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            } catch (error) {
                console.error('Failed to stop recording:', error);
                reject(error);
            }
        });
    }

    isActive() {
        return this.isRecording;
    }
}

module.exports = RecordingService; 