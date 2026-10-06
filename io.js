(function () {
  'use strict';

  const STORAGE_KEY = 'paint10-plus-project-v2';
  const TYPES = new Set(['rect', 'roundrect', 'ellipse', 'diamond', 'triangle', 'righttriangle', 'pentagon', 'octagon', 'star', 'star4', 'star6', 'hexagon', 'parallelogram', 'trapezoid', 'cylinder', 'cloud', 'speech', 'speechoval', 'frame', 'arc', 'line', 'curve', 'polyline', 'polygon', 'freehand', 'text', 'arrow', 'doublearrow', 'arrowright', 'arrowleft', 'arrowup', 'arrowdown', 'lightning', 'heart', 'image']);
  const MAX_JSON_BYTES = 20 * 1024 * 1024;
  const MAX_POINTS = 250000;

  function fail(message) { throw new Error(message); }
  function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function number(value, fallback, minimum, maximum, label) {
    const result = value === undefined ? fallback : value;
    if (typeof result !== 'number' || !Number.isFinite(result) || result < minimum || result > maximum) {
      fail(label + '必须是 ' + minimum + '～' + maximum + ' 之间的有效数字。');
    }
    return result;
  }
  function boolean(value, fallback, label) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') fail(label + '必须为开启或关闭状态。');
    return value;
  }
  function string(value, fallback, maximum, label) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value.length > maximum) fail(label + '必须是长度不超过 ' + maximum + ' 的文字。');
    return value;
  }
  function color(value, fallback, label, allowNone = true) {
    const result = value === undefined ? fallback : value;
    if (typeof result !== 'string' || !/^(?:none|#[0-9a-f]{3}|#[0-9a-f]{6})$/i.test(result) || (!allowNone && result.toLowerCase() === 'none')) {
      fail(label + '必须是 3 位或 6 位十六进制颜色（例如 #2563EB）' + (allowNone ? '或 none；透明度请单独设置。' : '；画布背景不能为透明色。'));
    }
    return result.length === 4 && result[0] === '#' ? '#' + result.slice(1).split('').map(function (digit) { return digit + digit; }).join('').toLowerCase() : result.toLowerCase();
  }
  function choice(value, fallback, allowed, label) {
    const result = value === undefined ? fallback : value;
    if (!allowed.includes(result)) fail(label + '不在支持的选项中。');
    return result;
  }
  function points(value, label, budget) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 20000) fail(label + '必须是最多包含 20000 个坐标点的数组。');
    budget.points += value.length;
    if (budget.points > MAX_POINTS) fail('工程的坐标点超过 250000 个，请拆分工程后再导入。');
    return value.map(function (point, index) {
      if (!isRecord(point)) fail(label + '的第 ' + (index + 1) + ' 个坐标点格式不正确。');
      return {
        x: number(point.x, undefined, -100000, 100000, label + '横坐标'),
        y: number(point.y, undefined, -100000, 100000, label + '纵坐标')
      };
    });
  }
  function arrow(value, fallback, label) {
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value ? 'arrow' : 'none';
    if (['none', 'arrow', 'triangle', 'circle'].includes(value)) return value;
    fail(label + '格式不正确。');
  }
  function dash(value, label) {
    if (value === undefined) return 'solid';
    if (typeof value === 'string' && ['solid', 'none', 'dashed', 'dotted'].includes(value)) return value;
    if (Array.isArray(value) && value.length <= 12 && value.length > 0) {
      const result = value.map(function (item) { return number(item, undefined, 0, 1024, label); });
      if (result.some(function (item) { return item > 0; })) return result;
    }
    fail(label + '必须是实线、虚线、点线或有效的线段长度数组。');
  }

  function utf8Length(value) {
    let length = 0;
    for (const character of value) {
      const code = character.codePointAt(0);
      length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return length;
  }

  function imageSource(value, label, budget) {
    if (typeof value !== 'string' || value.length > MAX_JSON_BYTES) fail(label + '图片必须是最大 20 MB 的内嵌 PNG、JPEG 或 WebP。');
    const match = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
    if (!match) fail(label + '图片仅支持内嵌 PNG、JPEG 或 WebP；不支持外部链接、SVG 或脚本。');
    const payload = value.slice(match[0].length), paddingAt = payload.indexOf('=');
    if (!payload.length || payload.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(payload) ||
        (paddingAt !== -1 && (paddingAt < payload.length - 2 || !/^={1,2}$/.test(payload.slice(paddingAt))))) {
      fail(label + '图片的 base64 数据格式不正确。');
    }
    const padding = paddingAt === -1 ? 0 : payload.length - paddingAt;
    if (payload.length / 4 * 3 - padding > MAX_JSON_BYTES) fail(label + '图片超过 20 MB。');
    // Decode only the small raster header here; full decoding remains the browser's responsibility.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = [];
    let accumulator = 0, bits = 0;
    for (const character of payload.slice(0, 24)) {
      if (character === '=') break;
      accumulator = (accumulator << 6) | alphabet.indexOf(character); bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((accumulator >>> bits) & 255); }
    }
    const prefix = expected => expected.every((byte, index) => bytes[index] === byte);
    const valid = match[1] === 'png' ? prefix([137, 80, 78, 71, 13, 10, 26, 10]) :
      match[1] === 'jpeg' ? prefix([255, 216, 255]) :
        prefix([82, 73, 70, 70]) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
    if (!valid) fail(label + '图片文件头与 PNG、JPEG 或 WebP 格式不符。');
    budget.images += value.length;
    if (budget.images > MAX_JSON_BYTES) fail('工程内嵌图片总量超过 20 MB，请拆分工程后再导入。');
    return value;
  }

  function validateProject(input) {
    let source = input;
    if (typeof source === 'string') {
      if (source.length > MAX_JSON_BYTES || utf8Length(source) > MAX_JSON_BYTES) fail('工程文件过大，最大支持 20 MB。');
      try { source = JSON.parse(source); } catch (_) { fail('工程文件不是有效的 JSON，可能已损坏。'); }
    }
    if (!isRecord(source)) fail('工程文件格式不正确。');
    if (source.format !== undefined) {
      if (source.format !== 'graphite-studio' || source.version !== 1) fail('该工程格式或版本暂不受支持。');
      source = source.document;
      if (!isRecord(source)) fail('工程文件缺少画布内容。');
    }
    const documentName = string(source.name, '未命名作品', 120, '作品名称').trim() || '未命名作品';
    const width = number(source.width, undefined, 1, 12000, '画布宽度');
    const height = number(source.height, undefined, 1, 12000, '画布高度');
    if (!Array.isArray(source.objects) || source.objects.length > 2000) fail('工程必须包含图形列表，最多支持 2000 个对象。');
    const budget = { points: 0, erasures: 0, text: 0, images: 0 };
    const usedIds = new Set();
    const objects = source.objects.map(function (object, index) {
      const label = '第 ' + (index + 1) + ' 个对象';
      if (!isRecord(object) || !TYPES.has(object.type)) fail(label + '的图形类型不受支持。');
      let id = object.id;
      if (id === undefined) {
        id = 'import-' + (index + 1);
        while (usedIds.has(id)) id += '-copy';
      }
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(id)) fail(label + '的标识符不合法。');
      if (usedIds.has(id)) fail('工程包含重复对象标识符：' + id + '。');
      usedIds.add(id);
      if (object.style !== undefined && !isRecord(object.style)) fail(label + '的样式格式不正确。');
      const style = object.style || {};
      const fontFamily = string(style.fontFamily, 'Microsoft YaHei, sans-serif', 160, label + '字体');
      if (/[<>;{}\\\x00-\x1f]/.test(fontFamily)) fail(label + '的字体名称含有不支持的字符。');
      const text = string(object.text, '', 50000, label + '文本');
      budget.text += text.length;
      if (budget.text > 200000) fail('工程文本总长度超过 200000，请拆分工程后再导入。');
      const rawErasures = object.erasures === undefined ? [] : object.erasures;
      if (!Array.isArray(rawErasures) || rawErasures.length > 2000) fail(label + '的擦除记录超过限制。');
      budget.erasures += rawErasures.length;
      if (budget.erasures > 10000) fail('工程包含过多擦除记录，请拆分工程后再导入。');
      const erasures = rawErasures.map(function (erasure, erasureIndex) {
        if (!isRecord(erasure)) fail(label + '的擦除记录格式不正确。');
        const erasurePoints = points(erasure.points, label + '擦除轨迹 ' + (erasureIndex + 1), budget);
        if (!erasurePoints.length) fail(label + '包含空白擦除轨迹。');
        return { points: erasurePoints, size: number(erasure.size, undefined, 0.01, 100000, label + '橡皮大小') };
      });
      const src = object.type === 'image' ? imageSource(object.src, label, budget) : undefined;
      const objectPoints = points(object.points, label + '线条', budget);
      if (object.type === 'polygon' && objectPoints.length < 3) fail(label + '闭合多边形至少需要 3 个坐标点。');
      return {
        id: id,
        type: object.type,
        name: string(object.name, object.type === 'text' ? '文字' : '图形 ' + (index + 1), 160, label + '名称'),
        x: number(object.x, 0, -100000, 100000, label + '横坐标'),
        y: number(object.y, 0, -100000, 100000, label + '纵坐标'),
        w: number(object.w, 0, object.type === 'image' ? 0.01 : 0, 100000, label + '宽度'),
        h: number(object.h, 0, object.type === 'image' ? 0.01 : 0, 100000, label + '高度'),
        rotation: number(object.rotation, 0, -360000, 360000, label + '旋转角度') % 360,
        visible: boolean(object.visible, true, label + '可见状态'),
        locked: boolean(object.locked, false, label + '锁定状态'),
        style: {
          stroke: object.type === 'image' ? 'none' : color(style.stroke, '#162238', label + '描边颜色'),
          fill: object.type === 'image' ? 'none' : color(style.fill, 'none', label + '填充颜色'),
          strokeWidth: number(style.strokeWidth, 3, 0, 100, label + '描边宽度'),
          dash: dash(style.dash, label + '线型'),
          opacity: number(style.opacity, 1, 0, 1, label + '不透明度'),
          startArrow: arrow(style.startArrow, 'none', label + '起点箭头'),
          endArrow: arrow(style.endArrow, 'none', label + '终点箭头'),
          fontFamily: fontFamily,
          fontSize: number(style.fontSize, 32, 6, 500, label + '字号'),
          bold: boolean(style.bold, false, label + '粗体状态'),
          italic: boolean(style.italic, false, label + '斜体状态'),
          brush: choice(style.brush, 'pencil', ['pencil', 'brush', 'marker', 'calligraphy'], label + '画笔类型'),
          textDirection: choice(style.textDirection, 'horizontal', ['horizontal', 'vertical'], label + '文字方向'),
          align: choice(style.align, 'left', ['left', 'center', 'right'], label + '文字对齐'),
          lineHeight: number(style.lineHeight, 1.35, 0.5, 5, label + '行距')
        },
        points: objectPoints,
        text: text,
        erasures: erasures,
        ...(src === undefined ? {} : { src: src })
      };
    });
    const normalized = { name: documentName, width: Math.round(width), height: Math.round(height), background: color(source.background, '#ffffff', '画布背景', false), objects: objects };
    if (utf8Length(JSON.stringify({ format: 'graphite-studio', version: 1, document: normalized })) > MAX_JSON_BYTES) fail('工程文件过大，最大支持 20 MB（含内嵌图片）。');
    return normalized;
  }

  function filename(name) {
    let result = String(name || '未命名作品').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 80);
    if (!result) result = '未命名作品';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = '作品_' + result;
    return result;
  }
  function download(blob, name) {
    if (!(blob instanceof Blob)) fail('下载内容无效。');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function exportProject(doc) {
    const normalized = validateProject(doc);
    const data = JSON.stringify({ format: 'graphite-studio', version: 1, document: normalized });
    download(new Blob([data], { type: 'application/json;charset=utf-8' }), filename(normalized.name) + '.graphite');
  }
  function svgMarkup(doc, transparent) {
    if (!window.DrawingRender || typeof window.DrawingRender.documentMarkup !== 'function') fail('绘图模块尚未就绪，请刷新后重试。');
    return window.DrawingRender.documentMarkup(doc.objects, doc, { transparent: Boolean(transparent) });
  }
  function exportSvg(doc, transparent) {
    const normalized = validateProject(doc);
    download(new Blob([svgMarkup(normalized, transparent)], { type: 'image/svg+xml;charset=utf-8' }), filename(normalized.name) + '.svg');
  }
  async function exportPng(doc, options) {
    const normalized = validateProject(doc);
    const settings = options || {};
    const scale = number(settings.scale, 1, 0.1, 8, '导出倍率');
    const width = Math.round(normalized.width * scale);
    const height = Math.round(normalized.height * scale);
    if (width > 32767 || height > 32767 || width * height > 64000000) fail('PNG 尺寸过大，最多支持 6400 万像素；请降低导出倍率或改用 SVG。');
    const svg = new Blob([svgMarkup(normalized, settings.transparent)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svg);
    try {
      const picture = new Image();
      await new Promise(function (resolve, reject) {
        picture.onload = resolve;
        picture.onerror = function () { reject(new Error('图片导出失败，请检查字体和图形后重试。')); };
        picture.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) fail('浏览器无法创建图片画布，请降低导出尺寸后重试。');
      context.drawImage(picture, 0, 0, width, height);
      const blob = await new Promise(function (resolve, reject) {
        try { canvas.toBlob(function (result) { result ? resolve(result) : reject(new Error('图片内存不足，请降低导出尺寸后重试。')); }, 'image/png'); }
        catch (_) { reject(new Error('图片导出受浏览器限制，请使用本地服务模式打开软件后重试。')); }
      });
      download(blob, filename(normalized.name) + '.png');
      canvas.width = 0;
      canvas.height = 0;
    } finally { URL.revokeObjectURL(url); }
  }
  function saveLocal(doc) {
    const normalized = validateProject(doc);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ format: 'graphite-studio', version: 1, document: normalized })); }
    catch (_) { fail('自动保存不可用或浏览器存储已满，请下载工程文件保存作品。'); }
    return true;
  }
  function loadLocal() {
    let raw;
    try { raw = localStorage.getItem(STORAGE_KEY); }
    catch (_) { fail('浏览器禁止访问本地存储，请使用本地服务模式，或手动打开工程文件。'); }
    if (!raw) return null;
    try { return validateProject(raw); }
    catch (error) { fail('上次自动保存的工程无法恢复：' + error.message); }
  }
  window.DrawingIO = Object.freeze({ validateProject: validateProject, exportProject: exportProject, exportSvg: exportSvg, exportPng: exportPng, saveLocal: saveLocal, loadLocal: loadLocal, download: download });
})();
