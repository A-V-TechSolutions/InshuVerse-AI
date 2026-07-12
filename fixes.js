// Fixes for chat scrolling, window dragging, and screen-sharing indicator.
// Restructured from the previous fixes.js: same external behavior and
// load order (still the last <script> tag), but organized into small
// named functions instead of top-level statements, with a couple of
// real bug fixes called out below.
(function () {
  'use strict';

  const CONFIG = {
    screenShareIndicatorId: 'screenSharingIndicator',
    screenShareToggleId: 'screenSharingToggle',
    responseCounterId: 'responseCounter',
    draggableHeaderId: 'draggableHeader',
    autoHideDelayMs: 3000,
  };

  /* ── 1. Layout fix: chat scroll + window drag region ─────────────── */
  function injectLayoutStyles() {
    const style = document.createElement('style');
    style.id = 'fixes-layout-style';
    style.textContent = `
      .chat-messages {
        overflow-y: auto;
        scrollbar-width: thin;
        /* Critical: constrains the flex child so its bounding box never
           extends beyond the parent, which would cause its no-drag
           region to bleed into the draggable header area at the OS
           hit-test level. */
        min-height: 0;
      }

      .chat-messages::-webkit-scrollbar { width: 6px; }
      .chat-messages::-webkit-scrollbar-thumb {
        background: rgba(99, 102, 241, 0.5);
        border-radius: 3px;
      }
      .chat-messages::-webkit-scrollbar-thumb:hover {
        background: var(--primary);
      }

      /* Draggable header — the actual drag strip is #draggableHeader,
         not .header. We do NOT apply -webkit-app-region: drag to .header
         to avoid accidentally making child interactive elements
         non-draggable. */
      .controls *, .modal *, #${CONFIG.screenShareIndicatorId}, #${CONFIG.responseCounterId} {
        -webkit-app-region: no-drag;
      }

      /* Ensure chat message content never acts as a drag handle */
      .chat-messages, .chat-messages * {
        -webkit-app-region: no-drag !important;
        pointer-events: auto;
      }

      /*
       * #draggableHeader is position:absolute + last child of #appContent
       * so it paints on top of every sibling in stacking order. z-index:100
       * matches index.html and ensures the OS-level drag hit-test always
       * resolves to this element first, regardless of chat-messages height.
       */
      #${CONFIG.draggableHeaderId} {
        -webkit-app-region: drag !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        z-index: 100 !important;
      }
      #${CONFIG.draggableHeaderId} img,
      #${CONFIG.draggableHeaderId} span,
      #${CONFIG.draggableHeaderId} div:not(button):not(input):not(select):not(textarea) {
        -webkit-app-region: drag !important;
        pointer-events: none;
      }
      #${CONFIG.draggableHeaderId} button,
      #${CONFIG.draggableHeaderId} input,
      #${CONFIG.draggableHeaderId} select,
      #${CONFIG.draggableHeaderId} textarea,
      #${CONFIG.draggableHeaderId} .no-drag {
        -webkit-app-region: no-drag !important;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);
  }

  /* ── 2. Screen-sharing indicator auto-hide ────────────────────────
     Bug fix from the previous version: the old code did
       const originalToggleFunction = screenSharingToggle.addEventListener;
       ...
       originalToggleFunction.call(this, e);
     which calls addEventListener(event) — not a valid signature — so
     that line silently did nothing. It's unnecessary anyway: multiple
     'change' listeners on the same element don't overwrite each other,
     so we just add ours directly. We also debounce so rapid show/hide
     toggling can't stack multiple pending timeouts. */
  function setupScreenShareAutoHide() {
    const indicator = document.getElementById(CONFIG.screenShareIndicatorId);
    const toggle = document.getElementById(CONFIG.screenShareToggleId);
    if (!indicator) return;

    let hideTimer = null;
    const scheduleHide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        indicator.classList.remove('show');
      }, CONFIG.autoHideDelayMs);
    };

    if (toggle) {
      toggle.addEventListener('change', (e) => {
        if (e.target.checked) scheduleHide();
        else clearTimeout(hideTimer);
      });
    }

    // Also cover programmatic class changes (e.g. triggered from IPC
    // rather than the checkbox), same as before.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          if (indicator.classList.contains('show')) scheduleHide();
        }
      }
    });
    observer.observe(indicator, { attributes: true });

    // Renderer processes in Electron can live a long time; disconnect
    // the observer and clear any pending timer on unload to avoid leaks.
    window.addEventListener('beforeunload', () => {
      clearTimeout(hideTimer);
      observer.disconnect();
    });
  }

  /* ── 3. Boot ───────────────────────────────────────────────────── */
  function init() {
    injectLayoutStyles();
    setupScreenShareAutoHide();
    console.log('Fixes applied: chat scrolling, window dragging, and screen sharing auto-hide');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();