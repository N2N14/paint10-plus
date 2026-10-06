(function (global) {
  'use strict';

  const MAX_FILE_BYTES = 20 * 1024 * 1024, MAX_PIXELS = 64000000, MAX_EDGE = 12000;
  const scriptURL = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
  const workerURL = scriptURL ? new URL('fill-worker.js', scriptURL).href : 'fill-worker.js';
  let corePromise;

  function dimensions(width, height) {
    width = Number(width); height = Number(height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('图片宽高无效。');
    width = Math.round(width); height = Math.round(height);
    if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) throw new Error('图片过大：单边最多 12000 像素，总计最多 6400 万像素。');
    return { width, height };
  }

  function makeCanvas(width, height) {
    const size = dimensions(width, height), canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    if (!canvas.getContext('2d')) throw new Error('浏览器无法建立画板，请使用新版 Edge 或 Chrome。');
    return canvas;
  }

  function png(canvas) {
    try {
      const src = canvas.toDataURL('image/png');
      if (!src.startsWith('data:image/png;base64,')) throw new Error('画板内存不足。');
      return { src, width: canvas.width, height: canvas.height };
    } catch (error) {
      if (error && error.name === 'SecurityError') throw new Error('图片包含无法读取的外部内容，请使用本地 PNG、JPEG、WEBP、BMP 或 GIF。');
      throw new Error('无法生成图片：' + (error && error.message || '画板内存不足。'));
    }
  }

  function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), image = new Image();
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); URL.revokeObjectURL(url);
        image.onload = null; image.onerror = null;
        if (error) reject(error); else resolve(image);
      };
      const timer = setTimeout(() => finish(new Error('图片读取超时，请换用较小的图片。')), 30000);
      image.onload = () => finish();
      image.onerror = () => finish(new Error('图片无法读取，文件可能损坏或格式不受支持。'));
      image.src = url;
    });
  }

  // Check dimensions before decoding large files. Content signatures take precedence
  // over filename extensions and MIME labels, so an SVG cannot reach the decoder.
  function inspectImage(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
    if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 3) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 && ascii(12, 4) === 'IHDR') {
      return { type: 'image/png', ...dimensions(view.getUint32(16), view.getUint32(20)) };
    }
    if (bytes.length >= 26 && ascii(0, 2) === 'BM') {
      const dibSize = view.getUint32(14, true);
      const width = dibSize === 12 ? view.getUint16(18, true) : view.getInt32(18, true);
      const height = dibSize === 12 ? view.getUint16(20, true) : Math.abs(view.getInt32(22, true));
      return { type: 'image/bmp', ...dimensions(width, height) };
    }
    if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) {
      return { type: 'image/gif', ...dimensions(view.getUint16(6, true), view.getUint16(8, true)) };
    }
    if (bytes.length >= 25 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      const kind = ascii(12, 4);
      if (kind === 'VP8X' && bytes.length >= 30) {
        const uint24 = offset => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
        return { type: 'image/webp', ...dimensions(uint24(24) + 1, uint24(27) + 1) };
      }
      if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
        return { type: 'image/webp', ...dimensions(view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383) };
      }
      if (kind === 'VP8L' && bytes[20] === 47) {
        const bits = view.getUint32(21, true);
        return { type: 'image/webp', ...dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1) };
      }
    }
    if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      let offset = 2;
      while (offset + 3 < bytes.length) {
        if (bytes[offset] !== 255) break;
        while (offset < bytes.length && bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 0xD9 || marker === 0xDA) break;
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) continue;
        if (offset + 2 > bytes.length) break;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > bytes.length) break;
        if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker) && length >= 7) {
          return { type: 'image/jpeg', ...dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3)) };
        }
        offset += length;
      }
      throw new Error('JPEG 图片头损坏，无法确定宽高。');
    }
    throw new Error('仅支持本地 PNG、JPEG、WEBP、BMP、GIF 图片；不接受 SVG 或外部图片链接。');
  }

  async function readImage(file) {
    if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size < 1) throw new Error('请选择本地图片文件。');
    if (file.size > MAX_FILE_BYTES) throw new Error('图片文件不能超过 20 MB。');
    const buffer = await file.arrayBuffer(), info = inspectImage(buffer), blob = new Blob([buffer], { type: info.type });
    // ImageBitmap captures an animated GIF's first frame, producing a stable PNG.
    // Older browsers retain the ordinary local image decoder as a fallback.
    if (info.type === 'image/gif' && typeof createImageBitmap === 'function') {
      let bitmap;
      try { bitmap = await createImageBitmap(blob); } catch (error) { /* Use the local decoder below. */ }
      if (bitmap) {
        try {
          const canvas = makeCanvas(bitmap.width, bitmap.height);
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          return png(canvas);
        } finally { if (bitmap.close) bitmap.close(); }
      }
    }
    const image = await imageFromBlob(blob);
    const size = dimensions(image.naturalWidth, image.naturalHeight), canvas = makeCanvas(size.width, size.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return png(canvas);
  }

  async function rasterize(doc, { transparent = false } = {}) {
    if (!doc || !global.DrawingRender) throw new Error('画板渲染模块尚未加载。');
    const size = dimensions(doc.width, doc.height);
    for (const object of Array.isArray(doc.objects) ? doc.objects : []) {
      if (object && object.type === 'image' && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(String(object.src || ''))) throw new Error('图片图层必须是内嵌 PNG、JPEG 或 WEBP，无法读取外部链接。');
    }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const svg = global.DrawingRender.documentMarkup(doc.objects, { ...doc, ...size }, { transparent });
    const image = await imageFromBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const canvas = makeCanvas(size.width, size.height);
    canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
    return canvas;
  }

  function pointPixel(canvas, point) {
    const x = Math.floor(Number(point && point.x)), y = Math.floor(Number(point && point.y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) throw new Error('取色或填充点必须在画板内。');
    return { x, y };
  }

  function fillColor(color) {
    if (!/^#[0-9a-f]{6}$/i.test(String(color))) throw new Error('请输入六位 HEX 颜色，例如 #FF0000。');
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255];
  }

  function ensureCore() {
    if (global.DrawingFillCore) return Promise.resolve(global.DrawingFillCore);
    if (!corePromise) corePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = workerURL;
      script.onload = () => global.DrawingFillCore ? resolve(global.DrawingFillCore) : reject(new Error('填充模块未正确加载。'));
      script.onerror = () => { corePromise = null; reject(new Error('无法加载 fill-worker.js，请确认软件文件完整。')); };
      document.head.appendChild(script);
    });
    return corePromise;
  }

  function workerFill(data, width, height, point, color, tolerance) {
    return new Promise((resolve, reject) => {
      if (typeof Worker === 'undefined') { reject(new Error('此浏览器无法启动独立填充线程。')); return; }
      let worker;
      try { worker = new Worker(workerURL); } catch (error) { reject(error); return; }
      const timer = setTimeout(() => finish(new Error('独立填充线程超时。')), 120000);
      function finish(error, result) {
        clearTimeout(timer); worker.terminate();
        if (error) reject(error); else resolve(result);
      }
      worker.onmessage = event => {
        const result = event.data || {};
        if (result.error) { finish(new Error(result.error)); return; }
        if (!(result.buffer instanceof ArrayBuffer) || result.buffer.byteLength !== width * height * 4) { finish(new Error('填充线程返回的像素数据无效。')); return; }
        finish(null, { data: new Uint8ClampedArray(result.buffer), changed: Boolean(result.changed) });
      };
      worker.onerror = event => { if (event.preventDefault) event.preventDefault(); finish(new Error('独立填充线程无法运行。')); };
      worker.onmessageerror = () => finish(new Error('独立填充线程通信失败。'));
      try { worker.postMessage({ id: 1, buffer: data.buffer, width, height, x: point.x, y: point.y, color, tolerance }, [data.buffer]); } catch (error) { finish(error); }
    });
  }

  async function cooperativeFill(data, width, height, point, color, tolerance) {
    const core = await ensureCore(), job = core.createFillJob(data, width, height, point.x, point.y, color, tolerance);
    let step;
    do {
      step = job.step();
      if (!step.done) await new Promise(resolve => setTimeout(resolve, 0));
    } while (!step.done);
    return step.value;
  }

  async function fill(doc, point, color, { tolerance = 24 } = {}) {
    const rgba = fillColor(color), canvas = await rasterize(doc), pixel = pointPixel(canvas, point), context = canvas.getContext('2d');
    let imageData;
    try { imageData = context.getImageData(0, 0, canvas.width, canvas.height); } catch (error) { throw new Error('画板像素无法读取，请使用本地图片。'); }
    const limit = Math.min(255, Math.max(0, Math.round(Number(tolerance) || 0)));
    let result;
    try { result = await workerFill(imageData.data, canvas.width, canvas.height, pixel, rgba, limit); } catch (error) {
      // A failed Worker may already own the transferred buffer. Re-read the canvas
      // only in that case rather than retaining a second large image in memory.
      const pixels = imageData.data.byteLength ? imageData.data : context.getImageData(0, 0, canvas.width, canvas.height).data;
      result = await cooperativeFill(pixels, canvas.width, canvas.height, pixel, rgba, limit);
    }
    if (result.changed) {
      const replacement = context.createImageData(canvas.width, canvas.height);
      replacement.data.set(result.data); context.putImageData(replacement, 0, 0);
    }
    return { ...png(canvas), changed: result.changed };
  }

  async function pickColor(doc, point) {
    const canvas = await rasterize(doc), pixel = pointPixel(canvas, point);
    const values = canvas.getContext('2d').getImageData(pixel.x, pixel.y, 1, 1).data;
    return '#' + Array.from(values.subarray(0, 3), value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  async function crop(doc, rectangle, { transparent = false } = {}) {
    const canvas = await rasterize(doc, { transparent }), rect = rectangle || {};
    const x = Number(rect.x), y = Number(rect.y), w = Number(rect.w), h = Number(rect.h);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error('请先选择有效的裁剪区域。');
    const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y));
    const right = Math.min(canvas.width, Math.ceil(x + w)), bottom = Math.min(canvas.height, Math.ceil(y + h));
    if (right <= left || bottom <= top) throw new Error('裁剪区域必须与画板相交。');
    const output = makeCanvas(right - left, bottom - top), context = output.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height);
    return png(output);
  }

  async function transform(doc, operation) {
    if (!['right', 'left', '180', 'flip-h', 'flip-v'].includes(operation)) throw new Error('旋转或翻转方式无效。');
    const canvas = await rasterize(doc), swap = operation === 'right' || operation === 'left';
    const output = makeCanvas(swap ? canvas.height : canvas.width, swap ? canvas.width : canvas.height), context = output.getContext('2d');
    context.imageSmoothingEnabled = false;
    if (operation === 'right') { context.translate(canvas.height, 0); context.rotate(Math.PI / 2); }
    if (operation === 'left') { context.translate(0, canvas.width); context.rotate(-Math.PI / 2); }
    if (operation === '180') { context.translate(canvas.width, canvas.height); context.rotate(Math.PI); }
    if (operation === 'flip-h') { context.translate(canvas.width, 0); context.scale(-1, 1); }
    if (operation === 'flip-v') { context.translate(0, canvas.height); context.scale(1, -1); }
    context.drawImage(canvas, 0, 0);
    return png(output);
  }

  async function resize(doc, width, height) {
    const target = dimensions(width, height), canvas = await rasterize(doc), output = makeCanvas(target.width, target.height);
    const context = output.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, output.width, output.height);
    return png(output);
  }

  // The synchronous entry point is for pure algorithm tests only. UI calls fill(),
  // which always uses a Worker or cooperative, bounded batches.
  function floodFillSync(...args) {
    if (!global.DrawingFillCore) throw new Error('请先加载 fill-worker.js。');
    return global.DrawingFillCore.floodFillSync(...args);
  }

  global.DrawingRaster = Object.freeze({ readImage, rasterize, fill, pickColor, crop, transform, resize, floodFillSync });
})(typeof window !== 'undefined' ? window : globalThis);
