(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('[data-install-tab]')];
  const panels = [...document.querySelectorAll('[data-install-panel]')];
  function selectInstall(name, focus = false) {
    for (const tab of tabs) {
      const selected = tab.dataset.installTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.installPanel !== name;
    history.replaceState(null, '', '#install-' + name);
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectInstall(tab.dataset.installTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectInstall(tabs[next].dataset.installTab, true);
    });
  });
  const requested = location.hash.match(/^#install-(windows|linux|cia|3dsx)$/)?.[1];
  if (requested) selectInstall(requested);
  document.getElementById('copy-cia')?.addEventListener('click', async event => {
    try {
      await navigator.clipboard.writeText(document.getElementById('cia-url').textContent);
      event.currentTarget.textContent = 'Copied';
      setTimeout(() => { event.currentTarget.textContent = 'Copy CIA URL'; }, 1500);
    } catch {
      event.currentTarget.textContent = 'Select the URL below';
    }
  });
  fetch('/api/status', { cache: 'no-store' }).then(async response => {
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error();
    document.body.classList.add('ready');
    const registered = data.registered != null ? ' · ' + data.registered + ' identities' : '';
    const peak = data.peak24h != null ? ' · 24h peak ' + data.peak24h : '';
    document.getElementById('status').textContent = 'Online · ' + data.authenticated + ' trainer' + (data.authenticated === 1 ? '' : 's') + registered + peak;
  }).catch(() => { document.getElementById('status').textContent = 'Multiplayer status unavailable'; });
  fetch('/api/public-status', { cache: 'no-store' }).then(async response => {
    const data = await response.json();
    const element = document.getElementById('health');
    if (!response.ok || !data.ok) { element.classList.add('outage'); element.textContent = 'Service issue detected'; return; }
    element.classList.add('ok'); element.textContent = 'All services operational';
  }).catch(() => { const element = document.getElementById('health'); element.classList.add('outage'); element.textContent = 'Status unavailable'; });
})();
