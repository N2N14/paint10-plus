/* Windows 10 style Paint ribbon and view controls. UTF-8. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const app = $('app');
  const fileMenu = $('file-menu');
  const fileTab = document.querySelector('[data-ribbon-tab="file"]');
  const tabs = [...document.querySelectorAll('[data-ribbon-tab]')];
  let fallbackToastTimer;

  function report(error) {
    const controller = window.PaintController;
    if (typeof controller?.report === 'function') {
      controller.report(error);
      return;
    }
    const toast = $('toast');
    toast.textContent = error?.message || String(error);
    toast.classList.add('visible');
    clearTimeout(fallbackToastTimer);
    fallbackToastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
  }

  function invoke(method, ...args) {
    try {
      const controller = window.PaintController;
      if (typeof controller?.[method] !== 'function') {
        throw new Error('绘图功能正在初始化，请稍后重试。');
      }
      const result = controller[method](...args);
      if (result && typeof result.then === 'function') result.catch(report);
      return result;
    } catch (error) {
      report(error);
    }
  }

  function notifyView() {
    window.dispatchEvent(new Event('resize'));
  }

  function closeFileMenu() {
    fileMenu.hidden = true;
    fileTab.classList.remove('active');
    fileTab.setAttribute('aria-expanded', 'false');
  }

  function toggleFileMenu() {
    const open = fileMenu.hidden;
    fileMenu.hidden = !open;
    fileTab.classList.toggle('active', open);
    fileTab.setAttribute('aria-expanded', String(open));
    if (open) fileMenu.querySelector('button')?.focus({ preventScroll: true });
  }

  function setEnhancements(open) {
    $('enhancements-panel').hidden = !open;
    $('enhancements-toggle').classList.toggle('active', open);
    $('enhancements-toggle').setAttribute('aria-expanded', String(open));
    $('inspector-mobile-toggle').checked = open;
    notifyView();
  }

  function selectTab(name) {
    if (name === 'file') {
      toggleFileMenu();
      return;
    }
    closeFileMenu();
    for (const tab of tabs) {
      if (tab.dataset.ribbonTab === 'file') continue;
      const active = tab.dataset.ribbonTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    for (const nameOfPage of ['home', 'view', 'enhance']) {
      $('ribbon-' + nameOfPage).hidden = nameOfPage !== name;
    }
    if (name === 'enhance') setEnhancements(true);
  }

  tabs.forEach(tab => {
    tab.onclick = () => selectTab(tab.dataset.ribbonTab);
  });
  document.addEventListener('click', event => {
    if (!fileMenu.hidden && !fileMenu.contains(event.target) && !fileTab.contains(event.target)) {
      closeFileMenu();
    }
  });
  fileMenu.addEventListener('click', event => {
    if (event.target.closest('button')) closeFileMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !fileMenu.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeFileMenu();
      fileTab.focus({ preventScroll: true });
    }
  }, true);

  $('enhancements-toggle').onclick = () => setEnhancements($('enhancements-panel').hidden);
  $('inspector-mobile-toggle').onchange = event => setEnhancements(event.target.checked);
  $('edit-colors-open').onclick = () => {
    closeFileMenu();
    const dialog = $('colors-dialog');
    if (!dialog.open) dialog.showModal();
  };
  $('colors-close').onclick = () => $('colors-dialog').close();

  function selectColorSlot(slot) {
    $('primary-color').classList.toggle('active', slot === 'primary');
    $('secondary-color').classList.toggle('active', slot === 'secondary');
    $('primary-color').setAttribute('aria-pressed', String(slot === 'primary'));
    $('secondary-color').setAttribute('aria-pressed', String(slot === 'secondary'));
    invoke('setColorSlot', slot);
  }
  $('primary-color').onclick = () => selectColorSlot('primary');
  $('secondary-color').onclick = () => selectColorSlot('secondary');
  document.querySelectorAll('#color-presets [data-color]').forEach(swatch => {
    swatch.onclick = () => invoke('setColor', swatch.dataset.color);
    swatch.oncontextmenu = event => {
      event.preventDefault();
      invoke('setColor', swatch.dataset.color, 'secondary');
    };
  });

  $('brush-style').onchange = event => invoke('setBrush', event.target.value);
  $('clipboard-copy').onclick = () => invoke('copy');
  $('clipboard-cut').onclick = () => invoke('cut');
  $('clipboard-paste').onclick = () => invoke('paste');
  $('paste-image').onclick = () => invoke('openImage', 'paste');
  $('open-image').onclick = () => invoke('openImage', 'open');
  $('resize-open').onclick = () => invoke('openResize');
  $('crop-selection').onclick = () => invoke('crop');
  $('select-all').onclick = () => invoke('selectAll');
  $('rotate-direction').onchange = event => {
    const operation = event.target.value;
    event.target.value = 'none';
    if (operation !== 'none') invoke('rotate', operation);
  };

  for (const axis of ['right', 'bottom', 'corner']) {
    $('canvas-resize-' + axis).addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      invoke('resizeCanvasFromHandle', event, axis);
    });
  }

  $('rulers-toggle').onchange = event => {
    const visible = event.target.checked;
    $('ruler-top').hidden = !visible;
    $('ruler-left').hidden = !visible;
    document.querySelector('.ruler-corner').hidden = !visible;
    app.classList.toggle('show-rulers', visible);
    notifyView();
  };
  $('status-toggle').onchange = event => {
    app.classList.toggle('hide-status', !event.target.checked);
    notifyView();
  };
  $('zoom-slider').oninput = event => invoke('zoom', Number(event.target.value));

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await app.requestFullscreen();
      }
    } catch (error) {
      report(error);
    }
  }
  $('fullscreen-toggle').onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', () => {
    const active = !!document.fullscreenElement;
    const button = $('fullscreen-toggle');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? '退出全屏显示（Esc）' : '切换全屏显示';
  });

  document.querySelectorAll('[data-command]').forEach(button => {
    button.onclick = () => {
      const command = button.dataset.command;
      if (command === 'brush-tool') {
        invoke('setBrush', $('brush-style').value === 'pencil' ? 'brush' : $('brush-style').value);
      } else if (command === 'actual-size') {
        invoke('actualSize');
      } else {
        const target = $(command);
        if (target && target !== button) target.click();
      }
    };
  });

  window.PaintShell = Object.freeze({ selectTab, setEnhancements, closeFileMenu });
})();
