// Enhanced Loading States Component for Angel AI Assistant
// Provides modern, informative loading indicators with progress tracking

class LoadingStates {
  constructor() {
    this.currentState = null;
    this.startTime = null;
    this.providers = [];
    this.callbacks = {};
  }

  // Start loading with provider information
  startLoading(type, providers = []) {
    this.currentState = type;
    this.startTime = Date.now();
    this.providers = providers;
    
    const loadingElement = this.createLoadingElement(type);
    this.showLoading(loadingElement);
    
    // Start progress animation
    this.animateProgress();
    
    return loadingElement;
  }

  // Create modern loading element based on type
  createLoadingElement(type) {
    const container = document.createElement('div');
    container.className = 'loading-container modern-loading';
    container.id = `loading-${type}`;

    let content = '';
    
    switch (type) {
      case 'transcription':
        content = `
          <div class="loading-content">
            <div class="loading-icon">
              <div class="audio-wave">
                <div class="wave-bar"></div>
                <div class="wave-bar"></div>
                <div class="wave-bar"></div>
                <div class="wave-bar"></div>
              </div>
            </div>
            <div class="loading-text">
              <h3>Transcribing Audio</h3>
              <p class="loading-subtitle">Converting speech to text...</p>
              <div class="provider-status">
                <span class="provider-indicator">🔄 Fast sequential fallback (6s timeouts)</span>
              </div>
            </div>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress-fill"></div>
              </div>
              <div class="progress-text">0%</div>
            </div>
          </div>
        `;
        break;
        
      case 'answer':
        content = `
          <div class="loading-content">
            <div class="loading-icon">
              <div class="thinking-dots">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
              </div>
            </div>
            <div class="loading-text">
              <h3>Generating Response</h3>
              <p class="loading-subtitle">AI is thinking...</p>
              <div class="provider-status">
                <span class="provider-indicator">🤖 Processing your request</span>
              </div>
            </div>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress-fill"></div>
              </div>
              <div class="progress-text">0%</div>
            </div>
          </div>
        `;
        break;
        
      case 'screenshot':
        content = `
          <div class="loading-content">
            <div class="loading-icon">
              <div class="image-scan">
                <div class="scan-line"></div>
                <div class="scan-grid">
                  <div class="grid-cell"></div>
                  <div class="grid-cell"></div>
                  <div class="grid-cell"></div>
                  <div class="grid-cell"></div>
                </div>
              </div>
            </div>
            <div class="loading-text">
              <h3>Analyzing Screenshot</h3>
              <p class="loading-subtitle">Understanding visual content...</p>
              <div class="provider-status">
                <span class="provider-indicator">👁️ Vision AI processing</span>
              </div>
            </div>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress-fill"></div>
              </div>
              <div class="progress-text">0%</div>
            </div>
          </div>
        `;
        break;
        
      default:
        content = `
          <div class="loading-content">
            <div class="loading-icon">
              <div class="spinner"></div>
            </div>
            <div class="loading-text">
              <h3>Processing</h3>
              <p class="loading-subtitle">Please wait...</p>
            </div>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress-fill"></div>
              </div>
              <div class="progress-text">0%</div>
            </div>
          </div>
        `;
    }

    container.innerHTML = content;
    return container;
  }

  // Show loading element in UI
  showLoading(element) {
    // Remove any existing loading elements
    const existing = document.querySelectorAll('.loading-container');
    existing.forEach(el => el.remove());
    
    // Add to appropriate container
    const targetContainer = document.querySelector('.chat-messages') || document.body;
    targetContainer.appendChild(element);
    
    // Animate in
    setTimeout(() => {
      element.classList.add('visible');
    }, 10);
  }

  // Animate progress bar
  animateProgress() {
    if (!this.currentState) return;
    
    const progressFill = document.querySelector('.progress-fill');
    const progressText = document.querySelector('.progress-text');
    
    if (!progressFill || !progressText) return;
    
    let progress = 0;
    const interval = setInterval(() => {
      if (!this.currentState) {
        clearInterval(interval);
        return;
      }
      
      // Simulate realistic progress based on elapsed time
      const elapsed = Date.now() - this.startTime;
      const maxTime = this.getExpectedDuration(this.currentState);
      
      progress = Math.min(90, (elapsed / maxTime) * 100);
      
      progressFill.style.width = `${progress}%`;
      progressText.textContent = `${Math.round(progress)}%`;
      
      if (progress >= 90) {
        clearInterval(interval);
      }
    }, 100);
  }

  // Get expected duration for different operations (with 6s timeouts)
  getExpectedDuration(type) {
    switch (type) {
      case 'transcription': return 18000; // 18 seconds (3 providers × 6s each)
      case 'answer': return 12000; // 12 seconds (2 providers × 6s each)
      case 'screenshot': return 12000; // 12 seconds (2 providers × 6s each)
      default: return 6000; // 6 seconds
    }
  }

  // Update loading state with provider information
  updateProvider(provider, status = 'trying') {
    const indicator = document.querySelector('.provider-indicator');
    if (!indicator) return;
    
    const statusEmojis = {
      'trying': '🔄',
      'success': '✅',
      'failed': '❌',
      'timeout': '⏱️'
    };
    
    const emoji = statusEmojis[status] || '🔄';
    indicator.textContent = `${emoji} ${provider.toUpperCase()} ${status}`;
  }

  // Complete loading with success
  completeLoading(result = null) {
    const container = document.querySelector('.loading-container');
    if (!container) return;
    
    // Complete progress bar
    const progressFill = container.querySelector('.progress-fill');
    const progressText = container.querySelector('.progress-text');
    
    if (progressFill && progressText) {
      progressFill.style.width = '100%';
      progressText.textContent = '100%';
    }
    
    // Show success state briefly
    setTimeout(() => {
      container.classList.add('success');
      setTimeout(() => {
        this.hideLoading();
      }, 500);
    }, 200);
    
    this.currentState = null;
  }

  // Handle loading error
  errorLoading(error) {
    const container = document.querySelector('.loading-container');
    if (!container) return;
    
    container.classList.add('error');
    
    const subtitle = container.querySelector('.loading-subtitle');
    if (subtitle) {
      subtitle.textContent = `Error: ${error.message || 'Something went wrong'}`;
    }
    
    setTimeout(() => {
      this.hideLoading();
    }, 2000);
    
    this.currentState = null;
  }

  // Hide loading element
  hideLoading() {
    const container = document.querySelector('.loading-container');
    if (container) {
      container.classList.add('hiding');
      setTimeout(() => {
        container.remove();
      }, 300);
    }
    this.currentState = null;
  }

  // Check if currently loading
  isLoading() {
    return this.currentState !== null;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LoadingStates;
} else {
  window.LoadingStates = LoadingStates;
}
