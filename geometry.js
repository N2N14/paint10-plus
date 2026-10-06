(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const OPEN_TYPES = new Set(['line', 'curve', 'polyline', 'freehand', 'arc', 'arrow', 'doublearrow']);
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const dimensions = object => ({ w: Math.max(0, finite(object.w)), h: Math.max(0, finite(object.h)) });
  const num = value => String(Math.round(finite(value) * 10000) / 10000);
  const copyPoint = p => ({ x: finite(p && p.x), y: finite(p && p.y) });

  function localToWorld(object, point) {
    const { w, h } = dimensions(object);
    const angle = finite(object.rotation) * Math.PI / 180;
    const dx = finite(point.x) - w / 2, dy = finite(point.y) - h / 2;
    return {
      x: finite(object.x) + w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: finite(object.y) + h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)
    };
  }

  function worldToLocal(object, point) {
    const { w, h } = dimensions(object);
    const angle = -finite(object.rotation) * Math.PI / 180;
    const dx = finite(point.x) - finite(object.x) - w / 2;
    const dy = finite(point.y) - finite(object.y) - h / 2;
    return { x: w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle), y: h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
  }

  function pointBounds(points) {
    if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of points) {
      left = Math.min(left, p.x); top = Math.min(top, p.y);
      right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  function bounds(object) {
    const { w, h } = dimensions(object);
    return pointBounds([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }].map(p => localToWorld(object, p)));
  }

  function normalizePoints(points) {
    const clean = Array.isArray(points) ? points.map(copyPoint) : [];
    const box = pointBounds(clean);
    return { ...box, points: clean.map(p => ({ x: p.x - box.x, y: p.y - box.y })) };
  }

  function distanceToSegment(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const denominator = dx * dx + dy * dy;
    const t = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }

  function quadratic(a, b, c, t) {
    const s = 1 - t;
    return { x: s * s * a.x + 2 * s * t * b.x + t * t * c.x, y: s * s * a.y + 2 * s * t * b.y + t * t * c.y };
  }

  function cubic(a, b, c, d, t) {
    const s = 1 - t;
    return { x: s ** 3 * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t ** 3 * d.x, y: s ** 3 * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t ** 3 * d.y };
  }

  function sampleCount(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return Math.max(12, Math.min(256, Math.ceil(length / 5)));
  }

  // The renderer and hit testing share this path builder to keep editable shapes consistent.
  function pathBuilder() {
    const commands = [], contours = [];
    let current = null, last = null;
    return {
      move(x, y) {
        last = { x, y };
        current = { points: [last], closed: false, decorative: false, commandIndex: commands.length };
        contours.push(current); commands.push('M' + num(x) + ' ' + num(y));
      },
      line(x, y) {
        last = { x, y }; current.points.push(last); commands.push('L' + num(x) + ' ' + num(y));
      },
      quad(cx, cy, x, y) {
        const a = last, b = { x: cx, y: cy }, c = { x, y }, count = sampleCount([a, b, c]);
        for (let i = 1; i <= count; i++) current.points.push(quadratic(a, b, c, i / count));
        last = c; commands.push('Q' + [cx, cy, x, y].map(num).join(' '));
      },
      curve(c1x, c1y, c2x, c2y, x, y) {
        const a = last, b = { x: c1x, y: c1y }, c = { x: c2x, y: c2y }, d = { x, y }, count = sampleCount([a, b, c, d]);
        for (let i = 1; i <= count; i++) current.points.push(cubic(a, b, c, d, i / count));
        last = d; commands.push('C' + [c1x, c1y, c2x, c2y, x, y].map(num).join(' '));
      },
      close() { current.closed = true; last = current.points[0]; commands.push('Z'); },
      decorate() { current.decorative = true; },
      result() {
        const pathFor = (contour, index) => commands.slice(contour.commandIndex, contours[index + 1] ? contours[index + 1].commandIndex : commands.length).join(' ');
        return {
          d: commands.join(' '),
          fillD: contours.map((contour, index) => contour.decorative ? '' : pathFor(contour, index)).filter(Boolean).join(' '),
          decorativeD: contours.map((contour, index) => contour.decorative ? pathFor(contour, index) : '').filter(Boolean).join(' '),
          contours, closed: contours.some(c => c.closed)
        };
      }
    };
  }

  function polygon(builder, points) {
    builder.move(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) builder.line(points[i].x, points[i].y);
    builder.close();
  }

  function shapeGeometry(object) {
    const { w, h } = dimensions(object), type = object.type || 'rect', b = pathBuilder();
    const supplied = Array.isArray(object.points) ? object.points.map(copyPoint) : [];
    const endpointList = supplied.length ? supplied : [{ x: 0, y: 0 }, { x: w, y: h }];
    switch (type) {
      case 'text': return { d: '', contours: [], closed: false, text: true };
      case 'image':
        polygon(b, [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]);
        break;
      case 'line': case 'arrow': case 'doublearrow': case 'polyline': {
        const points = type === 'polyline' ? endpointList : [endpointList[0], endpointList[endpointList.length - 1]];
        b.move(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) b.line(points[i].x, points[i].y);
        break;
      }
      case 'polygon': {
        if (supplied.length >= 3) polygon(b, supplied);
        break;
      }
      case 'curve': {
        const points = supplied.length >= 3 ? supplied : [{ x: 0, y: h }, { x: w / 2, y: -h }, { x: w, y: h }];
        b.move(points[0].x, points[0].y); b.quad(points[1].x, points[1].y, points[2].x, points[2].y);
        break;
      }
      case 'freehand': {
        const points = endpointList;
        b.move(points[0].x, points[0].y);
        if (points.length === 1) b.line(points[0].x + 0.001, points[0].y);
        else if (points.length === 2) b.line(points[1].x, points[1].y);
        else {
          for (let i = 1; i < points.length - 1; i++) {
            b.quad(points[i].x, points[i].y, (points[i].x + points[i + 1].x) / 2, (points[i].y + points[i + 1].y) / 2);
          }
          b.line(points[points.length - 1].x, points[points.length - 1].y);
        }
        break;
      }
      case 'arc': {
        const k = 0.5522847498;
        b.move(0, h);
        b.curve(0, h * (1 - k), w * (1 - k) / 2, 0, w / 2, 0);
        b.curve(w * (1 + k) / 2, 0, w, h * (1 - k), w, h);
        break;
      }
      case 'roundrect': {
        const r = Math.min(w / 2, h / 2, Math.max(0, finite(object.radius, Math.min(w, h) * 0.16)));
        b.move(r, 0); b.line(w - r, 0); b.quad(w, 0, w, r); b.line(w, h - r); b.quad(w, h, w - r, h);
        b.line(r, h); b.quad(0, h, 0, h - r); b.line(0, r); b.quad(0, 0, r, 0); b.close();
        break;
      }
      case 'ellipse': {
        const k = 0.5522847498, rx = w / 2, ry = h / 2;
        b.move(w, ry); b.curve(w, ry * (1 + k), rx * (1 + k), h, rx, h);
        b.curve(rx * (1 - k), h, 0, ry * (1 + k), 0, ry); b.curve(0, ry * (1 - k), rx * (1 - k), 0, rx, 0);
        b.curve(rx * (1 + k), 0, w, ry * (1 - k), w, ry); b.close();
        break;
      }
      case 'diamond': polygon(b, [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }]); break;
      case 'triangle': polygon(b, [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }]); break;
      case 'righttriangle': polygon(b, [{ x: 0, y: 0 }, { x: w, y: h }, { x: 0, y: h }]); break;
      case 'pentagon': polygon(b, [{ x: w / 2, y: 0 }, { x: w, y: h * 0.38 }, { x: w * 0.81, y: h }, { x: w * 0.19, y: h }, { x: 0, y: h * 0.38 }]); break;
      case 'octagon': {
        const a = 1 - Math.SQRT1_2;
        polygon(b, [{ x: w * a, y: 0 }, { x: w * (1 - a), y: 0 }, { x: w, y: h * a }, { x: w, y: h * (1 - a) }, { x: w * (1 - a), y: h }, { x: w * a, y: h }, { x: 0, y: h * (1 - a) }, { x: 0, y: h * a }]);
        break;
      }
      case 'star': case 'star4': case 'star6': {
        const points = [];
        const tips = type === 'star4' ? 4 : type === 'star6' ? 6 : 5;
        const inner = type === 'star4' ? 0.15 : type === 'star6' ? 0.27 : 0.22;
        for (let i = 0; i < tips * 2; i++) {
          const angle = -Math.PI / 2 + i * Math.PI / tips, radius = i % 2 ? inner : 0.5;
          points.push({ x: w / 2 + Math.cos(angle) * w * radius, y: h / 2 + Math.sin(angle) * h * radius });
        }
        polygon(b, points); break;
      }
      case 'arrowright': case 'arrowleft': case 'arrowup': case 'arrowdown': {
        // Filled ribbon arrows are closed shapes; editable line arrows keep their own markers.
        const points = [[0, 0.32], [0.60, 0.32], [0.60, 0], [1, 0.5], [0.60, 1], [0.60, 0.68], [0, 0.68]].map(([x, y]) => {
          if (type === 'arrowleft') x = 1 - x;
          else if (type === 'arrowup') [x, y] = [y, 1 - x];
          else if (type === 'arrowdown') [x, y] = [1 - y, x];
          return { x: x * w, y: y * h };
        });
        polygon(b, points); break;
      }
      case 'lightning': polygon(b, [[0.49, 0], [0.16, 0.54], [0.43, 0.54], [0.32, 1], [0.85, 0.34], [0.58, 0.34], [0.74, 0]].map(([x, y]) => ({ x: x * w, y: y * h }))); break;
      case 'heart': {
        b.move(w * 0.5, h * 0.23);
        b.curve(w * 0.43, h * 0.02, w * 0.31, 0, w * 0.22, 0);
        b.curve(w * 0.08, 0, 0, h * 0.12, 0, h * 0.26);
        b.curve(0, h * 0.52, w * 0.25, h * 0.73, w * 0.5, h);
        b.curve(w * 0.75, h * 0.73, w, h * 0.52, w, h * 0.26);
        b.curve(w, h * 0.12, w * 0.92, 0, w * 0.78, 0);
        b.curve(w * 0.69, 0, w * 0.57, h * 0.02, w * 0.5, h * 0.23);
        b.close(); break;
      }
      case 'hexagon': polygon(b, [{ x: w * 0.25, y: 0 }, { x: w * 0.75, y: 0 }, { x: w, y: h / 2 }, { x: w * 0.75, y: h }, { x: w * 0.25, y: h }, { x: 0, y: h / 2 }]); break;
      case 'parallelogram': polygon(b, [{ x: w * 0.22, y: 0 }, { x: w, y: 0 }, { x: w * 0.78, y: h }, { x: 0, y: h }]); break;
      case 'trapezoid': polygon(b, [{ x: w * 0.2, y: 0 }, { x: w * 0.8, y: 0 }, { x: w, y: h }, { x: 0, y: h }]); break;
      case 'cylinder': {
        const ry = Math.min(h * 0.15, w * 0.2);
        b.move(0, ry); b.curve(0, -ry / 3, w, -ry / 3, w, ry); b.line(w, h - ry);
        b.curve(w, h + ry / 3, 0, h + ry / 3, 0, h - ry); b.close();
        b.move(0, ry); b.curve(0, ry * 7 / 3, w, ry * 7 / 3, w, ry); b.decorate();
        break;
      }
      case 'cloud': {
        b.move(w * 0.26, h * 0.82);
        const curves = [
          [0.10, 0.87, 0.01, 0.74, 0.06, 0.59], [0.00, 0.40, 0.10, 0.27, 0.26, 0.30],
          [0.29, 0.11, 0.47, 0.03, 0.62, 0.14], [0.77, 0.06, 0.94, 0.22, 0.91, 0.39],
          [1.00, 0.43, 1.00, 0.63, 0.90, 0.69], [0.95, 0.85, 0.77, 0.96, 0.64, 0.86],
          [0.51, 0.98, 0.31, 0.98, 0.26, 0.82]
        ];
        curves.forEach(c => b.curve(c[0] * w, c[1] * h, c[2] * w, c[3] * h, c[4] * w, c[5] * h)); b.close();
        break;
      }
      case 'speech': {
        const rx = w * 0.12, ry = h * 0.12, bottom = h * 0.78;
        b.move(rx, 0); b.line(w - rx, 0); b.quad(w, 0, w, ry); b.line(w, bottom - ry); b.quad(w, bottom, w - rx, bottom);
        b.line(w * 0.44, bottom); b.line(w * 0.22, h); b.line(w * 0.28, bottom); b.line(rx, bottom);
        b.quad(0, bottom, 0, bottom - ry); b.line(0, ry); b.quad(0, 0, rx, 0); b.close();
        break;
      }
      case 'speechoval': {
        b.move(w * 0.5, 0);
        b.curve(w * 0.776, 0, w, h * 0.174, w, h * 0.39);
        b.curve(w, h * 0.59, w * 0.80, h * 0.77, w * 0.57, h * 0.78);
        b.line(w * 0.22, h); b.line(w * 0.28, h * 0.70);
        b.curve(w * 0.10, h * 0.63, 0, h * 0.52, 0, h * 0.39);
        b.curve(0, h * 0.174, w * 0.224, 0, w * 0.5, 0); b.close();
        break;
      }
      case 'frame': {
        const inset = Math.min(w / 2, h / 2, Math.max(2, Math.min(w, h) * 0.12));
        polygon(b, [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]);
        polygon(b, [{ x: inset, y: inset }, { x: w - inset, y: inset }, { x: w - inset, y: h - inset }, { x: inset, y: h - inset }]);
        break;
      }
      default: polygon(b, [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]);
    }
    return b.result();
  }

  function insidePolygon(point, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function isErased(object, localPoint) {
    const erasures = Array.isArray(object.erasures) ? object.erasures : [];
    for (const erasure of erasures) {
      const points = Array.isArray(erasure.points) ? erasure.points.map(copyPoint) : [];
      const radius = Math.max(0, finite(erasure.size)) / 2;
      if (!radius || !points.length) continue;
      if (points.length === 1 && Math.hypot(localPoint.x - points[0].x, localPoint.y - points[0].y) <= radius) return true;
      for (let i = 1; i < points.length; i++) if (distanceToSegment(localPoint, points[i - 1], points[i]) <= radius) return true;
    }
    return false;
  }

  function graphemes(text) {
    if (global.Intl && global.Intl.Segmenter) {
      const segmenter = new global.Intl.Segmenter('zh', { granularity: 'grapheme' });
      return Array.from(segmenter.segment(text), part => part.segment);
    }
    return Array.from(text);
  }

  function textColor(object) {
    const style = object.style || {};
    if (style.fill && style.fill !== 'none' && style.fill !== 'transparent') return style.fill;
    if (style.stroke === 'none' || style.stroke === 'transparent') return 'none';
    return style.stroke || '#111827';
  }

  function textLayout(object, options = {}) {
    const { w, h } = dimensions(object), style = object.style || {};
    const fontSize = Math.max(1, finite(style.fontSize, 28)), lineHeight = Math.max(0.5, finite(style.lineHeight, 1.4));
    const lines = String(object.text == null ? '' : object.text).replace(/\r\n?/g, '\n').split('\n');
    const align = ['left', 'center', 'right'].includes(style.align) ? style.align : 'left';
    const vertical = style.textDirection === 'vertical';
    const runs = [], columns = lines.map(graphemes);
    const widths = lines.map(text => {
      if (typeof options.measureText === 'function') {
        const measured = options.measureText(text, style);
        const width = measured && typeof measured === 'object' ? measured.width : measured;
        if (Number.isFinite(Number(width))) return Math.max(0, Number(width));
      }
      return graphemes(text).reduce((sum, char) => sum + (/^[\x00-\x7f]+$/.test(char) ? 0.58 : 1), 0) * fontSize;
    });
    const naturalWidth = vertical ? fontSize + Math.max(0, lines.length - 1) * fontSize * lineHeight : Math.max(0, ...widths);
    const naturalHeight = vertical ? Math.max(0, ...columns.map(glyphs => glyphs.length)) * fontSize : fontSize + Math.max(0, lines.length - 1) * fontSize * lineHeight;
    if (vertical) {
      lines.forEach((line, column) => {
        const glyphs = columns[column], height = glyphs.length * fontSize;
        const y0 = align === 'center' ? (h - height) / 2 : align === 'right' ? h - height : 0;
        glyphs.forEach((text, row) => runs.push({ text, x: w - fontSize / 2 - column * fontSize * lineHeight, y: y0 + row * fontSize + fontSize * 0.86, anchor: 'middle', box: { x: w - fontSize - column * fontSize * lineHeight, y: y0 + row * fontSize, w: fontSize, h: fontSize } }));
      });
    } else {
      lines.forEach((text, row) => {
        const approximateWidth = widths[row];
        const x = align === 'center' ? w / 2 : align === 'right' ? w : 0;
        const left = align === 'center' ? x - approximateWidth / 2 : align === 'right' ? x - approximateWidth : x;
        runs.push({ text, x, y: row * fontSize * lineHeight + fontSize * 0.86, anchor: align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start', box: { x: left, y: row * fontSize * lineHeight, w: approximateWidth, h: fontSize } });
      });
    }
    const contentBounds = pointBounds(runs.filter(run => run.text).flatMap(run => [{ x: run.box.x, y: run.box.y }, { x: run.box.x + run.box.w, y: run.box.y + run.box.h }]));
    return { runs, fontSize, lineHeight, vertical, width: naturalWidth, height: naturalHeight, contentBounds };
  }

  function arrowStyles(object) {
    const style = object.style || {};
    const valid = value => ['arrow', 'triangle', 'circle'].includes(value) ? value : 'none';
    let start = valid(style.startArrow), end = valid(style.endArrow);
    if (object.type === 'arrow' && end === 'none') end = 'arrow';
    if (object.type === 'doublearrow') { if (start === 'none') start = 'arrow'; if (end === 'none') end = 'arrow'; }
    return { start, end };
  }

  function arrowHit(point, endpoint, adjacent, kind, strokeWidth, tolerance) {
    if (kind === 'none') return false;
    const size = Math.max(10, strokeWidth * 3.8 + 4), angle = Math.atan2(endpoint.y - adjacent.y, endpoint.x - adjacent.x);
    const dx = point.x - endpoint.x, dy = point.y - endpoint.y;
    const along = dx * Math.cos(angle) + dy * Math.sin(angle), across = -dx * Math.sin(angle) + dy * Math.cos(angle);
    if (kind === 'circle') return Math.hypot(along, across) <= size * 0.26 + tolerance;
    const tip = { x: 0, y: 0 }, left = { x: -size * 0.67, y: -size / 3 }, right = { x: -size * 0.67, y: size / 3 };
    const p = { x: along, y: across };
    if (kind === 'triangle' && insidePolygon(p, [tip, left, right])) return true;
    return distanceToSegment(p, tip, left) <= tolerance + strokeWidth / 2 || distanceToSegment(p, tip, right) <= tolerance + strokeWidth / 2;
  }

  // This conservative extent includes paint outside the resize frame, such as thick
  // strokes, endpoint markers, curve controls, and text overflowing a small frame.
  function paintBounds(object) {
    if (object.type === 'image') return bounds(object);
    const style = object.style || {}, localPoints = [], strokeWidth = Math.max(0, finite(style.strokeWidth, 2));
    let padding = 0;
    if (object.type === 'text') {
      const layout = textLayout(object), { w, h } = dimensions(object);
      localPoints.push({ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h });
      for (const run of layout.runs) {
        if (!run.text) continue;
        localPoints.push({ x: run.box.x, y: run.box.y }, { x: run.box.x + run.box.w, y: run.box.y }, { x: run.box.x + run.box.w, y: run.box.y + run.box.h }, { x: run.box.x, y: run.box.y + run.box.h });
        if (!layout.vertical) {
          // The pure layout cannot query installed fonts. Cover wide glyphs such as W,
          // even when a caller has manually made the text frame smaller than its text.
          const conservativeWidth = graphemes(run.text).length * layout.fontSize * 1.2;
          const left = run.anchor === 'middle' ? run.x - conservativeWidth / 2 : run.anchor === 'end' ? run.x - conservativeWidth : run.x;
          localPoints.push({ x: left, y: run.box.y }, { x: left + conservativeWidth, y: run.box.y + run.box.h });
        }
      }
      // Font ascent/descent vary. A small extra margin retains edge pixels for erasing.
      padding = layout.fontSize * 0.15;
    } else {
      const geometry = shapeGeometry(object);
      geometry.contours.forEach(contour => contour.points.forEach(point => localPoints.push(point)));
      if (Array.isArray(object.points)) object.points.forEach(point => localPoints.push(copyPoint(point)));
      if (style.stroke !== 'none' && style.stroke !== 'transparent' && strokeWidth > 0) {
        padding = strokeWidth / 2;
        if (OPEN_TYPES.has(object.type) && geometry.contours[0] && geometry.contours[0].points.length > 1) {
          const points = geometry.contours[0].points, arrows = arrowStyles(object);
          const includeArrow = (endpoint, adjacent, kind) => {
            if (kind === 'none') return;
            const size = Math.max(10, strokeWidth * 3.8 + 4), angle = Math.atan2(endpoint.y - adjacent.y, endpoint.x - adjacent.x);
            const offsets = kind === 'circle' ? [[-size * 0.27, -size * 0.27], [size * 0.27, -size * 0.27], [size * 0.27, size * 0.27], [-size * 0.27, size * 0.27]] : [[0, 0], [-size * 0.67, -size / 3], [-size * 0.67, size / 3]];
            offsets.forEach(([x, y]) => localPoints.push({ x: endpoint.x + x * Math.cos(angle) - y * Math.sin(angle), y: endpoint.y + x * Math.sin(angle) + y * Math.cos(angle) }));
            if (kind === 'arrow') padding = Math.max(padding, size / 16);
          };
          includeArrow(points[0], points[1], arrows.start);
          includeArrow(points[points.length - 1], points[points.length - 2], arrows.end);
        }
      }
    }
    if (!localPoints.length) return bounds(object);
    const box = pointBounds(localPoints.map(point => localToWorld(object, point)));
    return { x: box.x - padding, y: box.y - padding, w: box.w + padding * 2, h: box.h + padding * 2 };
  }

  function hitTest(object, point, tolerance = 5) {
    if (object.visible === false || finite((object.style || {}).opacity, 1) <= 0) return false;
    const local = worldToLocal(object, point), style = object.style || {}, t = Math.max(0, finite(tolerance, 5));
    if (isErased(object, local)) return false;
    if (object.type === 'image') {
      const { w, h } = dimensions(object);
      return w > 0 && h > 0 && local.x >= -t && local.x <= w + t && local.y >= -t && local.y <= h + t;
    }
    if (object.type === 'text') {
      if (textColor(object) === 'none') return false;
      return textLayout(object).runs.some(run => run.text.trim() && local.x >= run.box.x - t && local.x <= run.box.x + run.box.w + t && local.y >= run.box.y - t && local.y <= run.box.y + run.box.h + t);
    }
    const geometry = shapeGeometry(object), strokeWidth = Math.max(0, finite(style.strokeWidth, 2));
    const hasStroke = style.stroke !== 'none' && style.stroke !== 'transparent' && strokeWidth > 0;
    const hasFill = !OPEN_TYPES.has(object.type) && style.fill && style.fill !== 'none' && style.fill !== 'transparent';
    if (hasFill) {
      let inside = false;
      for (const contour of geometry.contours) if (contour.closed && !contour.decorative && insidePolygon(local, contour.points)) inside = !inside;
      if (inside) return true;
    }
    if (hasStroke) {
      const limit = t + strokeWidth / 2;
      for (const contour of geometry.contours) {
        for (let i = 1; i < contour.points.length; i++) if (distanceToSegment(local, contour.points[i - 1], contour.points[i]) <= limit) return true;
        if (contour.closed && distanceToSegment(local, contour.points[contour.points.length - 1], contour.points[0]) <= limit) return true;
      }
      if (OPEN_TYPES.has(object.type) && geometry.contours[0] && geometry.contours[0].points.length > 1) {
        const points = geometry.contours[0].points, arrows = arrowStyles(object);
        if (arrowHit(local, points[0], points[1], arrows.start, strokeWidth, t) || arrowHit(local, points[points.length - 1], points[points.length - 2], arrows.end, strokeWidth, t)) return true;
      }
    }
    return false;
  }

  global.DrawingGeometry = Object.freeze({ bounds, paintBounds, worldToLocal, localToWorld, hitTest, distanceToSegment, normalizePoints, shapeGeometry, textLayout, textColor, arrowStyles, isErased });
})(typeof window !== 'undefined' ? window : globalThis);
