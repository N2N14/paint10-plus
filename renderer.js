(function (global) {
  'use strict';

  const OPEN_TYPES = new Set(['line', 'curve', 'polyline', 'freehand', 'arc', 'arrow', 'doublearrow']);
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const num = value => String(Math.round(finite(value) * 10000) / 10000);
  const escape = value => Array.from(String(value == null ? '' : value)).filter(character => {
    const code = character.codePointAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xD7FF) || (code >= 0xE000 && code <= 0xFFFD) || code >= 0x10000;
  }).join('').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

  function keyFor(object) {
    const value = String(object.id == null ? 'object' : object.id);
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return 'drawing-' + value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) + '-' + (hash >>> 0).toString(36);
  }

  function dashValue(style) {
    const width = Math.max(0.25, finite(style.strokeWidth, 2));
    if (Array.isArray(style.dash)) {
      const values = style.dash.slice(0, 16).map(value => Math.max(0, finite(value)));
      return values.some(value => value > 0) ? values.map(num).join(' ') : '';
    }
    if (style.dash === 'dotted') return '0 ' + num(width * 2.8);
    if (style.dash === 'dashed') return num(width * 4.5) + ' ' + num(width * 2.8);
    return '';
  }

  function arrowDefinition(id, kind, stroke, strokeWidth) {
    const size = Math.max(10, strokeWidth * 3.8 + 4);
    let markup;
    if (kind === 'triangle') markup = '<path d="M2 2 L10 6 L2 10 Z" fill="' + escape(stroke) + '"/>';
    else if (kind === 'circle') markup = '<circle cx="6" cy="6" r="3.2" fill="' + escape(stroke) + '"/>';
    else markup = '<path d="M2 2 L10 6 L2 10" fill="none" stroke="' + escape(stroke) + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
    return '<marker id="' + id + '" viewBox="0 0 12 12" markerWidth="' + num(size) + '" markerHeight="' + num(size) + '" refX="' + (kind === 'circle' ? '6' : '10') + '" refY="6" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible">' + markup + '</marker>';
  }

  function erasureDefinition(object, key, geometry) {
    if (!Array.isArray(object.erasures) || !object.erasures.length) return '';
    const w = Math.max(0, finite(object.w)), h = Math.max(0, finite(object.h));
    const style = object.style || {}, padding = Math.max(100, finite(style.strokeWidth, 2) * 12, finite(style.fontSize, 28) * 4);
    let left = -padding, top = -padding, right = w + padding, bottom = h + padding;
    const includePoint = p => { left = Math.min(left, finite(p.x) - padding); top = Math.min(top, finite(p.y) - padding); right = Math.max(right, finite(p.x) + padding); bottom = Math.max(bottom, finite(p.y) + padding); };
    geometry.contours.forEach(contour => contour.points.forEach(includePoint));
    if (geometry.text) global.DrawingGeometry.textLayout(object).runs.forEach(run => { includePoint({ x: run.box.x, y: run.box.y }); includePoint({ x: run.box.x + run.box.w, y: run.box.y + run.box.h }); });
    if (geometry.text) {
      const paint = global.DrawingGeometry.paintBounds(object);
      [{ x: paint.x, y: paint.y }, { x: paint.x + paint.w, y: paint.y }, { x: paint.x + paint.w, y: paint.y + paint.h }, { x: paint.x, y: paint.y + paint.h }].forEach(point => includePoint(global.DrawingGeometry.worldToLocal(object, point)));
    }
    const paths = object.erasures.map(erasure => {
      const points = Array.isArray(erasure.points) ? erasure.points : [], size = Math.max(0, finite(erasure.size));
      if (!points.length || !size) return '';
      if (points.length === 1) return '<circle cx="' + num(points[0].x) + '" cy="' + num(points[0].y) + '" r="' + num(size / 2) + '" fill="black"/>';
      const d = points.map((point, index) => (index ? 'L' : 'M') + num(point.x) + ' ' + num(point.y)).join(' ');
      return '<path d="' + d + '" fill="none" stroke="black" stroke-width="' + num(size) + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }).join('');
    return '<mask id="' + key + '-erase" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="' + num(left) + '" y="' + num(top) + '" width="' + num(right - left) + '" height="' + num(bottom - top) + '" style="mask-type:luminance"><rect x="' + num(left) + '" y="' + num(top) + '" width="' + num(right - left) + '" height="' + num(bottom - top) + '" fill="white"/>' + paths + '</mask>';
  }

  function textMarkup(object) {
    const style = object.style || {}, layout = global.DrawingGeometry.textLayout(object);
    const color = global.DrawingGeometry.textColor(object);
    const font = style.fontFamily || 'Microsoft YaHei';
    const runs = layout.runs.map(run => '<tspan x="' + num(run.x) + '" y="' + num(run.y) + '" text-anchor="' + run.anchor + '">' + escape(run.text) + '</tspan>').join('');
    return '<text xml:space="preserve" fill="' + escape(color) + '" stroke="none" font-family="' + escape(font) + '" font-size="' + num(layout.fontSize) + '" font-weight="' + (style.bold ? '700' : '400') + '"' + (style.italic ? ' font-style="italic"' : '') + '>' + runs + '</text>';
  }

  function objectMarkup(object, options = {}) {
    if (!object || object.visible === false) return '';
    if (!global.DrawingGeometry) throw new Error('请先加载 geometry.js');
    const geometry = global.DrawingGeometry.shapeGeometry(object), style = object.style || {}, key = keyFor(object);
    const stroke = style.stroke || '#2563eb', width = Math.max(0, finite(style.strokeWidth, 2));
    const opacity = Math.max(0, Math.min(1, finite(style.opacity, 1)));
    const w = Math.max(0, finite(object.w)), h = Math.max(0, finite(object.h));
    let definitions = '', markerAttributes = '';
    if (OPEN_TYPES.has(object.type) && stroke !== 'none' && width > 0) {
      const arrows = global.DrawingGeometry.arrowStyles(object);
      if (arrows.start !== 'none') { definitions += arrowDefinition(key + '-start', arrows.start, stroke, width); markerAttributes += ' marker-start="url(#' + key + '-start)"'; }
      if (arrows.end !== 'none') { definitions += arrowDefinition(key + '-end', arrows.end, stroke, width); markerAttributes += ' marker-end="url(#' + key + '-end)"'; }
    }
    const mask = erasureDefinition(object, key, geometry);
    if (mask) definitions += mask;
    const dash = dashValue(style), fill = OPEN_TYPES.has(object.type) ? 'none' : style.fill || 'none';
    const strokeAttributes = ' stroke="' + escape(stroke) + '" stroke-width="' + num(width) + '" stroke-linecap="round" stroke-linejoin="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '');
    const content = object.type === 'text' ? textMarkup(object) : object.type === 'image' ? '<image x="0" y="0" width="' + num(w) + '" height="' + num(h) + '" preserveAspectRatio="none" href="' + escape(object.src) + '" xlink:href="' + escape(object.src) + '"/>' : '<path d="' + (geometry.fillD || geometry.d) + '" fill="' + escape(fill) + '" fill-rule="evenodd"' + strokeAttributes + markerAttributes + '/>' + (geometry.decorativeD ? '<path d="' + geometry.decorativeD + '" fill="none"' + strokeAttributes + '/>' : '');
    const transform = 'translate(' + num(object.x) + ' ' + num(object.y) + ') rotate(' + num(object.rotation) + ' ' + num(w / 2) + ' ' + num(h / 2) + ')';
    const interactive = options.interactive ? ' class="drawing-object" data-locked="' + (object.locked ? 'true' : 'false') + '"' : '';
    return '<g data-object-id="' + escape(object.id) + '"' + interactive + ' transform="' + transform + '" opacity="' + num(opacity) + '">' + (definitions ? '<defs>' + definitions + '</defs>' : '') + '<g' + (mask ? ' mask="url(#' + key + '-erase)"' : '') + '>' + content + '</g></g>';
  }

  function documentMarkup(objects, document, options = {}) {
    const doc = document || {}, width = Math.max(1, finite(doc.width, 1600)), height = Math.max(1, finite(doc.height, 1000));
    const background = options.transparent ? '' : '<rect width="' + num(width) + '" height="' + num(height) + '" fill="' + escape(doc.background || '#ffffff') + '"/>';
    return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="' + num(width) + '" height="' + num(height) + '" viewBox="0 0 ' + num(width) + ' ' + num(height) + '"><title>' + escape(doc.name || '绘图作品') + '</title>' + background + (Array.isArray(objects) ? objects : []).filter(object => object && object.visible !== false).map(object => objectMarkup(object)).join('') + '</svg>';
  }

  global.DrawingRender = Object.freeze({ objectMarkup, documentMarkup, escapeXML: escape, dashValue });
})(typeof window !== 'undefined' ? window : globalThis);
