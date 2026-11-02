'use strict';
(() => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system', palette = 'grafito';
  try {
    const m = localStorage.getItem('deck-modo') || localStorage.getItem('deck-theme');
    const p = localStorage.getItem('deck-tema');
    if (['system', 'light', 'dark'].includes(m)) mode = m;
    if (['grafito', 'papel', 'oceano'].includes(p)) palette = p;
  } catch { /* Preferences still work for this page. */ }
  const apply = () => {
    document.documentElement.dataset.theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    document.documentElement.dataset.palette = palette;
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const pick = document.getElementById('palette'); if (pick) pick.value = palette;
  };
  window.DeckAppearance = { set(key, value) {
    if (key === 'mode' && ['system', 'light', 'dark'].includes(value)) mode = value;
    else if (key === 'palette' && ['grafito', 'papel', 'oceano'].includes(value)) palette = value;
    else return;
    try { localStorage.setItem('deck-modo', mode); localStorage.setItem('deck-tema', palette); } catch { /* Keep in memory. */ }
    apply();
  }, apply };
  apply(); media.addEventListener('change', apply);
})();
