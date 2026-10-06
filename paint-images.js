(function (global) {
  'use strict';

  function createPaintImages(controller) {
    if (!controller || typeof controller.getDocument !== 'function' || typeof controller.snapshot !== 'function') throw new Error('图片命令缺少画板控制器。');
    const input = document.getElementById('image-input');
    let busy = false, openMode = 'open';
    const report = error => controller.report(error instanceof Error ? error : new Error(String(error)));
    const notify = message => { if (typeof controller.notify === 'function') controller.notify(message); };
    const raster = () => {
      if (!global.DrawingRaster) throw new Error('图片处理模块尚未加载，请重新打开软件。');
      return global.DrawingRaster;
    };
    const sameDocument = before => {
      if (controller.snapshot() === before) return true;
      notify('处理期间画板已变化，本次结果未应用。');
      return false;
    };
    const currentRegion = () => {
      const region = typeof controller.getRegion === 'function' && controller.getRegion();
      if (!region) return null;
      const x = Number(region.x), y = Number(region.y), w = Number(region.w), h = Number(region.h);
      return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
    };
    const begin = () => {
      if (busy) { notify('正在处理图像，请稍候。'); return false; }
      busy = true; controller.setBusy(true); return true;
    };
    const end = () => { busy = false; controller.setBusy(false); };

    async function commit(label, produce, afterCommit) {
      if (!begin()) return false;
      try {
        const before = controller.snapshot(), doc = controller.getDocument();
        const result = await produce(doc);
        if (!result || !sameDocument(before)) return false;
        if (result.changed === false) return false;
        const applied = controller.applyPixels(before, result, label);
        if (applied === false) return false;
        if (afterCommit) afterCommit(result);
        return true;
      } catch (error) { report(error); return false; } finally { end(); }
    }

    async function fill(point, color) {
      return commit('油漆桶填充', doc => raster().fill(doc, point, color));
    }

    async function pick(point) {
      if (!begin()) return null;
      try {
        const before = controller.snapshot(), color = await raster().pickColor(controller.getDocument(), point);
        return sameDocument(before) ? color : null;
      } catch (error) { report(error); return null; } finally { end(); }
    }

    async function handleImageChange() {
      const file = input && input.files && input.files[0], mode = openMode;
      if (!file) return;
      if (!begin()) { input.value = ''; return; }
      try {
        const before = controller.snapshot(), result = await raster().readImage(file);
        if (sameDocument(before)) controller.insertImage(result, file.name || '导入图像', mode);
      } catch (error) { report(error); } finally { input.value = ''; end(); }
    }
    if (input) input.addEventListener('change', handleImageChange);

    function open(mode = 'open') {
      if (busy) { notify('正在处理图像，请稍候。'); return false; }
      if (!input) { report(new Error('未找到图片文件选择器，请重新打开软件。')); return false; }
      openMode = mode; input.dataset.mode = mode; input.value = ''; input.click();
      return true;
    }

    async function crop() {
      const region = currentRegion();
      if (!region) { notify('请先用“选择”框出裁剪区域。'); return false; }
      return commit('裁剪图像', doc => raster().crop(doc, region));
    }

    async function rotate(operation) {
      const labels = { right: '向右旋转 90°', left: '向左旋转 90°', '180': '旋转 180°', 'flip-h': '水平翻转', 'flip-v': '垂直翻转' };
      return commit(labels[operation] || '旋转图像', doc => raster().transform(doc, String(operation)));
    }

    async function resize(width, height) {
      return commit('调整图像大小', doc => raster().resize(doc, width, height));
    }

    async function erasedPixels(doc, region) {
      const canvas = await raster().rasterize(doc, { transparent: true });
      const left = Math.max(0, Math.floor(region.x)), top = Math.max(0, Math.floor(region.y));
      const right = Math.min(canvas.width, Math.ceil(region.x + region.w)), bottom = Math.min(canvas.height, Math.ceil(region.y + region.h));
      if (right <= left || bottom <= top) return { changed: false };
      canvas.getContext('2d').clearRect(left, top, right - left, bottom - top);
      const src = canvas.toDataURL('image/png');
      if (!src.startsWith('data:image/png;base64,')) throw new Error('无法擦除选区，画板内存不足。');
      return { src, width: canvas.width, height: canvas.height, changed: true };
    }

    async function eraseRegion() {
      const region = currentRegion();
      if (!region) return false;
      return commit('清除选区', doc => erasedPixels(doc, region), () => controller.setSelection([]));
    }

    async function moveRegion(rectangle, dx, dy) {
      return commit('移动选区', async doc => {
        const rect = rectangle || {};
        const x = Number(rect.x), y = Number(rect.y), w = Number(rect.w), h = Number(rect.h);
        const shiftX = Math.round(Number(dx)), shiftY = Math.round(Number(dy));
        if (![x, y, w, h, shiftX, shiftY].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error('移动选区和位移必须是有效数值。');
        if (shiftX === 0 && shiftY === 0) return { changed: false };
        const canvas = await raster().rasterize(doc, { transparent: true });
        const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y));
        const right = Math.min(canvas.width, Math.ceil(x + w)), bottom = Math.min(canvas.height, Math.ceil(y + h));
        if (right <= left || bottom <= top) return { changed: false };
        const copied = document.createElement('canvas');
        copied.width = right - left; copied.height = bottom - top;
        const sourceContext = copied.getContext('2d'), context = canvas.getContext('2d');
        if (!sourceContext || !context) throw new Error('无法建立选区移动画板，请重新打开软件。');
        sourceContext.imageSmoothingEnabled = false;
        sourceContext.drawImage(canvas, left, top, copied.width, copied.height, 0, 0, copied.width, copied.height);
        // Copy before clearing: overlapping source and destination retain every
        // selected pixel and behave like a native Paint selection drag.
        context.clearRect(left, top, copied.width, copied.height);
        context.imageSmoothingEnabled = false;
        context.drawImage(copied, left + shiftX, top + shiftY);
        const src = canvas.toDataURL('image/png');
        if (!src.startsWith('data:image/png;base64,')) throw new Error('无法移动选区，画板内存不足。');
        return { src, width: canvas.width, height: canvas.height, changed: true };
      });
    }

    async function copy() {
      const region = currentRegion();
      if (!region) return false;
      if (!begin()) return false;
      try {
        const before = controller.snapshot(), image = await raster().crop(controller.getDocument(), region, { transparent: true });
        if (!sameDocument(before)) return false;
        controller.setClipboard({ image }); notify('已复制选区图像。');
        return true;
      } catch (error) { report(error); return false; } finally { end(); }
    }

    async function cut() {
      const region = currentRegion();
      if (!region) return false;
      let copied;
      // Both reads use the same document snapshot. A concurrent edit cannot turn
      // an old copied region into a cut from a newer drawing.
      return commit('剪切选区', async doc => {
        const outcomes = await Promise.allSettled([
          raster().crop(doc, region, { transparent: true }),
          erasedPixels(doc, region)
        ]);
        const failures = outcomes.filter(outcome => outcome.status === 'rejected');
        if (failures.length) throw failures[0].reason;
        copied = outcomes[0].value;
        return outcomes[1].value;
      }, () => {
        controller.setClipboard({ image: copied }); controller.setSelection([]); notify('已剪切选区图像。');
      });
    }

    async function paste() {
      const clipboard = controller.getClipboard();
      // Object clipboard content remains available to the main application's
      // existing paste path. Only an image is handled by this module.
      if (clipboard && !clipboard.image && (!Array.isArray(clipboard) || clipboard.length > 0)) return false;
      if (!begin()) return false;
      try {
        const before = controller.snapshot();
        let image = clipboard && clipboard.image;
        if (!image) {
          if (!global.navigator || !navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
            notify('当前浏览器无法读取系统剪贴板图片，可使用“粘贴自”选择本地图片。');
            return false;
          }
          let items;
          try { items = await navigator.clipboard.read(); } catch (error) { throw new Error('无法读取系统剪贴板图片，请允许访问剪贴板或使用“粘贴自”。'); }
          let blob;
          for (const item of items) {
            const type = item.types.find(value => value === 'image/png') || item.types.find(value => value.startsWith('image/'));
            if (type) { blob = await item.getType(type); break; }
          }
          if (!blob) { notify('剪贴板中没有可粘贴的图片。'); return false; }
          image = await raster().readImage(blob);
        }
        if (!sameDocument(before)) return false;
        return controller.insertImage(image, '粘贴图像', 'paste') !== false;
      } catch (error) { report(error); return false; } finally { end(); }
    }

    function destroy() { if (input) input.removeEventListener('change', handleImageChange); }
    return Object.freeze({ fill, pick, open, crop, rotate, resize, eraseRegion, moveRegion, copy, cut, paste, destroy });
  }

  global.createPaintImages = createPaintImages;
})(typeof window !== 'undefined' ? window : globalThis);
