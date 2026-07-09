const { ipcRenderer } = require('electron');

// DOM Elements
let signInButton;
let signInScreen;
let mainApp;
let manualAuthContainer; // inline fallback container
let signingModal; // glassy signing modal
let signingModalText;

// Initialize auth handling
function initAuth() {
    // Get DOM elements
    signInButton = document.getElementById('signInButton');
    signInScreen = document.getElementById('signInScreen');
    mainApp = document.getElementById('mainApp');
    manualAuthContainer = document.getElementById('manualAuthContainer');
    // Build signing modal lazily to match app style
    buildSigningModal();

    // Add event listeners
    if (signInButton) {
        signInButton.addEventListener('click', handleSignIn);
    }

// Inline manual auth fallback matching app style
function showManualAuth(authUrl) {
    try {
        // Create container once
        if (!manualAuthContainer) {
            manualAuthContainer = document.createElement('div');
            manualAuthContainer.id = 'manualAuthContainer';
            manualAuthContainer.style.marginTop = '0.5rem';
            manualAuthContainer.style.display = 'flex';
            manualAuthContainer.style.flexDirection = 'column';
            manualAuthContainer.style.alignItems = 'center';
            signInButton.parentNode.insertBefore(manualAuthContainer, signInButton.nextSibling);
        }

        // Clear existing content
        manualAuthContainer.innerHTML = '';

        const hint = document.createElement('div');
        hint.style.color = 'rgba(255,255,255,0.9)';
        hint.style.fontSize = '0.85rem';
        hint.style.marginTop = '0.25rem';
        hint.style.textAlign = 'center';
        hint.textContent = 'If nothing opens, click the button below:';

        const btn = document.createElement('button');
        btn.className = 'sign-in-btn no-drag';
        btn.style.marginTop = '0.6rem';
        btn.innerHTML = '<i class="fab fa-google"></i> Open sign-in in browser';
        btn.addEventListener('click', () => {
            try {
                ipcRenderer.send('open-external', authUrl);
            } catch (e) { console.error('Failed to open manual auth URL:', e); }
        });

        manualAuthContainer.appendChild(hint);
        manualAuthContainer.appendChild(btn);
        manualAuthContainer.style.display = 'flex';
    } catch (e) { console.error('showManualAuth failed:', e); }
}

function hideManualAuth() {
    try {
        if (manualAuthContainer) {
            manualAuthContainer.style.display = 'none';
            manualAuthContainer.innerHTML = '';
        }
    } catch {}
}

// Glass-style Signing modal helpers
function buildSigningModal() {
    try {
        if (signingModal) return;
        signingModal = document.createElement('div');
        signingModal.id = 'signingModal';
        Object.assign(signingModal.style, {
            position: 'fixed', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', zIndex: '2000',
        });
        const card = document.createElement('div');
        Object.assign(card.style, {
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '14px',
            padding: '1rem 1.25rem', color: '#fff', boxShadow: 'var(--glass-shadow)', minWidth: '260px', textAlign: 'center'
        });
        const icon = document.createElement('i');
        icon.className = 'fas fa-spinner fa-spin';
        Object.assign(icon.style, { fontSize: '1.1rem', marginRight: '.5rem' });
        signingModalText = document.createElement('span');
        signingModalText.textContent = 'Signing you in...';
        card.appendChild(icon);
        card.appendChild(signingModalText);
        signingModal.appendChild(card);
        document.body.appendChild(signingModal);
    } catch (e) { console.error('buildSigningModal failed:', e); }
}

function showSigningModal() {
    try { if (signingModal) signingModal.style.display = 'flex'; } catch {}
}

function hideSigningModal() {
    try { if (signingModal) signingModal.style.display = 'none'; } catch {}
}

    // Listen for auth state changes
    ipcRenderer.on('auth-state-changed', (event, isAuthenticated) => {
        updateUI(isAuthenticated);
    });

    // Listen for auth completion from main (successful sign-in)
    ipcRenderer.on('auth-complete', (_event, result) => {
        try {
            if (result && result.success) {
                hideManualAuth();
                updateUI(true);
                if (!result.hasAccess) {
                    showLimitedAccessUI();
                }
                // Reset button state if present
                if (signInButton) {
                    signInButton.disabled = false;
                    signInButton.innerHTML = '<i class="fab fa-google"></i> Continue with Google';
                }
            }
        } catch (e) { console.error('auth-complete handling failed:', e); }
    });

    // If browser didn't open promptly, show manual fallback automatically
    ipcRenderer.on('auth-manual-needed', (_event, { authUrl }) => {
        try {
            hideSigningModal();
            showManualAuth(authUrl);
        } catch (e) { console.error('auth-manual-needed handling failed:', e); }
    });

    // Check initial auth state
    checkAuthState();
}

// Check authentication state
async function checkAuthState() {
    try {
        const authState = await ipcRenderer.invoke('check-auth');
        console.log('Auth state:', authState);
        updateUI(authState.isAuthenticated);
        
        if (authState.isAuthenticated && !authState.hasAccess) {
            // Show upgrade prompt or limited access UI
            showLimitedAccessUI();
        }
    } catch (error) {
        console.error('Error checking auth state:', error);
        updateUI(false);
    }
}

// Handle sign in button click
async function handleSignIn() {
    try {
        // Show loading state
        signInButton.disabled = true;
        signInButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
        showSigningModal();

        // Trigger sign in
        const result = await ipcRenderer.invoke('sign-in');
        
        if (result && result.success) {
            // Update UI based on auth result
            updateUI(true);
            
            if (!result.hasAccess) {
                showLimitedAccessUI();
            }
            hideSigningModal();
        } else if (result && result.needsManual && result.authUrl) {
            // Show styled inline fallback matching app style
            showManualAuth(result.authUrl);
            // Keep button enabled for retry attempts
            signInButton.disabled = false;
            signInButton.innerHTML = '<i class="fab fa-google"></i> Continue with Google';
            hideSigningModal();
        } else {
            throw new Error('Sign in failed');
        }
    } catch (error) {
        console.error('Sign in error:', error);
        // Show error message
        const errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.textContent = 'Failed to sign in. Please try again.';
        signInButton.parentNode.insertBefore(errorElement, signInButton.nextSibling);
        
        // Reset button state
        signInButton.disabled = false;
        signInButton.innerHTML = '<i class="fab fa-google"></i> Continue with Google';
        hideSigningModal();
        
        // Remove error message after 5 seconds
        setTimeout(() => {
            if (errorElement.parentNode) {
                errorElement.parentNode.removeChild(errorElement);
            }
        }, 5000);
    }
}

// Update UI based on authentication state
function updateUI(isAuthenticated) {
    if (!signInScreen || !mainApp) return;
    
    if (isAuthenticated) {
        signInScreen.style.display = 'none';
        mainApp.style.display = 'block';
        document.body.classList.add('authenticated');
    } else {
        signInScreen.style.display = 'flex';
        mainApp.style.display = 'none';
        document.body.classList.remove('authenticated');
    }
}

// Show limited access UI (for free tier)
function showLimitedAccessUI() {
    // You can customize this to show a banner or modal about upgrading
    console.log('User has limited access');
    // Example: Show an upgrade banner
    const upgradeBanner = document.createElement('div');
    upgradeBanner.className = 'upgrade-banner';
    upgradeBanner.innerHTML = `
        <div class="upgrade-content">
            <div>
                <i class="fas fa-crown"></i>
                <span>Upgrade to Pro, Ultimate, or Magic for unlimited access</span>
            </div>
            <button id="upgradeButton" class="upgrade-button">Upgrade Now</button>
        </div>
    `;
    document.body.insertBefore(upgradeBanner, document.body.firstChild);
    
    // Add event listener for upgrade button
    const upgradeButton = document.getElementById('upgradeButton');
    if (upgradeButton) {
        upgradeButton.addEventListener('click', () => {
            // Open upgrade URL in default browser
            ipcRenderer.send('open-external', 'https://your-upgrade-url.com');
        });
    }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
} else {
    initAuth();
}

// Export for testing
module.exports = {
    initAuth,
    checkAuthState,
    handleSignIn,
    updateUI,
    showLimitedAccessUI
};
