// src/renderer/messageFormatter.js
// Centralized final formatter for chat messages
// - Preserves fenced code blocks with copy buttons
// - Renders inline code, bold, italics
// - Cleans stray <br> around code blocks

function escHtml(s) {
  const d = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (d) { d.textContent = s; return d.innerHTML; }
  // Fallback for non-DOM environments (should not happen in renderer)
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMessageContent(text) {
  let formatted = text || '';
  const blocks = [];
  const inlines = [];
  // 0) Normalize unbalanced code fences by auto-closing if an odd count is detected
  try {
    const fenceList = ['```', '~~~', "'''"];
    for (const f of fenceList) {
      const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const count = (formatted.match(re) || []).length;
      if (count % 2 === 1) {
        formatted += '\n' + f + '\n';
      }
    }
  } catch (_) { /* ignore */ }
  // 1) Extract fenced code blocks first (protect them)
  formatted = formatted.replace(/(```|~~~|''')(\w+)?([\s\S]*?)\1/g, (m, fence, lang, code) => {
    let trimmed = (code || '').trim();
    // Remove standalone 'Copy' lines and common artifacts inside code
    trimmed = trimmed
      .replace(/^\s*(?:Copy|Copy code)\s*$(?:\r?\n)?/gim, '')
      .replace(/[ \t]*Copy(?:\r?\n|$)/g, '\n');

    // If no language was provided, infer from the first line if it looks like a lang tag
    let inferredLang = lang;
    if (!inferredLang) {
      const lines = trimmed.split(/\r?\n/);
      const first = (lines[0] || '').trim();
      const known = ['js','javascript','ts','tsx','jsx','java','python','py','go','golang','c','cpp','c++','c#','cs','ruby','rb','php','swift','kotlin','scala','rust','rs','bash','shell','sh','powershell','ps1','html','css','json','yaml','yml','sql'];
      // Accept either exact match ("java") or leading token ("java something...")
      const m1 = first.match(/^([A-Za-z0-9+#.\-]+)\b(.*)$/);
      if (m1 && known.includes(m1[1].toLowerCase())) {
        inferredLang = m1[1].toLowerCase();
        // Remove only the language token from the first line, keep the rest if meaningful
        const rest = (m1[2] || '').trim();
        lines[0] = rest;
        trimmed = lines.join('\n').replace(/^\n+/, '');
      }
    }

    const cleaned = trimmed;
    const html = inferredLang
      ? `<pre><code class="language-${inferredLang}">${escHtml(cleaned)}</code><button class="copy-button">Copy</button></pre>`
      : `<pre><code>${escHtml(cleaned)}</code><button class="copy-button">Copy</button></pre>`;
    const token = `@@BLOCK_${blocks.length}@@`;
    blocks.push(html);
    return token;
  });
  // 2) Extract inline code spans (protect them)
  formatted = formatted.replace(/`([^`]+)`/g, (m, c) => {
    const html = `<code>${escHtml(c)}</code>`;
    const token = `@@INLINE_${inlines.length}@@`;
    inlines.push(html);
    return token;
  });
  // 2.5) Remove 'Copy' artifacts in remaining (non-code, non-inline) text
  // - remove standalone lines that say 'Copy' or 'Copy code'
  formatted = formatted.replace(/^\s*(?:Copy|Copy code)\s*$\n?/gim, '');
  // - remove trailing 'Copy' at end of lines
  formatted = formatted.replace(/[ \t]*Copy(?=\s*(?:\n|$))/g, '');
  // 3) Apply bold and italics outside code
  // Bold: **text** or __text__
  formatted = formatted.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>');
  // Italic: *text* or _text_ (avoid matching ** or __)
  formatted = formatted.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  formatted = formatted.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  // 4) Line breaks to <br>
  // Defer generic line-break conversion; first handle headings and lists.
  // We'll build minimal Markdown for headings and lists.
  const lines = formatted.split(/\n/);
  let htmlParts = [];
  let inUL = false, inOL = false;
  function closeLists() {
    if (inUL) { htmlParts.push('</ul>'); inUL = false; }
    if (inOL) { htmlParts.push('</ol>'); inOL = false; }
  }
  // Blank-line handler: close UL but keep OL open so "loose" ordered lists
  // (AI outputs blank lines between numbered items) don't reset the counter.
  function closeListsKeepOL() {
    if (inUL) { htmlParts.push('</ul>'); inUL = false; }
    // intentionally do NOT close the OL
  }
  for (let raw of lines) {
    const line = raw.trim();
    // Special-case common section headers without leading '#', with optional colon and (s)
    const sec = line.match(/^(question(?:\(s\))?|questions|answer(?:\(s\))?|answers|explanation)\s*:?\s*$/i);
    if (sec) {
      closeLists();
      let title = sec[1];
      title = title.replace(/\(s\)/i, 's');
      // Normalize first-letter upper-case
      title = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
      htmlParts.push(`<h3>${title}</h3>`);
      continue;
    }
    // Heading: #..###### Title
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      closeLists();
      const level = Math.min(6, h[1].length);
      htmlParts.push(`<h${level}>${h[2]}</h${level}>`);
      continue;
    }
    // Unordered list item: -, *, +
    const ul = line.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      if (!inUL) { closeLists(); htmlParts.push('<ul>'); inUL = true; }
      htmlParts.push(`<li>${ul[1]}</li>`);
      continue;
    }
    // Ordered list item: 1. text or 1) text
    const ol = line.match(/^(?:\d+\.|\d+\))\s+(.+)$/);
    if (ol) {
      if (!inOL) { closeLists(); htmlParts.push('<ol>'); inOL = true; }
      htmlParts.push(`<li>${ol[1]}</li>`);
      continue;
    }
    // Empty line -> paragraph break; keep OL alive for loose ordered lists
    if (line === '') {
      closeListsKeepOL();
      htmlParts.push('<br>');
      continue;
    }
    // Normal text line
    closeLists();
    htmlParts.push(`${raw}`);
  }
  closeLists();
  formatted = htmlParts.join('\n');
  // Convert remaining newlines to <br>
  formatted = formatted.replace(/\n/g, '<br>');
  // 5) Restore inline/code blocks
  formatted = formatted.replace(/@@INLINE_(\d+)@@/g, (_, i) => inlines[Number(i)] || '');
  formatted = formatted.replace(/@@BLOCK_(\d+)@@/g, (_, i) => blocks[Number(i)] || '');
  // 5.5) Remove any stray standalone fence lines left in plain text
  formatted = formatted.replace(/^\s*(?:```|~~~|''')\s*$\n?/gm, '');
  // 6) Render any plain @@PLACEHOLDER@@ tokens that may exist in the source text
  // Exclude our internal placeholders that were already restored; support spaces inside
  formatted = formatted.replace(/@@(?!BLOCK_|INLINE_)([\s\S]*?)@@/g, (_, c) => `<code>${(c || '').trim()}</code>`);
  // Also render bare INLINE<number> tokens as inline code in remaining (non-code) text
  formatted = formatted.replace(/\bINLINE\d+\b/g, m => `<code>${m}</code>`);
  // 7) Remove stray <br> around code blocks to avoid extra vertical gaps
  formatted = formatted
    .replace(/<br>\s*(<pre>)/g, '$1')
    .replace(/(<\/pre>)\s*<br>/g, '$1');
  // Collapse multiple <br> into a single one
  formatted = formatted.replace(/(?:<br>\s*){2,}/g, '<br>');
  // 8) Final trim
  formatted = formatted.trim();
  return formatted;
}

module.exports = { formatMessageContent };
