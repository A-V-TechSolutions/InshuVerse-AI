// Enhanced Error Handler for Angel AI Assistant
// Provides intelligent error categorization and user-friendly messages

class ErrorHandler {
  constructor() {
    this.errorHistory = [];
    this.maxHistorySize = 50;
  }

  // Main error handling method
  handleError(error, context = {}) {
    const errorInfo = this.categorizeError(error, context);
    this.logError(errorInfo);
    this.showUserFriendlyError(errorInfo);
    return errorInfo;
  }

  // Categorize errors for better handling
  categorizeError(error, context) {
    const message = error.message || error.toString();
    const timestamp = new Date().toISOString();
    
    let category = 'unknown';
    let severity = 'medium';
    let userMessage = 'An unexpected error occurred. Please try again.';
    let suggestions = [];
    let retryable = true;

    // Network and connectivity errors
    if (this.isNetworkError(message)) {
      category = 'network';
      severity = 'high';
      userMessage = 'Connection issue detected. Please check your internet connection.';
      suggestions = [
        'Check your internet connection',
        'Try again in a few moments',
        'Contact support if the issue persists'
      ];
    }
    
    // API key errors
    else if (this.isAPIKeyError(message)) {
      category = 'auth';
      severity = 'high';
      userMessage = 'API key issue detected. Please check your API keys in Settings.';
      suggestions = [
        'Verify your API keys in Settings (gear icon)',
        'Ensure your API keys have sufficient credits',
        'Try switching to a different AI provider'
      ];
      retryable = false;
    }
    
    // Rate limiting errors
    else if (this.isRateLimitError(message)) {
      category = 'rate_limit';
      severity = 'medium';
      userMessage = 'Rate limit reached. Please wait a moment before trying again.';
      suggestions = [
        'Wait 30-60 seconds before retrying',
        'Consider upgrading your API plan',
        'Try using a different AI provider'
      ];
    }
    
    // Quota/billing errors
    else if (this.isQuotaError(message)) {
      category = 'quota';
      severity = 'high';
      userMessage = 'API quota exceeded. Please check your billing or upgrade your plan.';
      suggestions = [
        'Check your API provider billing dashboard',
        'Upgrade your API plan if needed',
        'Try using a different AI provider'
      ];
      retryable = false;
    }
    
    // Timeout errors
    else if (this.isTimeoutError(message)) {
      category = 'timeout';
      severity = 'medium';
      userMessage = 'Request timed out. The AI service is taking longer than expected.';
      suggestions = [
        'Try again - the service may be busy',
        'Check if the AI provider is experiencing issues',
        'Try a shorter input if possible'
      ];
    }
    
    // Service overload errors (503, etc.)
    else if (this.isServiceOverloadError(message)) {
      category = 'service_overload';
      severity = 'medium';
      userMessage = 'AI service is temporarily overloaded. Please try again shortly.';
      suggestions = [
        'Wait 1-2 minutes before retrying',
        'Try using a different AI provider',
        'Check the provider\'s status page'
      ];
    }
    
    // Audio/transcription specific errors
    else if (this.isAudioError(message)) {
      category = 'audio';
      severity = 'medium';
      userMessage = 'Audio processing failed. Please check your microphone and try again.';
      suggestions = [
        'Check microphone permissions',
        'Ensure your microphone is working',
        'Try recording again with clear audio',
        'Check for background noise'
      ];
    }
    
    // Image/screenshot specific errors
    else if (this.isImageError(message)) {
      category = 'image';
      severity = 'medium';
      userMessage = 'Image analysis failed. Please try taking another screenshot.';
      suggestions = [
        'Take a clearer screenshot',
        'Ensure the image contains readable content',
        'Try again with a different image'
      ];
    }

    return {
      originalError: error,
      category,
      severity,
      userMessage,
      suggestions,
      retryable,
      timestamp,
      context,
      technicalDetails: message
    };
  }

  // Error detection methods
  isNetworkError(message) {
    const networkKeywords = [
      'network', 'connection', 'fetch', 'ENOTFOUND', 'ECONNREFUSED',
      'ETIMEDOUT', 'offline', 'internet', 'dns', 'socket'
    ];
    return networkKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  isAPIKeyError(message) {
    const apiKeywords = [
      'api key', 'unauthorized', '401', 'authentication', 'invalid key',
      'missing key', 'api_key', 'auth', 'credential'
    ];
    return apiKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  isRateLimitError(message) {
    const rateKeywords = [
      'rate limit', '429', 'too many requests', 'quota exceeded',
      'rate_limit', 'throttle', 'rpm', 'requests per minute'
    ];
    return rateKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  isQuotaError(message) {
    const quotaKeywords = [
      'quota', 'billing', 'payment', 'subscription', 'credits',
      'usage limit', 'exceeded', 'insufficient funds'
    ];
    return quotaKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  isTimeoutError(message) {
    const timeoutKeywords = [
      'timeout', 'timed out', 'request timeout', 'response timeout',
      'deadline', 'took too long'
    ];
    return timeoutKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  isServiceOverloadError(message) {
    const overloadKeywords = [
      '503', 'service unavailable', 'overloaded', 'server error',
      'temporarily unavailable', 'maintenance', 'capacity'
    ];
    return overloadKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  isAudioError(message) {
    const audioKeywords = [
      'audio', 'microphone', 'recording', 'transcription', 'speech',
      'voice', 'sound', 'media', 'getUserMedia'
    ];
    return audioKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  isImageError(message) {
    const imageKeywords = [
      'image', 'screenshot', 'vision', 'visual', 'picture',
      'photo', 'capture', 'display'
    ];
    return imageKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  // Log error for debugging and analytics
  logError(errorInfo) {
    console.error('[ERROR HANDLER]', {
      category: errorInfo.category,
      severity: errorInfo.severity,
      message: errorInfo.userMessage,
      technical: errorInfo.technicalDetails,
      context: errorInfo.context,
      timestamp: errorInfo.timestamp
    });

    // Add to history
    this.errorHistory.push(errorInfo);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }

    // Send to analytics if available
    if (window.analytics && typeof window.analytics.track === 'function') {
      window.analytics.track('Error Occurred', {
        category: errorInfo.category,
        severity: errorInfo.severity,
        retryable: errorInfo.retryable,
        context: errorInfo.context
      });
    }
  }

  // Show user-friendly error message
  showUserFriendlyError(errorInfo) {
    const errorElement = this.createErrorElement(errorInfo);
    this.displayError(errorElement);
  }

  // Create error UI element
  createErrorElement(errorInfo) {
    const container = document.createElement('div');
    container.className = `error-container error-${errorInfo.severity}`;
    
    const iconMap = {
      network: '🌐',
      auth: '🔑',
      rate_limit: '⏱️',
      quota: '💳',
      timeout: '⏰',
      service_overload: '🚧',
      audio: '🎤',
      image: '🖼️',
      unknown: '⚠️'
    };

    const icon = iconMap[errorInfo.category] || iconMap.unknown;
    
    container.innerHTML = `
      <div class="error-content">
        <div class="error-icon">${icon}</div>
        <div class="error-text">
          <h3>Oops! Something went wrong</h3>
          <p class="error-message">${errorInfo.userMessage}</p>
          ${errorInfo.suggestions.length > 0 ? `
            <div class="error-suggestions">
              <p><strong>Try these solutions:</strong></p>
              <ul>
                ${errorInfo.suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
        <div class="error-actions">
          ${errorInfo.retryable ? '<button class="retry-btn">Try Again</button>' : ''}
          <button class="dismiss-btn">Dismiss</button>
        </div>
      </div>
    `;

    // Add event listeners
    const retryBtn = container.querySelector('.retry-btn');
    const dismissBtn = container.querySelector('.dismiss-btn');
    
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this.hideError(container);
        // Emit retry event
        window.dispatchEvent(new CustomEvent('error-retry', { 
          detail: errorInfo 
        }));
      });
    }
    
    dismissBtn.addEventListener('click', () => {
      this.hideError(container);
    });

    return container;
  }

  // Display error in UI
  displayError(errorElement) {
    // Remove existing errors
    const existingErrors = document.querySelectorAll('.error-container');
    existingErrors.forEach(el => el.remove());
    
    // Add to appropriate container
    const targetContainer = document.querySelector('.chat-messages') || document.body;
    targetContainer.appendChild(errorElement);
    
    // Animate in
    setTimeout(() => {
      errorElement.classList.add('visible');
    }, 10);
    
    // Auto-dismiss after 10 seconds for non-critical errors
    setTimeout(() => {
      if (errorElement.parentNode) {
        this.hideError(errorElement);
      }
    }, 10000);
  }

  // Hide error element
  hideError(errorElement) {
    errorElement.classList.add('hiding');
    setTimeout(() => {
      if (errorElement.parentNode) {
        errorElement.remove();
      }
    }, 300);
  }

  // Get error statistics
  getErrorStats() {
    const stats = {};
    this.errorHistory.forEach(error => {
      stats[error.category] = (stats[error.category] || 0) + 1;
    });
    return stats;
  }

  // Clear error history
  clearHistory() {
    this.errorHistory = [];
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorHandler;
} else {
  window.ErrorHandler = ErrorHandler;
}
