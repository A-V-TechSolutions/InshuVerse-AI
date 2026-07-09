// Fix for chat scrolling and window dragging issues

// Add scrollable behavior to chat messages
const style = document.createElement('style');
style.textContent = `
  .chat-messages {
    overflow-y: auto;
    scrollbar-width: thin;
    /* Critical: constrains the flex child so its bounding box never extends
       beyond the parent, which would cause its no-drag region to bleed into
       the draggable header area at the OS hit-test level. */
    min-height: 0;
  }

  .chat-messages::-webkit-scrollbar {
    width: 6px;
  }

  .chat-messages::-webkit-scrollbar-thumb {
    background: rgba(99, 102, 241, 0.5);
    border-radius: 3px;
  }

  .chat-messages::-webkit-scrollbar-thumb:hover {
    background: var(--primary);
  }

  /* Draggable header – the actual drag strip is #draggableHeader, not .header.
     We do NOT apply -webkit-app-region: drag to .header to avoid accidentally
     making child interactive elements non-draggable. The #draggableHeader rules
     in index.html already handle this with !important selectors. */

  /* Make interactive elements inside controls non-draggable */
  .controls *, .modal *, #screenSharingIndicator, #responseCounter {
    -webkit-app-region: no-drag;
  }

  /* Ensure chat message content never acts as a drag handle */
  .chat-messages, .chat-messages * {
    -webkit-app-region: no-drag !important;
    pointer-events: auto;
  }

  /*
   * Draggable header — #draggableHeader is now position:absolute + last child of
   * #appContent so it is painted on top of every sibling in stacking order.
   * z-index:100 matches the value in index.html and ensures the OS-level
   * -webkit-app-region drag hit-test always resolves to this element first,
   * regardless of how tall the chat messages bounding box is.
   */
  #draggableHeader {
    -webkit-app-region: drag !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    z-index: 100 !important;
  }
  /* Non-interactive header children: keep drag region, suppress pointer capture
     so mouse-move events bubble up to the drag handler correctly. */
  #draggableHeader img,
  #draggableHeader span,
  #draggableHeader div:not(button):not(input):not(select):not(textarea) {
    -webkit-app-region: drag !important;
    pointer-events: none;
  }
  /* Interactive header elements must never block dragging */
  #draggableHeader button,
  #draggableHeader input,
  #draggableHeader select,
  #draggableHeader textarea,
  #draggableHeader .no-drag {
    -webkit-app-region: no-drag !important;
    pointer-events: auto !important;
  }
`;
document.head.appendChild(style);

// Auto-hide screen sharing indicator after 3 seconds
function autoHideScreenSharingIndicator() {
  const indicator = document.getElementById('screenSharingIndicator');
  if (indicator && indicator.classList.contains('show')) {
    setTimeout(() => {
      indicator.classList.remove('show');
    }, 3000);
  }
}

// Hook into the screen sharing toggle
const originalToggleFunction = screenSharingToggle.addEventListener;
screenSharingToggle.addEventListener('change', function(e) {
  // Call the original functionality
  originalToggleFunction.call(this, e);
  
  // Add auto-hide behavior
  if (e.target.checked) {
    autoHideScreenSharingIndicator();
  }
});

// Also monitor for programmatic changes
const observer = new MutationObserver(function(mutations) {
  mutations.forEach(function(mutation) {
    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
      const indicator = document.getElementById('screenSharingIndicator');
      if (indicator && indicator.classList.contains('show')) {
        autoHideScreenSharingIndicator();
      }
    }
  });
});

const indicator = document.getElementById('screenSharingIndicator');
if (indicator) {
  observer.observe(indicator, { attributes: true });
}

console.log('Fixes applied: chat scrolling, window dragging, and screen sharing auto-hide');
