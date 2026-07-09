/* Lightweight Product Tour (Express + Interactive hooks)
   - Auto-starts for Free users (renderer calls Tour.start('express'))
   - Premium can start from Settings via window.Tour.start('interactive')
*/
(function(){
  const STORAGE_KEY = 'tourCompleted_v4';

  function qs(sel){ return document.querySelector(sel); }
  function inViewport(el){ if(!el) return false; const r = el.getBoundingClientRect(); return r.width>0 && r.height>0; }

  function createOverlay(){
    let overlay = document.getElementById('productTourOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'productTourOverlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '999999';
    overlay.style.pointerEvents = 'none';

    // Backdrop
    const dim = document.createElement('div');
    dim.style.position = 'absolute';
    dim.style.inset = '0';
    dim.style.background = 'rgba(0,0,0,0.5)';
    dim.style.backdropFilter = 'blur(2px)';
    dim.style.pointerEvents = 'auto';
    dim.addEventListener('click', () => {
      // Treat clicking outside as skipping the tour and persist completion
      finish();
    });
    overlay.appendChild(dim);

    // Highlight box
    const hl = document.createElement('div');
    hl.id = 'tourHighlight';
    hl.style.position = 'fixed';
    hl.style.border = '2px solid #8b5cf6';
    hl.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.5)';
    hl.style.borderRadius = '10px';
    hl.style.transition = 'all .2s ease';
    hl.style.pointerEvents = 'none';
    overlay.appendChild(hl);

    // Tooltip card
    const card = document.createElement('div');
    card.id = 'tourCard';
    card.style.position = 'fixed';
    card.style.maxWidth = '320px';
    card.style.background = 'white';
    card.style.color = '#111827';
    card.style.borderRadius = '10px';
    card.style.border = '1px solid #e5e7eb';
    card.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
    card.style.padding = '12px 12px';
    card.style.fontFamily = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    card.style.pointerEvents = 'auto';

    const title = document.createElement('div');
    title.id = 'tourTitle';
    title.style.fontWeight = '700';
    title.style.fontSize = '14px';
    title.style.marginBottom = '6px';

    const body = document.createElement('div');
    body.id = 'tourBody';
    body.style.fontSize = '12px';
    body.style.color = '#374151';
    body.style.lineHeight = '1.35';
    body.style.marginBottom = '10px';

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'space-between';
    btnRow.style.gap = '8px';

    const left = document.createElement('div');
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '6px';

    function mkBtn(label, kind){
      const b = document.createElement('button');
      b.textContent = label;
      b.style.fontSize = '12px';
      b.style.fontWeight = '600';
      b.style.padding = '6px 10px';
      b.style.borderRadius = '8px';
      b.style.cursor = 'pointer';
      if (kind === 'primary') {
        b.style.background = 'linear-gradient(135deg,#6366f1,#8b5cf6)';
        b.style.color = 'white';
        b.style.border = 'none';
      } else if (kind === 'ghost') {
        b.style.background = 'transparent';
        b.style.color = '#6b7280';
        b.style.border = '1px solid #e5e7eb';
      } else {
        b.style.background = '#f3f4f6';
        b.style.color = '#111827';
        b.style.border = '1px solid #e5e7eb';
      }
      return b;
    }

    const skipBtn = mkBtn('Skip', 'ghost');
    const backBtn = mkBtn('Back', 'ghost');
    const nextBtn = mkBtn('Next', 'primary');

    left.appendChild(skipBtn);
    right.appendChild(backBtn);
    right.appendChild(nextBtn);

    btnRow.appendChild(left);
    btnRow.appendChild(right);

    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(btnRow);

    overlay.appendChild(card);

    document.body.appendChild(overlay);

    return { overlay, dim, hl, card, title, body, skipBtn, backBtn, nextBtn };
  }

  function place(els, target){
    const r = target.getBoundingClientRect();
    const pad = 8;
    els.hl.style.left = (r.left - pad) + 'px';
    els.hl.style.top = (r.top - pad) + 'px';
    els.hl.style.width = (r.width + pad*2) + 'px';
    els.hl.style.height = (r.height + pad*2) + 'px';

    // Default: show card below
    let cx = Math.min(window.innerWidth - 340, Math.max(12, r.left));
    let cy = r.bottom + 10;

    if (cy + 160 > window.innerHeight) {
      // Move above if not enough space below
      cy = Math.max(12, r.top - 170);
    }

    els.card.style.left = cx + 'px';
    els.card.style.top = cy + 'px';
  }

  function finish(){ try { localStorage.setItem(STORAGE_KEY, '1'); } catch(_){} remove(); }
  function remove(){ const el = document.getElementById('productTourOverlay'); if (el) el.remove(); }

  function steps(kind){
    const s = [];

    // Camera / Screenshots
    s.push({ selector: '#btnScreenshot', title: 'Camera (Screenshots)', body: 'Analyze your entire screen in one click. Tip: turn on Hide mode first for best results. Shortcuts: Cmd/Ctrl+Shift+S (Universal), Cmd/Ctrl+H (in‑app).' });

    // Microphone
    s.push({ selector: '#micButton', title: 'Microphone', body: 'Start/stop recording whenever you want (Spacebar works too). Angel transcribes and answers according to your profile.' });

    // Chat (Text Mode)
    s.push({ selector: '#toggleInputModeButton', title: 'Chat (Text mode)', body: 'If you miss anything or want quick answers, switch to text and type. Press Enter to send.' });

    // Hide mode
    s.push({ selector: '#screenSharingMode', title: 'Hide during screen share', body: 'Make Angel invisible while sharing your screen — only you can see it.' });

    // Settings overview
    s.push({ selector: '.settings-button, #openAIGear, #settingsOpenBtn', title: 'Settings', body: 'Change Answer Size, Themes, Audio preferences, Screenshot reply style, and more. Also check Shortcuts to work faster instead of clicking.' });

    // Reset
    s.push({ selector: '#resetButton', title: 'Reset conversation', body: 'Clear the current conversation and start fresh.' });

    if (kind === 'interactive') {
      s.push({ selector: '#micButton', title: 'Try it live (optional)', body: 'Start mic now to try a sample. Note: real usage will consume credits as usual.' });
    }
    return s;
  }

  function start(kind='express'){
    try {
      const tourSteps = steps(kind);
      const els = createOverlay();
      let idx = 0;

      function render(){
        // Find next visible target
        let target = null;
        let tries = 0;
        while (idx >=0 && idx < tourSteps.length && tries < tourSteps.length){
          const s = tourSteps[idx];
          target = qs(s.selector);
          if (target && inViewport(target)) break;
          idx += 1; tries += 1;
        }
        if (!target || idx >= tourSteps.length){ finish(); return; }
        els.title.textContent = tourSteps[idx].title;
        els.body.textContent = tourSteps[idx].body;
        place(els, target);

        els.backBtn.disabled = (idx === 0);
        els.nextBtn.textContent = (idx === tourSteps.length - 1) ? 'Done' : 'Next';
      }

      els.nextBtn.onclick = () => { if (idx < steps(kind).length - 1) { idx++; render(); } else { finish(); } };
      els.backBtn.onclick = () => { if (idx > 0) { idx--; render(); } };
      els.skipBtn.onclick = () => { finish(); };

      // Close on Escape key as a skip action
      window.addEventListener('keydown', (e) => { if (e && e.key === 'Escape') finish(); });

      window.addEventListener('resize', () => {
        try {
          const s = tourSteps[idx];
          const target = s && qs(s.selector);
          if (target) place(els, target);
        } catch(_){}
      });

      render();
    } catch (e) {
      console.warn('Tour start failed:', e);
      remove();
    }
  }

  function maybeStartAuto(){
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') return;
      start('express');
    } catch(_){}
  }

  window.Tour = { start, maybeStartAuto };
})();

