// Diagnostic overlay for unexpected scrolling, shown only when the address
// ends in #scrolldebug. It lists which element scrolled, the window and
// visual-viewport positions, and focus changes, newest first.
function startScrollDebug() {
  const panel = document.createElement('pre');
  panel.style.cssText = 'position:fixed;z-index:99;left:4px;right:4px;bottom:4px;max-height:42vh;overflow:auto;margin:0;padding:6px;font:11px/1.35 monospace;background:rgba(255,255,230,.96);color:#000;border:1px solid #999;border-radius:6px;pointer-events:none;white-space:pre-wrap';
  const lines = [];
  let t0 = performance.now();
  const vv = window.visualViewport;
  const name = el => !el || el === document ? 'document' : el === window ? 'window'
    : `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ').slice(0, 3).join('.')}`;
  const state = () => `win ${Math.round(scrollY)} | vv top ${vv ? vv.offsetTop.toFixed(0) : '-'} page ${vv ? vv.pageTop.toFixed(0) : '-'} h ${vv ? vv.height.toFixed(0) : '-'} scale ${vv ? vv.scale.toFixed(2) : '-'} | innerH ${innerHeight}`;
  const log = text => {
    lines.unshift(`${((performance.now() - t0) / 1000).toFixed(2)}s ${text}`);
    lines.length = Math.min(lines.length, 40);
    panel.textContent = `SCROLL DEBUG (screenshot this)\n${state()}\n` + lines.join('\n');
  };
  document.addEventListener('scroll', e => log(`scroll ${name(e.target)} -> ${Math.round(e.target.scrollTop ?? scrollY)}`), true);
  window.addEventListener('scroll', () => log(`scroll window -> ${Math.round(scrollY)}`));
  vv?.addEventListener('resize', () => log(`viewport resize h ${vv.height.toFixed(0)} top ${vv.offsetTop.toFixed(0)}`));
  vv?.addEventListener('scroll', () => log(`viewport pan top ${vv.offsetTop.toFixed(0)} pageTop ${vv.pageTop.toFixed(0)}`));
  window.addEventListener('resize', () => log(`window resize innerH ${innerHeight}`));
  document.addEventListener('focusin', e => { t0 = performance.now(); lines.length = 0; log(`focus ${name(e.target)}`); });
  document.addEventListener('pointerdown', e => log(`tap ${name(e.target)}`), true);
  const header = () => [...document.querySelectorAll('header')].find(h => h.offsetParent);
  setInterval(() => {
    const h = header();
    const top = h ? Math.round(h.getBoundingClientRect().top) : '-';
    panel.dataset.headerTop = top;
    panel.textContent = panel.textContent.replace(/^SCROLL DEBUG.*\n.*\n/, `SCROLL DEBUG (screenshot this) header top ${top}\n${state()}\n`);
  }, 250);
  // The app takes over the page after it loads; keep the panel attached.
  setInterval(() => { if (document.body && !panel.isConnected) document.body.append(panel); }, 300);
  log('ready');
}
if (location.hash.includes('scrolldebug')) startScrollDebug();
else window.addEventListener('hashchange', function once() {
  if (!location.hash.includes('scrolldebug')) return;
  window.removeEventListener('hashchange', once);
  startScrollDebug();
});
