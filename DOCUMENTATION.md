# InshuVerse AI - Complete Application Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Main Process](#main-process)
5. [Renderer Process](#renderer-process)
6. [IPC Communication](#ipc-communication)
7. [Key Features](#key-features)
8. [Services Layer](#services-layer)
9. [Authentication & Plans](#authentication--plans)
10. [Backend API](#backend-api)
11. [Deployment](#deployment)

---

## Overview

InshuVerse AI is an Electron-based desktop AI assistant that helps users during interviews, meetings, and general Q&A. It provides real-time transcription, screenshot analysis, chat-based AI responses, and screen sharing protection (Hide Mode).

**Key Technologies:**
- **Electron** - Desktop application framework
- **Firebase** - Authentication and user data storage
- **OpenAI API** - GPT models for transcription and chat
- **Google Gemini API** - Alternative AI provider with vision capabilities
- **Node.js** - Backend services and API integration
- **Express** - Backend API server

**Version:** 6.0.7

---

## Architecture

### Multi-Process Architecture

InshuVerse AI follows Electron's multi-process architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process (Node.js)                    │
│  - Window management                                          │
│  - IPC handlers                                               │
│  - API key management                                         │
│  - Service orchestration                                      │
│  - File system operations                                     │
└─────────────────────────────────────────────────────────────┘
                              ↕ IPC
┌─────────────────────────────────────────────────────────────┐
│                  Renderer Process (Chromium)                  │
│  - UI rendering (index.html)                                  │
│  - User interactions                                           │
│  - DOM manipulation                                            │
│  - Client-side logic                                           │
└─────────────────────────────────────────────────────────────┘
                              ↕ HTTP
┌─────────────────────────────────────────────────────────────┐
│              Backend API (Express.js - Render.com)             │
│  - User plan management                                       │
│  - Credit system                                              │
│  - Payment integration                                        │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                    Firebase (Firestore)                       │
│  - User authentication                                         │
│  - Plan and credit storage                                    │
└─────────────────────────────────────────────────────────────┘
```

### State Management

**Centralized State** (`src/state/app-state.js`):
- Single source of truth for main-process state
- Shared across all modules via Node's module cache
- Contains: window state, recording status, hide mode, auth state, conversation history

**Key State Variables:**
```javascript
{
  mainWindow: BrowserWindow | null,
  windowState: { width, height, x, y },
  isRecording: boolean,
  isProcessingAudio: boolean,
  isInScreenSharingMode: boolean,
  alwaysOnTopEnabled: boolean,
  selectedModel: 'default' | 'openai' | 'gemini',
  responseSize: 'small' | 'medium' | 'big',
  currentUser: Firebase.User | null,
  currentPlan: { planName, credits, isLifetimePlan, ... },
  lifetimeUserKeys: { openai: string, gemini: string },
  conversationHistory: Array<{role, content}>,
  userProfile: { resume, jobDescription } | null
}
```

---

## File Structure

```
inshuverse/
├── main.js                          # Main process entry point
├── index.html                       # Renderer UI (single file)
├── package.json                     # Dependencies and scripts
├── firebase-config.js              # Firebase configuration
├── DESIGN-SYSTEM.md                # UI design system documentation
│
├── src/                             # Modular source code
│   ├── state/
│   │   └── app-state.js            # Centralized state management
│   │
│   ├── ipc/
│   │   └── channels.js              # IPC channel name constants
│   │
│   ├── auth/
│   │   └── tiers.js                 # User tier & API key routing
│   │
│   ├── window/
│   │   ├── hide-mode.js            # Screen sharing protection
│   │   └── window-manager.js       # Window management utilities
│   │
│   ├── services/                    # Business logic layer
│   │   ├── answer.js               # Chat/text answer generation
│   │   ├── screenshot.js           # Image analysis
│   │   ├── transcription.js        # Audio transcription
│   │   ├── keypool.js              # API key rotation pool
│   │   ├── model-registry.js       # AI model version management
│   │   ├── usage.js                # Credit enforcement
│   │   ├── crypto-vault.js         # Encrypted key storage
│   │   ├── deepgram-stream.js      # Deepgram streaming wrapper
│   │   ├── assemblyai-stream.js    # AssemblyAI streaming wrapper
│   │   ├── ghost-typing.js         # macOS ghost typing
│   │   ├── billing-mode.js         # Billing mode detection
│   │   ├── plan-gate.js            # Plan-based feature gating
│   │   └── rag/                    # RAG (Retrieval Augmented Generation)
│   │
│   ├── renderer/                    # Renderer-specific utilities
│   │   ├── auth.js                 # Authentication logic
│   │   └── messageFormatter.js     # Chat message formatting
│   │
│   ├── components/                  # UI components
│   │   ├── ErrorHandler.js         # Error handling utilities
│   │   └── LoadingStates.js        # Loading state management
│   │
│   └── styles/                      # CSS stylesheets
│       ├── design-system.css        # Base design system
│       ├── advanced-design-system.css # Advanced animations
│       ├── component-library.css    # UI components
│       ├── loading-states.css       # Loading animations
│       ├── error-handler.css        # Error styles
│       └── gate-purple-theme.css    # Sign-in theme
│
├── backend/                         # Express.js backend
│   ├── server.js                    # Backend entry point
│   ├── routes/
│   │   ├── user.js                 # User plan routes
│   │   ├── credits.js              # Credit debit routes
│   │   └── auth.js                 # Authentication routes
│   ├── controllers/
│   │   ├── userController.js       # User logic
│   │   └── creditController.js     # Credit logic
│   └── firebase/                    # Firebase configuration
│
└── assets/                          # Static assets
    └── icons/                       # Application icons
```

---

## Main Process

### Entry Point (`main.js`)

The main process is the heart of the Electron application. Key responsibilities:

**Initialization:**
1. Load encrypted API keys from crypto-vault
2. Initialize KeyPool with vendor-managed keys
3. Register IPC handlers
4. Create main window
5. Set up global shortcuts
6. Initialize authentication

**Key Modules Imported:**
```javascript
const { APP_STATE } = require('./src/state/app-state')
const CH = require('./src/ipc/channels')
const { registerHideModeHandlers } = require('./src/window/hide-mode')
const { registerHighlightShortcut } = require('./src/services/vision/highlight')
const ghostTyping = require('./src/services/ghost-typing')
```

**API Key Management:**
- Default keys are encrypted using AES-256-GCM
- Keys are decrypted at startup using crypto-vault
- Vendor keys are registered into KeyPool for rotation
- Lifetime user keys are registered per-user (isolated)

**Window Creation:**
```javascript
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 624,
    height: 600,
    alwaysOnTop: true,
    transparent: true,  // For Hide Mode transparency
    frame: false,      // Custom title bar
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  })
}
```

### Hide Mode (`src/window/hide-mode.js`)

Hide Mode protects the application from screen capture during sensitive activities.

**Platform-Specific Behavior:**

**macOS:**
- `setContentProtection(true)` - Excludes window from screen capture
- `setVisibleOnAllWorkspaces(true)` - Visible on all Spaces
- `app.dock.hide()` - Hides from Dock
- `setWindowButtonVisibility(false)` - Hides traffic lights
- `setOpacity(0.99)` - Slight opacity for visual feedback

**Windows:**
- `setContentProtection(true)` - Sets WDA_EXCLUDEFROMCAPTURE flag
- `setSkipTaskbar(true)` - Hides from taskbar
- Transparent window mode for visual feedback

**Key Features:**
1. **Auto-Restore:** Hide Mode state persists across app restarts
2. **Safe Mode:** Disables GPU acceleration for problematic drivers
3. **Re-assertion:** Periodically re-applies protection (every 2s)
4. **Staggered Application:** Applies protection at 0ms, 150ms, 800ms
5. **Event Listeners:** Re-applies on focus, blur, move, resize, etc.

**IPC Handlers:**
- `toggle-screen-sharing-mode` - Enable/disable Hide Mode
- `hide-mode-flush` - Force compositor flush
- `hide-mode-get-safe-mode` - Read Safe Mode state
- `hide-mode-set-safe-mode` - Toggle Safe Mode (requires restart)
- `hide-mode-diagnostics` - Get protection diagnostics
- `hide-mode-verify` - Verify current protection state

### Background Service Manager

Handles background mode (minimize to tray/menu bar):

**macOS:**
- Creates menu bar icon
- Sets activation policy to 'accessory'
- Hides from Dock and Cmd+Tab

**Windows:**
- Creates system tray icon
- Hides from taskbar
- Provides context menu

### Always-on-Top Management

Platform-specific always-on-top behavior:
- **macOS:** `'floating'` level, level 1
- **Windows:** `'screen-saver'` level, level 1
- **Linux:** Default always-on-top

Suspended during authentication to allow modal dialogs to work.

---

## Renderer Process

### Main UI (`index.html`)

The renderer is a single HTML file containing all UI, styles, and client-side logic.

**Structure:**
- Welcome screen with profile input
- Main chat interface
- Settings modal (General, API Keys, Help tabs)
- Hide Mode confirmation modal
- Access denied overlay

**Key UI Components:**
- Chat messages container with auto-scroll
- Microphone button for voice recording
- Screenshot button for image capture
- Hide Mode toggle (eye icon)
- Settings gear button
- Custom window controls (Windows only)

**Client-Side Logic:**
1. **Authentication:** Google OAuth flow
2. **Chat:** Message display and input handling
3. **Voice:** Audio recording and transcription display
4. **Screenshot:** Image capture and answer display
5. **Hide Mode:** Toggle and transparency control
6. **Settings:** API key management, model selection, response size

**Styling:**
- Uses advanced design system with glassmorphism
- Responsive animations and transitions
- Dark theme with gradient accents
- Custom scrollbars and form controls

### Renderer Utilities

**`src/renderer/auth.js`:**
- Handles Google OAuth sign-in flow
- Manages authentication state
- Fetches user plan and credits

**`src/renderer/messageFormatter.js`:**
- Formats chat messages for display
- Handles code blocks and markdown
- Manages message timestamps

---

## IPC Communication

### Channel Names (`src/ipc/channels.js`)

All IPC channels are defined as constants to avoid string literal errors:

```javascript
// Voice / Audio
TOGGLE_RECORDING
TRANSCRIBE_AUDIO
PLAY_AUDIO
RECORDING_STARTED
RECORDING_STOPPED
AUDIO_LEVEL

// Answer / AI Stream
GET_ANSWER
ANSWER_START
ANSWER_PART
ANSWER_DONE
ANSWER_STATUS
ANSWER_ERROR

// Screenshot / Vision
TAKE_SCREENSHOT
SCREENSHOT_CAPTURED
SCREENSHOT_ERROR
SCREENSHOT_ANSWER

// Highlight Response
HIGHLIGHT_EXPLAIN
HIGHLIGHT_RESULT

// Window / Hide Mode
TOGGLE_SCREEN_SHARING
SCREEN_SHARING_ACTIVE
HIDE_MODE_FLUSH
SET_TRANSPARENCY
SET_ALWAYS_ON_TOP
MINIMIZE_WINDOW
CLOSE_WINDOW
WINDOW_READY
WINDOW_MOVE

// Authentication
FIREBASE_SIGN_IN
FIREBASE_SIGN_OUT
AUTH_STATE_CHANGED
GET_USER_PLAN
REFRESH_CREDITS
DEDUCT_CREDITS

// Settings / API Keys
GET_API_KEYS
SAVE_API_KEYS
TEST_API_KEY
SET_RESPONSE_SIZE
SET_MODEL_SELECTION
GET_MODEL_SELECTION

// System / Shell
OPEN_EXTERNAL_URL
CHECK_UPDATE
APP_VERSION
SHOW_HISTORY
RESTART_APP
GET_MIC_DEVICES
TEST_AUDIO

// Profile / Onboarding
SAVE_PROFILE
GET_PROFILE
PROFILE_UPDATED
```

### Communication Patterns

**Renderer → Main (invoke):**
```javascript
// Renderer
const result = await ipcRenderer.invoke('toggle-screen-sharing-mode', true)

// Main
ipcMain.handle('toggle-screen-sharing-mode', (event, isScreenSharing) => {
  // Handle request
  return {成功: true }
})
```

**Main → Renderer (send):**
```javascript
// Main
mainWindow.webContents.send('credits-updated', newCredits)

// Renderer
ipcRenderer.on('credits-updated', (event, credits) => {
  // Update UI
})
```

**Bidirectional:**
- Authentication state changes
- Credit updates
- Plan changes
- Hide Mode state sync

---

## Key Features

### 1. Hide Mode (Screen Sharing Protection)

**Purpose:** Prevent the application from being captured in screen recordings/shares during sensitive activities.

**Implementation:**
- Uses OS-level content protection APIs
- macOS: `setContentProtection()` + dock hide
- Windows: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`
- Auto-restores on app launch
- Periodic re-assertion for reliability

**Transparency:**
- When Hide Mode is ON: Window becomes transparent (see-through)
- When Hide Mode is OFF: Window returns to normal dark glass UI
- Simple toggle logic - no localStorage involved

**Safe Mode:**
- Disables GPU acceleration for problematic drivers
- Requires app restart to take effect
- Stored in `userData/hide-mode-safe.json`

### 2. Voice Recording & Transcription

**Flow:**
1. User clicks microphone button
2. Renderer requests microphone access
3. Audio recorded as WebM buffer
4. Buffer sent to main process via IPC
5. Main process calls transcription service
6. Sequential fallback: OpenAI fast → Gemini → OpenAI quality
7. Transcription returned to renderer
8. Text displayed in chat
9. AI answer generated automatically

**Transcription Services:**
- **OpenAI Fast:** `gpt-4o-mini-transcribe` (5s timeout)
- **OpenAI Quality:** `gpt-4o-transcribe` (18s timeout)
- **Gemini:** `gemini-2.5-flash-lite` (6s timeout)

**Language Support:**
- 20+ languages including English, Hindi, Telugu, Tamil, etc.
- Language code passed to transcription API
- Auto-detection fallback

### 3. Screenshot Analysis

**Flow:**
1. User clicks screenshot button
2. Hide Mode prompt shown (optional)
3. Screen capture via `desktopCapturer`
4. Image converted to JPEG (80% quality)
5. Base64 encoded
6. Sent to main process
7. Vision API analysis (Gemini or OpenAI)
8. Answer streamed back to renderer
9. Displayed in chat

**Vision Models:**
- **Gemini Vision:** `gemini-2.5-flash` with vision
- **OpenAI Vision:** `gpt-4o` with vision capabilities

**Vision Detail Levels:**
- `low`: ~85 input tokens (aptitude/online-tests mode)
- `high`: ~765 input tokens (coder mode)

### 4. Chat & AI Responses

**Flow:**
1. User types message or speaks
2. Message added to conversation history
3. System prompt built from user profile
4. Sent to AI model (OpenAI or Gemini)
5. Response streamed in real-time
6. Displayed in chat bubble

**Response Size Options:**
- **Small:** 500 tokens (concise, 4-6 sentences)
- **Medium:** 1100 tokens (balanced, complete)
- **Big:** 2200 tokens (comprehensive, detailed)

**Conversation History:**
- Last 10 messages (5 turns)
- Filtered for quality
- Trailing user messages removed
- Context maintained across modalities (voice, text, screenshot)

### 5. Authentication & Plans

**Google OAuth Flow:**
1. User clicks "Sign in with Google"
2. Main process starts local HTTP server
3. Opens Google OAuth URL in browser
4. User authorizes
5. Authorization code received
6. Exchanged for access token
7. Firebase sign-in with credential
8. User plan fetched from backend
9. Credits loaded

**Plan Tiers:**
- **Free:** 7 credits, system shared keys
- **Pro:** 600 credits, premium keys
- **Ultimate:** 1500 credits, premium keys
- **Magic:** 4000 credits, premium keys
- **Lifetime:** Unlimited credits, user's own keys

**Credit System:**
- 1 credit per action (text, voice, screenshot, highlight)
- Deducted via backend API
- Backend enforces limits
- Real-time credit updates

---

## Services Layer

### Transcription Service (`src/services/transcription.js`)

**Key Functions:**
- `transcribeWithOpenAIFast()` - Fast OpenAI transcription
- `transcribeWithOpenAI()` - Quality OpenAI transcription
- `transcribeWithGemini()` - Gemini transcription
- `transcribeWithFallback()` - Sequential fallback chain
- `transcribeWithModelSelection()` - Model-aware entry point

**Fallback Chain:**
1. OpenAI fast (gpt-4o-mini-transcribe)
2. Gemini (gemini-2.5-flash-lite)
3. OpenAI quality (gpt-4o-transcribe)

**Audio Validation:**
- WebM signature check
- Minimum size validation (8KB)
- Duration check (0.5s minimum)
- Format validation

### Answer Service (`src/services/answer.js`)

**Key Functions:**
- `getAnswerFromOpenAI()` - OpenAI chat completion
- `getAnswerFromGemini()` - Gemini chat completion
- `getAnswerWithFallback()` - Sequential fallback
- `getAnswerWithModelSelection()` - Model-aware entry point

**System Prompt Building:**
- Stable prefix for OpenAI prefix caching
- Mode-specific context (interview, meeting, chatgpt)
- User profile/job description injection
- Response size guidance
- RAG context injection (when eligible)

**Gemini Smooth Streaming:**
- Slices large deltas at word boundaries
- 8ms pacing for typewriter effect
- Degeneracy detection (repetition prevention)

### Screenshot Service (`src/services/screenshot.js`)

**Key Functions:**
- `answerFromImageWithOpenAI()` - OpenAI vision
- `answerFromImageWithOpenAIStream()` - Streaming OpenAI vision
- `answerFromImageWithGemini()` - Gemini vision
- `answerFromImageWithGeminiStream()` - Streaming Gemini vision
- `answerFromImageWithFallbackStream()` - Fallback chain
- `answerFromImageWithModelSelectionStream()` - Model-aware entry point

**Fallback Chain:**
1. User's Gemini key
2. Server-side Gemini fallback key
3. User's OpenAI key

**Vision Detail:**
- `low` detail for aptitude/online-tests (saves tokens)
- `high` detail for coder mode (better accuracy)

### KeyPool Service (`src/services/keypool.js`)

**Purpose:** Provider-aware, organization-aware key rotation with cooldown state machine.

**Pool Buckets:**
- `openai/org-a` - Free tier OpenAI keys
- `openai/org-b` - Premium OpenAI keys
- `gemini/free` - Free tier Gemini keys
- `gemini/premium` - Premium Gemini keys
- `assemblyai/free` - Free AssemblyAI keys
- `assemblyai/pro` - Premium AssemblyAI keys
- `openai/lifetime:<userId>` - Per-user lifetime OpenAI keys
- `gemini/lifetime:<userId>` - Per-user lifetime Gemini keys

**Cooldown Ladder:**
```
healthy → cooldown(60s) → cooldown(5m) → quarantined(1h)
```

**Error Handling:**
- 401/403 → Immediate quarantine
- 429 → Escalates ladder (3 failures = quarantine)
- 5xx → Short cooldown only
- Success → Reset to healthy

**Round-Robin Acquisition:**
- Picks next healthy key from bucket
- Skips keys in cooldown
- Promotes expired cooldowns to healthy

### Model Registry (`src/services/model-registry.js`)

**Purpose:** Centralized AI model version management with automatic fallback on deprecation.

**Model Chains:**
- `CHAT_FAST`: gpt-4.1-mini → gpt-4o-mini → gpt-4o
- `GEMINI_CHAT`: gemini-2.5-flash-lite → gemini-1.5-flash
- `GEMINI_FLASH_LITE`: gemini-2.5-flash-lite → gemini-1.5-flash → gemini-2.5-flash
- `TRANSCRIBE_FAST`: gpt-4o-mini-transcribe → whisper-1
- `TRANSCRIBE_QUALITY`: gpt-4o-transcribe → whisper-1
- `GEMINI_VISION`: gemini-2.5-flash → gemini-1.5-flash

**Deprecation Handling:**
- Detects 404 / "not found" / "deprecated" errors
- Automatically rotates to next model in chain
- Preserves user override via globalThis

### Usage Service (`src/services/usage.js`)

**Purpose:** Credit enforcement and usage tracking.

**Key Functions:**
- `incrementUsageAndEnforce()` - Atomic credit debit with enforcement
- `getUsageForUid()` - Read usage statistics
- `setUsageForUid()` - Update usage statistics
- `isRestrictedUser()` - Check if user is restricted

**Credit Costs:**
- Text: 1 credit
- Voice: 1 credit
- Screenshot: 1 credit
- Highlight: 1 credit

**Enforcement:**
- Checks credit balance before action
- Deducts credits via backend API
- Shows access denied overlay when zero
- Lifetime users exempt

---

## Authentication & Plans

### Firebase Configuration (`firebase-config.js`)

**Firebase Project:**
- Project ID: `inshuverse-ai`
- Auth Domain: `inshuverse-ai.firebaseapp.com`
- Storage Bucket: `inshuverse-ai.firebasestorage.app`

**OAuth Configuration:**
- Client ID: `239383899102-lkbop8ke9nuf3fce14a3bnk89jd9htp5.apps.googleusercontent.com`
- Redirect URI: Dynamic `http://127.0.0.1:<port>`
- Scopes: `userinfo.email`, `userinfo.profile`, `openid`

**Backend API:**
- Development: `http://localhost:5000`
- Production: `https://inshuverse-ai.onrender.com`

### Plan Tiers (`src/auth/tiers.js`)

**Tier Classification:**

**Free Plan:**
- 7 complimentary credits
- OpenAI: DEFAULT_OPENAI_KEY (system shared)
- Gemini: FREE_GEMINI_KEY (system shared)

**Premium Plans (Pro, Ultimate, Magic):**
- 600-4000 credits (depending on plan)
- OpenAI: PREMIUM_OPENAI_KEY (system premium)
- Gemini: PREMIUM_GEMINI_KEY (system premium)

**Lifetime Plans:**
- Unlimited credits
- OpenAI: User's own key (bring-your-own-key)
- Gemini: User's own key (bring-your-own-key)
- Fallback to PREMIUM keys if user key not set

**API Key Routing:**
```javascript
function getOpenAIKey() {
  const tier = classifyPlan(APP_STATE.currentPlan.planName);
  if (tier === 'lifetime') return APP_STATE.lifetimeUserKeys.openai || '';
  if (tier === 'premium') return PREMIUM_OPENAI_KEY;
  return DEFAULT_OPENAI_KEY;
}
```

### Credit System

**Credit Allocation:**
- Free: 7 credits
- Pro: 600 credits
- Ultimate: 1500 credits
- Magic: 4000 credits
- Lifetime: Unlimited (exempt)

**Credit Debit Flow:**
1. User initiates action (voice, screenshot, etc.)
2. Main process checks credit balance
3. If > 0, proceed with action
4. Call backend `/api/credits/debit`
5. Backend validates and deducts
6. New balance returned
7. UI updated with new balance
8. If 0, show access denied overlay

**Security:**
- All credit mutations via Cloud Functions
- Firestore rules deny client-side writes
- Server derives UID from auth token
- Cannot debit another user's account

---

## Backend API

### Server (`backend/server.js`)

**Express.js server running on Render.com:**
- Port 5000 (default)
- CORS enabled
- JSON body parsing

**Routes:**
- `/api/user` - User plan management
- `/api/credits` - Credit operations
- `/` - Health check

### User Routes (`backend/routes/user.js`)

**Endpoints:**
- `GET /api/user/plan/:uid` - Get user plan and credits
- `POST /api/user/plan` - Create/update user plan (Cloud Function)

**Response Format:**
```json
{
  "success": true,
  "plan": "free",
  "credits": 7
}
```

### Credit Routes (`backend/routes/credits.js`)

**Endpoints:**
- `POST /api/credits/debit` - Deduct credits from user account

**Request Format:**
```json
{
  "uid": "user-uid",
  "amount": 1
}
```

**Response Format:**
```json
{
  "success": true,
  "previousCredits": 7,
  "remainingCredits": 6
}
```

### Firebase Integration

**Firestore Structure:**
```
users/{uid}
  ├── planId: "free"
  ├── credits: 7
  ├── createdAt: timestamp
  ├── updatedAt: timestamp
  └── openaiKey: "sk-..." (lifetime only)
```

**Security Rules:**
- Client-side reads allowed
- Client-side writes denied
- Cloud Functions only for mutations
- UID derived from auth token

---

## Deployment

### Building for Production

**Development:**
```bash
npm start
```

**Build:**
```bash
npm run dist
```

**Windows:**
```bash
npm run win
```

**Publish:**
```bash
npm run publish
```

### Electron Builder Configuration

**Build Settings:**
- App ID: `com.avtechsolutions.inshuverseai`
- Product Name: `InshuVerse AI`
- ASAR packaging enabled
- Output directory: `dist/`

**Windows Settings:**
- Target: NSIS installer
- Architecture: x64
- Icon: `assets/icons/icon.ico`
- One-click install disabled
- Allow elevation: true
- Desktop shortcut: yes
- Start menu shortcut: yes

**Auto-Update:**
- Provider: GitHub
- Owner: A-V-TechSolutions
- Repo: InshuVerse-AI
- Release type: release

### Environment Variables

**Required:**
- `DEFAULT_OPENAI_KEY` - Default OpenAI API key
- `PREMIUM_OPENAI_KEY` - Premium OpenAI API key
- `PREMIUM_GEMINI_KEY` - Premium Gemini API key
- `FREE_GEMINI_KEY` - Free tier Gemini API key
- `DEFAULT_DEEPGRAM_KEY` - Default Deepgram key
- `FREE_DEEPGRAM_KEY` - Free tier Deepgram key
- `ASSEMBLYAI_FREE_KEY` - Free AssemblyAI key
- `ASSEMBLYAI_PRO_KEY` - Premium AssemblyAI key

**Optional:**
- `NODE_ENV` - Development or production

### Dependencies

**Production:**
- `electron` ^37.2.0
- `electron-updater` ^6.6.2
- `firebase` ^11.0.2
- `openai` ^4.24.1
- `@google/generative-ai` ^0.24.1
- `axios` ^1.8.4
- `@nut-tree-fork/nut-js` ^4.2.6
- `mammoth` ^1.9.0
- `pdfjs-dist` 2.16.105
- `tmp` ^0.2.1
- `ws` ^8.20.0

**Development:**
- `electron-builder` ^25.1.8

---

## Security Considerations

### API Key Storage

**Encryption:**
- All vendor keys encrypted with AES-256-GCM
- Keys stored as ciphertext in source code
- Decrypted at runtime using crypto-vault
- Never exposed to renderer process

**Lifetime User Keys:**
- Stored in Firebase (encrypted at rest)
- Retrieved only for authenticated user
- Isolated per-user in KeyPool
- Never shared across users

### Authentication

**OAuth Flow:**
- PKCE-enabled Google OAuth
- Local HTTP server for callback
- Access token exchanged for Firebase credential
- Refresh token persisted for silent sign-in

**Session Management:**
- Firebase Auth persistence enabled
- Silent sign-in on app launch
- Session tokens validated by backend

### Credit System

**Server-Side Enforcement:**
- All credit mutations via Cloud Functions
- Firestore rules deny client-side writes
- UID derived from auth token (not client-provided)
- Atomic debit operations

**Rate Limiting:**
- Per-user credit caps
- Plan-based feature gating
- Backend validates all operations

### Hide Mode Security

**OS-Level Protection:**
- Uses native content protection APIs
- Cannot be bypassed by screen capture software
- Periodic re-assertion for reliability
- Safe Mode for problematic drivers

**Translocation Detection:**
- Detects macOS App Translocation
- Warns user to move to /Applications
- Protection may not work in translocated state

---

## Troubleshooting

### Hide Mode Not Working

**Windows:**
- Check Windows build (must be 10 1903+)
- Enable Safe Mode in Settings
- Restart application
- Check for GPU driver updates

**macOS:**
- Move app to /Applications folder
- Check for App Translocation
- Restart application
- Check macOS version compatibility

### Transcription Failures

**Common Issues:**
- Audio too short (speak for 0.5s+)
- Invalid audio format
- API key quota exceeded
- Network connectivity

**Solutions:**
- Check microphone permissions
- Verify API keys in Settings
- Check credit balance
- Try different model selection

### Screenshot Failures

**Common Issues:**
- Screen capture permissions denied
- API key quota exceeded
- Image too large
- Network connectivity

**Solutions:**
- Grant screen recording permissions (macOS)
- Verify API keys in Settings
- Check credit balance
- Try different model selection

### Authentication Issues

**Common Issues:**
- OAuth callback fails
- Firebase auth error
- Backend unreachable
- Invalid credentials

**Solutions:**
- Check network connectivity
- Verify Firebase configuration
- Check backend status
- Clear app data and retry

---

## Performance Optimizations

### API Key Rotation

**KeyPool Benefits:**
- Automatic failover on quota errors
- Cooldown prevents hammering failing keys
- Round-robin distributes load
- Isolation prevents cross-user contamination

### Model Registry

**Deprecation Handling:**
- Automatic model version rotation
- No code changes needed for model updates
- Preserves user preferences
- Graceful degradation

### Streaming

**OpenAI:**
- Per-token streaming (natural pacing)
- 50% input-token discount with prefix caching
- Stable system prefix for cache hits

**Gemini:**
- Smooth delta slicing for typewriter effect
- Degeneracy detection prevents repetition
- Fallback to non-streaming on errors

### Credit Optimization

**Sequential Fallback:**
- Single request per interaction (no parallel racing)
- Reduces credit consumption
- Faster than parallel (no waiting for slowest)
- Key-aware (skips missing keys)

---

## Future Enhancements

### Planned Features

1. **RAG (Retrieval Augmented Generation):**
   - Local knowledge base
   - Document upload and indexing
   - Context-aware responses

2. **Multi-Language Support:**
   - UI localization
   - Better language detection
   - Translation features

3. **Advanced Screenshot Modes:**
   - Multi-screenshot analysis
   - Region selection
   - Video analysis

4. **Collaboration Features:**
   - Session sharing
   - Team plans
   - Admin dashboard

5. **Mobile App:**
   - React Native implementation
   - Cross-platform support
   - Sync with desktop

### Technical Debt

1. **Modularization:**
   - Split index.html into components
   - Separate renderer logic
   - Better code organization

2. **Testing:**
   - Increase test coverage
   - E2E testing with Playwright
   - Integration tests for IPC

3. **Error Handling:**
   - Global error boundary
   - Better error messages
   - Error reporting

4. **Documentation:**
   - API documentation
   - Contribution guidelines
   - Architecture diagrams

---

## Contributing

### Development Setup

1. Clone repository
2. Install dependencies: `npm install`
3. Start development: `npm start`
4. Make changes
5. Test thoroughly
6. Submit pull request

### Code Style

- Use ES6+ features
- Follow existing patterns
- Add comments for complex logic
- Update documentation

### Testing

- Unit tests for services
- Integration tests for IPC
- Manual testing for UI
- Platform-specific testing (macOS, Windows)

---

## License

MIT License - Copyright © 2026 A&V Techsolutions

---

## Contact

- **Email:** avtechsolutions312@gmail.com
- **GitHub:** https://github.com/A-V-TechSolutions/InshuVerse-AI
- **Website:** https://inshuverse-ai.onrender.com

---

## Changelog

### Version 6.0.7 (Current)
- Simplified Hide Mode transparency logic
- Removed localStorage dependency for transparency
- Fixed Hide Mode auto-restore
- Improved error handling
- Performance optimizations

### Version 6.0.6
- Added KeyPool for API key rotation
- Implemented model registry
- Added RAG support
- Improved streaming performance

### Version 6.0.5
- Added Ghost Typing for macOS
- Improved Hide Mode reliability
- Added Safe Mode
- Better Windows support

### Version 6.0.0
- Major architecture refactor
- Modularized services
- Centralized state management
- Improved IPC communication
