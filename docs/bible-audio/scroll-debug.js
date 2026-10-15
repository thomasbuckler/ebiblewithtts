// Diagnostic panel for unexpected scrolling, shown only when the address
// ends in #scrolldebug. Newest events first; nothing is cleared.
function startScrollDebug() {
  const panel = document.createElement('pre');
  panel.style.cssText = 'position:fixed;z-index:99;left:2px;right:2px;bottom:2px;max-height:55vh;overflow:hidden;margin:0;padding:4px;font:10px/1.3 monospace;background:rgba(255,255,230,.97);color:#000;border:1px solid #999;border-radius:4px;pointer-events:none;white-space:pre-wrap';
  const marker = document.createElement('div');
  marker.textContent = 'TOP OF PAGE';
  marker.style.cssText = 'position:fixed;z-index:99;top:0;left:50%;transform:translateX(-50%);font:bold 10px monospace;background:#f0f;color:#fff;padding:1px 6px;pointer-events:none';
  const lines = [];
  const t0 = performance.now();
  const vv = window.visualViewport;
  const name = el => !el || el === document ? 'document' : el === window ? 'window'
    : el.nodeType !== 1 ? el.nodeName
    : `${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(' ').filter(Boolean).slice(0, 2).join('.')}`;
  const r = n => Math.round(n);
  function state() {
    const view = [...document.querySelectorAll('div.fixed.inset-0')].find(d => !d.classList.contains('hidden') && d.getClientRects().length) || null;
    const list = view?.querySelector('.overflow-y-auto');
    const header = view?.querySelector('header');
    const input = view?.querySelector('input');
    const top = document.elementFromPoint(innerWidth / 2, 3);
    return [
      `win ${r(scrollY)} body ${r(document.body.scrollTop)} | vv top ${vv ? r(vv.offsetTop) : '-'} pageTop ${vv ? r(vv.pageTop) : '-'} h ${vv ? r(vv.height) : '-'} | innerH ${innerHeight} screenH ${screen.height}`,
      `view top ${view ? r(view.getBoundingClientRect().top) : '-'} h ${view ? r(view.getBoundingClientRect().height) : '-'} | list scroll ${list ? r(list.scrollTop) : '-'} | header top ${header ? r(header.getBoundingClientRect().top) : '-'} | input top ${input ? r(input.getBoundingClientRect().top) : '-'}`,
      `at top of screen: ${name(top)} "${(top?.textContent || '').trim().slice(0, 20)}" | focused: ${name(document.activeElement)}`,
    ].join('\n');
  }
  function render() { panel.textContent = `SCROLL DEBUG v4\n${state()}\n---\n${lines.join('\n')}`; }
  const log = text => {
    lines.unshift(`${((performance.now() - t0) / 1000).toFixed(2)} ${text}`);
    lines.length = Math.min(lines.length, 30);
    render();
  };
  document.addEventListener('scroll', e => log(`scroll ${name(e.target)} -> ${r(e.target.scrollTop ?? scrollY)}`), true);
  vv?.addEventListener('resize', () => log(`vv resize h ${r(vv.height)} top ${r(vv.offsetTop)}`));
  vv?.addEventListener('scroll', () => log(`vv pan top ${r(vv.offsetTop)} pageTop ${r(vv.pageTop)}`));
  window.addEventListener('resize', () => log(`win resize innerH ${innerHeight}`));
  for (const type of ['touchstart', 'touchend', 'focusin', 'focusout']) {
    document.addEventListener(type, e => log(`${type} ${name(e.target)}`), true);
  }
  setInterval(() => {
    if (document.body && !panel.isConnected) document.body.append(panel);
    if (document.body && !marker.isConnected) document.body.append(marker);
    render();
  }, 250);
  log('ready');
}
if (location.hash.includes('scrolldebug')) startScrollDebug();
else window.addEventListener('hashchange', function once() {
  if (!location.hash.includes('scrolldebug')) return;
  window.removeEventListener('hashchange', once);
  startScrollDebug();
});
