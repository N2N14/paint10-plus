'use strict';

// 核心回归：直接加载交付模块，浏览器存储与下载采用内存替身。
// 图片像素与鼠标交互仍须浏览器验证；这里仅验证 PNG 尺寸保护。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storage = new Map();
const blobs = new Map();
const downloads = [];
let blobSequence = 0;
const sandbox = {
  Intl,
  Blob,
  URL: {
    createObjectURL(blob) { const url = 'blob:test-' + (++blobSequence); blobs.set(url, blob); return url; },
    revokeObjectURL(url) { blobs.delete(url); }
  },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); }
  },
  document: {
    body: { appendChild() {} },
    createElement(tag) {
      assert.equal(tag, 'a', '纯 Node 下载替身只允许创建链接。');
      return { style: {}, click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); }, remove() {} };
    }
  },
  setTimeout() { return 0; }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['geometry.js', 'renderer.js', 'io.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file });
}
const G = sandbox.DrawingGeometry;
const R = sandbox.DrawingRender;
const IO = sandbox.DrawingIO;
const plain = value => JSON.parse(JSON.stringify(value));
const style = { stroke: '#123456', fill: '#abcdef', strokeWidth: 2, opacity: 1, dash: 'solid', fontSize: 20, fontFamily: 'Microsoft YaHei', textDirection: 'horizontal', lineHeight: 1.4, align: 'left', startArrow: 'none', endArrow: 'none' };
function object(extra = {}) { return { id: 'test-object', type: 'rect', name: '测试图形', x: 0, y: 0, w: 100, h: 100, rotation: 0, visible: true, locked: false, points: [], erasures: [], text: '', ...extra, style: { ...style, ...(extra.style || {}) } }; }
function document(objects = [object()], extra = {}) { return { name: '测试作品', width: 1200, height: 800, background: '#ffffff', objects, ...extra }; }
function close(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-7, message || `${actual} 应接近 ${expected}`); }
const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('90° 旋转使用对象中心作为原点', () => {
  const point = G.localToWorld(object({ x: 10, y: 20, w: 100, h: 40, rotation: 90 }), { x: 0, y: 0 });
  close(point.x, 80); close(point.y, -10);
});
test('任意角度坐标转换可以往返', () => {
  const target = object({ x: -24, y: 67, w: 123, h: 41, rotation: 37.5 });
  const point = { x: 18.25, y: -2.75 }, restored = G.worldToLocal(target, G.localToWorld(target, point));
  close(restored.x, point.x); close(restored.y, point.y);
});
test('旋转后的包围盒交换宽高', () => {
  const box = G.bounds(object({ x: 10, y: 20, w: 100, h: 40, rotation: 90 }));
  close(box.x, 40); close(box.y, -10); close(box.w, 40); close(box.h, 100);
});
test('负坐标折线归一化保留每个点的位置', () => {
  const result = G.normalizePoints([{ x: -20, y: 10 }, { x: 30, y: -5 }, { x: 5, y: 25 }]);
  assert.deepEqual(plain(result), { x: -20, y: -5, w: 50, h: 30, points: [{ x: 0, y: 15 }, { x: 50, y: 0 }, { x: 25, y: 30 }] });
});
test('线段距离在终点处截止', () => { close(G.distanceToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5); });
test('有填充矩形可在内部命中', () => { assert.equal(G.hitTest(object(), { x: 50, y: 50 }, 0), true); });
test('中空矩形内部不能误选', () => { assert.equal(G.hitTest(object({ style: { fill: 'none' } }), { x: 50, y: 50 }, 0), false); });
test('中空矩形仍能选择描边', () => { assert.equal(G.hitTest(object({ style: { fill: 'none' } }), { x: 0.5, y: 30 }, 0), true); });
test('椭圆包围框角落不属于椭圆', () => { assert.equal(G.hitTest(object({ type: 'ellipse' }), { x: 2, y: 2 }, 0), false); });
test('填充边框保留中心孔洞', () => { assert.equal(G.hitTest(object({ type: 'frame', style: { stroke: 'none' } }), { x: 50, y: 50 }, 0), false); });
test('填充边框的边缘仍可命中', () => { assert.equal(G.hitTest(object({ type: 'frame', style: { stroke: 'none' } }), { x: 5, y: 50 }, 0), true); });
test('圆柱装饰弧线不会从填充中切出孔洞', () => { assert.equal(G.hitTest(object({ type: 'cylinder', style: { stroke: 'none' } }), { x: 50, y: 18 }, 0), true); });
test('隐藏和零透明度对象不能命中', () => {
  assert.equal(G.hitTest(object({ visible: false }), { x: 50, y: 50 }), false);
  assert.equal(G.hitTest(object({ style: { opacity: 0 } }), { x: 50, y: 50 }), false);
});
const finelyErased = object({ erasures: [{ size: 1, points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] }] });
test('1 px 橡皮擦只覆盖半径 0.5 px', () => {
  assert.equal(G.isErased(finelyErased, { x: 50.49, y: 50 }), true);
  assert.equal(G.isErased(finelyErased, { x: 50.51, y: 50 }), false);
});
test('局部擦除只让已擦区域失去命中', () => {
  assert.equal(G.hitTest(finelyErased, { x: 50, y: 50 }, 0), false);
  assert.equal(G.hitTest(finelyErased, { x: 45, y: 50 }, 0), true);
});
test('擦除后的对象和原始形状仍保留', () => {
  const restored = IO.validateProject(document([finelyErased]));
  assert.equal(restored.objects.length, 1); assert.equal(restored.objects[0].id, finelyErased.id);
  assert.equal(restored.objects[0].w, 100); assert.equal(restored.objects[0].erasures[0].size, 1);
});
test('旋转对象的橡皮轨迹按局部坐标命中', () => {
  const rotated = object({ rotation: 45, erasures: finelyErased.erasures });
  assert.equal(G.hitTest(rotated, G.localToWorld(rotated, { x: 50, y: 50 }), 0), false);
  assert.equal(G.hitTest(rotated, G.localToWorld(rotated, { x: 20, y: 20 }), 0), true);
});
test('单点橡皮生成圆形擦除范围', () => {
  const target = object({ erasures: [{ size: 2, points: [{ x: 20, y: 20 }] }] });
  assert.equal(G.isErased(target, { x: 20.5, y: 20 }), true); assert.equal(G.isErased(target, { x: 22, y: 20 }), false);
  assert.match(R.objectMarkup(target), /<circle[^>]+r="1"[^>]+fill="black"/);
});
test('擦除导出为蒙版，不改变图形路径', () => {
  const markup = R.objectMarkup(finelyErased);
  assert.match(markup, /<mask /); assert.match(markup, /mask="url\(#/); assert.match(markup, /stroke-width="1"/);
  assert.equal(G.shapeGeometry(finelyErased).d, G.shapeGeometry(object()).d);
});
const curve = object({ type: 'curve', style: { fill: 'none' }, points: [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }] });
test('曲线能选中真实弧度，排除控制点位置', () => {
  assert.equal(G.hitTest(curve, { x: 50, y: 50 }, 0.2), true); assert.equal(G.hitTest(curve, { x: 50, y: 100 }, 0.2), false);
});
test('调整曲线控制点改变实际曲率', () => {
  const bent = object({ ...curve, points: [{ x: 0, y: 0 }, { x: 50, y: 200 }, { x: 100, y: 0 }] });
  assert.equal(G.hitTest(bent, { x: 50, y: 100 }, 0.2), true); assert.equal(G.hitTest(bent, { x: 50, y: 50 }, 0.2), false);
  assert.notEqual(G.shapeGeometry(curve).d, G.shapeGeometry(bent).d);
});
test('曲线绘制范围包含框外的控制弧度', () => {
  const target = object({ ...curve, h: 1 });
  assert.ok(G.paintBounds(target).h > 50);
});
test('粗线绘制范围覆盖框外边角', () => {
  const box = G.paintBounds(object({ style: { strokeWidth: 40, fill: 'none' } }));
  assert.ok(box.x <= -20 && box.y <= -20 && box.w >= 140 && box.h >= 140);
});
test('自由画笔对多点路径生成平滑弯线', () => {
  const target = object({ type: 'freehand', points: [{ x: 0, y: 0 }, { x: 30, y: 30 }, { x: 60, y: 0 }, { x: 100, y: 10 }] });
  assert.match(G.shapeGeometry(target).d, /Q/); assert.equal(G.shapeGeometry(target).closed, false);
});
test('横排多行文字尺寸包括行距', () => {
  const layout = G.textLayout(object({ type: 'text', text: '甲乙\nAB', style: { fontSize: 20, lineHeight: 1.4 } }));
  close(layout.width, 40); close(layout.height, 48); assert.equal(layout.runs.length, 2);
});
test('横排文字可使用真实字体测量值', () => {
  const layout = G.textLayout(object({ type: 'text', text: 'W' }), { measureText: () => ({ width: 32.5 }) });
  close(layout.width, 32.5); close(layout.runs[0].box.w, 32.5);
});
test('竖排多列文字尺寸包含列距', () => {
  const layout = G.textLayout(object({ type: 'text', text: '甲乙丙\n丁戊', w: 50, h: 60, style: { textDirection: 'vertical', fontSize: 20, lineHeight: 1.5 } }));
  close(layout.width, 50); close(layout.height, 60); assert.equal(layout.runs.length, 5);
});
test('竖排列顺序从右向左', () => {
  const layout = G.textLayout(object({ type: 'text', text: '甲乙丙\n丁戊', w: 50, h: 60, style: { textDirection: 'vertical', fontSize: 20, lineHeight: 1.5 } }));
  assert.ok(layout.runs[0].x > layout.runs[3].x); assert.equal(layout.runs[3].text, '丁');
});
test('竖排组合表情作为完整字符处理', () => {
  const layout = G.textLayout(object({ type: 'text', text: '👩‍🔬', style: { textDirection: 'vertical' } }));
  assert.equal(layout.runs.length, 1); assert.equal(layout.runs[0].text, '👩‍🔬'); close(layout.height, 20);
});
test('没有可见填充或描边的文字不能命中', () => { assert.equal(G.hitTest(object({ type: 'text', text: '隐藏文字', style: { fill: 'none', stroke: 'none' } }), { x: 10, y: 10 }, 0), false); });
test('文字溢出小框仍在绘制范围内', () => { assert.ok(G.paintBounds(object({ type: 'text', text: 'WWWW', w: 1, h: 1 })).w >= 80); });
test('双向箭头包含两个自包含标记', () => {
  const markup = R.objectMarkup(object({ type: 'doublearrow', h: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
  assert.equal((markup.match(/<marker /g) || []).length, 2); assert.match(markup, /marker-start=/); assert.match(markup, /marker-end=/);
});
test('实心三角箭头可选择箭头内部', () => {
  const target = object({ type: 'line', h: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], style: { fill: 'none', endArrow: 'triangle' } });
  assert.equal(G.hitTest(target, { x: 94, y: 1.5 }, 0), true);
});
test('圆点箭头扩展绘制范围', () => {
  const target = object({ type: 'line', h: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], style: { endArrow: 'circle' } });
  assert.ok(G.paintBounds(target).w > 100); assert.match(R.objectMarkup(target), /<circle[^>]+r="3.2"/);
});
test('点状线条使用圆端点与非零间隔', () => {
  const markup = R.objectMarkup(object({ type: 'line', style: { dash: 'dotted' } }));
  assert.match(markup, /stroke-linecap="round"/); assert.match(markup, /stroke-dasharray="0 [1-9]/);
});
test('自定义虚线长度在 SVG 中保留', () => { assert.match(R.objectMarkup(object({ style: { dash: [3, 1, 1, 1] } })), /stroke-dasharray="3 1 1 1"/); });
test('SVG 文本、标题与属性正确转义', () => {
  const target = object({ type: 'text', id: 'text-id', text: '<script>alert("x")</script>&', style: { fontFamily: 'font" data-evil="yes' } });
  const svg = R.documentMarkup([target], document([target], { name: '<作品>&' }));
  assert.ok(!svg.includes('<script>')); assert.match(svg, /&lt;script&gt;/); assert.match(svg, /<title>&lt;作品&gt;&amp;<\/title>/);
  assert.match(svg, /font-family="font&quot; data-evil=&quot;yes"/);
});
test('SVG 清理 XML 禁止的控制字符和孤立代理码点', () => {
  const escaped = R.escapeXML('甲\u0001\ud800乙\n'); assert.equal(escaped, '甲乙\n');
});
test('SVG 透明导出移除画布背景', () => {
  const doc = document([object()]);
  assert.match(R.documentMarkup(doc.objects, doc), /<rect width="1200" height="800" fill="#ffffff"/);
  assert.ok(!R.documentMarkup(doc.objects, doc, { transparent: true }).includes('<rect width="1200" height="800"'));
});
test('SVG 不导出隐藏对象', () => {
  const svg = R.documentMarkup([object({ id: 'hidden-object', visible: false })], document([]));
  assert.ok(!svg.includes('hidden-object')); assert.match(svg, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
});
const additionalShapes = ['righttriangle', 'pentagon', 'octagon', 'star4', 'star6', 'arrowright', 'arrowleft', 'arrowup', 'arrowdown', 'lightning', 'heart', 'speechoval'];
const shapeTypes = ['rect', 'roundrect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'parallelogram', 'trapezoid', 'cylinder', 'cloud', 'speech', 'frame', 'arc', 'line', 'curve', 'polyline', 'polygon', 'freehand', 'text', 'arrow', 'doublearrow', ...additionalShapes];
test('全部 34 种矢量图形可回导与生成有限 SVG 坐标', () => {
  const objects = shapeTypes.map((type, index) => object({ id: 'shape-' + index, type, text: '示例', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }] }));
  const doc = IO.validateProject(document(objects));
  assert.equal(doc.objects.length, shapeTypes.length);
  const svg = R.documentMarkup(doc.objects, doc); assert.ok(!/NaN|Infinity|undefined/.test(svg));
  assert.equal((svg.match(/data-object-id=/g) || []).length, shapeTypes.length);
});
const concavePoints = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
test('闭合多边形按真实凹轮廓填充，折线保持开放', () => {
  const polygon = object({ type: 'polygon', points: concavePoints, style: { stroke: 'none' } });
  assert.equal(G.shapeGeometry(polygon).closed, true);
  assert.equal(G.hitTest(polygon, { x: 20, y: 80 }, 0), true);
  assert.equal(G.hitTest(polygon, { x: 80, y: 80 }, 0), false);
  assert.equal(G.hitTest(object({ ...polygon, type: 'polyline' }), { x: 20, y: 80 }, 0), false);
  assert.match(R.objectMarkup(polygon), /d="[^"]+Z" fill="#abcdef" fill-rule="evenodd"/);
});
test('中空多边形的最后闭合边可命中，擦除与旋转仍生效', () => {
  const polygon = object({ type: 'polygon', points: concavePoints, rotation: 45, style: { fill: 'none' }, erasures: [{ size: 2, points: [{ x: 0, y: 50 }] }] });
  assert.equal(G.hitTest(polygon, G.localToWorld(polygon, { x: 0, y: 70 }), 0), true);
  assert.equal(G.hitTest(polygon, G.localToWorld(polygon, { x: 0, y: 50 }), 0), false);
  assert.equal(G.hitTest(object({ ...polygon, type: 'polyline' }), G.localToWorld(polygon, { x: 0, y: 70 }), 0), false);
});
test('闭合多边形工程往返保留所有顶点，少于三点被拒绝', () => {
  const doc = IO.validateProject(document([object({ type: 'polygon', points: concavePoints })]));
  const restored = IO.validateProject(JSON.stringify({ format: 'graphite-studio', version: 1, document: doc }));
  assert.deepEqual(plain(restored.objects[0].points), concavePoints);
  assert.equal(restored.objects[0].type, 'polygon');
  assert.throws(() => IO.validateProject(document([object({ type: 'polygon', points: concavePoints.slice(0, 2) })])), /至少需要 3/);
});
test('新增闭合形状均保留独立路径和可填充轮廓', () => {
  const paths = new Set();
  for (const type of additionalShapes) {
    const target = object({ type, style: { stroke: 'none' } }), geometry = G.shapeGeometry(target);
    assert.equal(geometry.closed, true, type); assert.match(geometry.d, /Z$/, type);
    assert.ok(geometry.contours[0].points.length >= 3, type);
    assert.ok(!/NaN|Infinity/.test(geometry.d), type); paths.add(geometry.d);
  }
  assert.equal(paths.size, additionalShapes.length);
});
test('新增多边形和星形的命中沿真实边缘排除框角', () => {
  for (const type of ['righttriangle', 'pentagon', 'octagon', 'star4', 'star6']) {
    const target = object({ type, style: { stroke: 'none' } });
    assert.equal(G.hitTest(target, { x: 50, y: 55 }, 0), true, type);
    assert.equal(G.hitTest(target, { x: 90, y: 5 }, 0), false, type);
  }
});
test('四方向粗箭头可在箭头与箭杆内部选中，角落不会误选', () => {
  const cases = [
    ['arrowright', { x: 95, y: 50 }, { x: 15, y: 50 }, { x: 5, y: 5 }],
    ['arrowleft', { x: 5, y: 50 }, { x: 85, y: 50 }, { x: 95, y: 5 }],
    ['arrowup', { x: 50, y: 5 }, { x: 50, y: 85 }, { x: 5, y: 95 }],
    ['arrowdown', { x: 50, y: 95 }, { x: 50, y: 15 }, { x: 5, y: 5 }]
  ];
  for (const [type, head, shaft, corner] of cases) {
    const target = object({ type, style: { stroke: 'none' } });
    assert.equal(G.hitTest(target, head, 0), true, type + '箭头');
    assert.equal(G.hitTest(target, shaft, 0), true, type + '箭杆');
    assert.equal(G.hitTest(target, corner, 0), false, type + '框角');
    assert.ok(!R.objectMarkup(target).includes('marker-end='), type);
  }
});
test('心形凹槽、闪电和椭圆标注的命中遵循轮廓', () => {
  const heart = object({ type: 'heart', style: { stroke: 'none' } });
  assert.equal(G.hitTest(heart, { x: 50, y: 5 }, 0), false);
  assert.equal(G.hitTest(heart, { x: 25, y: 10 }, 0), true);
  assert.equal(G.hitTest(heart, { x: 50, y: 50 }, 0), true);
  for (const type of ['lightning', 'speechoval']) {
    const target = object({ type, style: { stroke: 'none' } });
    assert.equal(G.hitTest(target, { x: 50, y: 50 }, 0), true, type);
    assert.equal(G.hitTest(target, { x: 5, y: 5 }, 0), false, type);
  }
});
test('新增形状旋转后保留局部擦除和中空描边选择', () => {
  for (const type of additionalShapes) {
    const target = object({ type, rotation: 37, erasures: [{ size: 10, points: [{ x: 50, y: 50 }] }] });
    assert.equal(G.hitTest(target, G.localToWorld(target, { x: 50, y: 50 }), 0), false, type);
    const contour = G.shapeGeometry(target).contours[0], edge = contour.points[0];
    assert.equal(G.hitTest(object({ ...target, erasures: [], style: { fill: 'none' } }), G.localToWorld(target, edge), 0.1), true, type);
  }
});
const pngSource = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6N8AAAAASUVORK5CYII=';
const jpegSource = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 217]).toString('base64');
const webpSource = 'data:image/webp;base64,' + Buffer.from([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 0, 0, 0, 0]).toString('base64');
test('图片的 PNG、JPEG 和 WebP 内嵌源往返保持完整', () => {
  for (const src of [pngSource, jpegSource, webpSource]) {
    const doc = IO.validateProject(document([object({ type: 'image', src })]));
    const restored = IO.validateProject(JSON.stringify({ format: 'graphite-studio', version: 1, document: doc }));
    assert.equal(restored.objects[0].src, src); assert.equal(restored.objects[0].style.stroke, 'none'); assert.equal(restored.objects[0].style.fill, 'none');
    assert.equal(G.shapeGeometry(restored.objects[0]).closed, true);
  }
});
test('图片矩形命中不依赖矢量填充，旋转与擦除仍有效', () => {
  const target = object({ type: 'image', src: pngSource, rotation: 90, w: 80, h: 40, style: { stroke: 'none', fill: 'none' }, erasures: [{ size: 2, points: [{ x: 40, y: 20 }] }] });
  assert.equal(G.hitTest(target, G.localToWorld(target, { x: 20, y: 20 }), 0), true);
  assert.equal(G.hitTest(target, G.localToWorld(target, { x: 40, y: 20 }), 0), false);
  assert.equal(G.hitTest(target, G.localToWorld(target, { x: 85, y: 20 }), 0), false);
  const box = G.paintBounds(target); close(box.w, 40); close(box.h, 80);
});
test('SVG 内嵌图片位于对象旋转和擦除蒙版内', () => {
  const target = object({ type: 'image', src: pngSource, x: 12, y: 34, w: 80, h: 40, rotation: 45, erasures: [{ size: 1, points: [{ x: 4, y: 5 }] }] });
  const markup = R.objectMarkup(target);
  assert.match(markup, /transform="translate\(12 34\) rotate\(45 40 20\)"/);
  assert.match(markup, /<g mask="url\(#[^"]+-erase\)"><image x="0" y="0" width="80" height="40"/);
  assert.ok(markup.includes('href="' + pngSource + '"')); assert.match(markup, /preserveAspectRatio="none"/);
  assert.match(markup, /<mask /); assert.ok(!/NaN|Infinity|undefined/.test(markup));
});
test('SVG 图片属性始终转义引号与 XML 特殊字符', () => {
  const markup = R.objectMarkup(object({ type: 'image', src: pngSource + '" onload="bad<&' }));
  assert.ok(!markup.includes('" onload="bad')); assert.ok(markup.includes('&quot; onload=&quot;bad&lt;&amp;'));
});
test('实际图片工程与 SVG 下载都保留内嵌源和擦除', async () => {
  const doc = document([object({ type: 'image', src: pngSource, erasures: finelyErased.erasures })]);
  IO.exportProject(doc);
  assert.equal(IO.validateProject(await downloads.at(-1).blob.text()).objects[0].src, pngSource);
  IO.exportSvg(doc, false);
  const svg = await downloads.at(-1).blob.text();
  assert.ok(svg.includes(pngSource)); assert.match(svg, /<image /); assert.match(svg, /mask="url\(#/);
});
test('图片必须有正宽高，缺失或零尺寸不会进入工程', () => {
  for (const dimensions of [{ w: 0 }, { h: 0 }, { w: -1 }, { h: -1 }]) assert.throws(() => IO.validateProject(document([object({ type: 'image', src: pngSource, ...dimensions })])), /宽度|高度/);
  assert.throws(() => IO.validateProject(document([object({ type: 'image' })])), /内嵌 PNG/);
});
test('图片拒绝远程链接、本地文件、SVG、脚本和伪造 MIME', () => {
  for (const src of ['https://example.com/a.png', 'file:///C:/a.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,PHN2Zz48L3N2Zz4=', 'data:image/jpeg;base64,aGVsbG8=']) {
    assert.throws(() => IO.validateProject(document([object({ type: 'image', src })])), /内嵌 PNG|文件头/);
  }
});
test('图片严格拒绝破损的 base64 与额外参数', () => {
  for (const src of [pngSource + '<script>', pngSource.replace('base64,', 'charset=utf-8;base64,'), pngSource.replace('iVBOR', 'iV OR'), pngSource + '=', pngSource.replace('iVBOR', '=VBOR')]) {
    assert.throws(() => IO.validateProject(document([object({ type: 'image', src })])), /base64|内嵌 PNG/);
  }
});
test('图片量和对象形式的工程总量均执行 20 MB 限制', () => {
  const prefix = 'data:image/png;base64,', header = pngSource.slice(prefix.length, prefix.length + 16);
  const almostLimitPayloadLength = Math.floor((20 * 1024 * 1024 - prefix.length - 32) / 4) * 4;
  const src = prefix + header + 'A'.repeat(almostLimitPayloadLength - header.length);
  assert.throws(() => IO.validateProject(document([object({ type: 'image', src })])), /工程文件过大/);
  const half = prefix + header + 'A'.repeat(10 * 1024 * 1024 - header.length);
  assert.throws(() => IO.validateProject(document([object({ id: 'image-1', type: 'image', src: half }), object({ id: 'image-2', type: 'image', src: half })])), /图片总量超过 20 MB/);
  assert.throws(() => IO.validateProject(document([object({ type: 'image', src: src + 'AAAA'.repeat(32) })])), /最大 20 MB/);
});
test('旧自动保存示例与新画图存储隔离，旧工程仍可手动导入', () => {
  const legacy = JSON.stringify({ format: 'graphite-studio', version: 1, document: document() });
  storage.set('graphite-studio-project-v1', legacy);
  assert.equal(IO.loadLocal(), null); assert.equal(IO.validateProject(legacy).objects.length, 1);
});
test('画笔与斜体样式保存后保持，非法画笔被拒绝', () => {
  for (const brush of ['pencil', 'brush', 'marker', 'calligraphy']) {
    const target = IO.validateProject(document([object({ type: 'freehand', style: { brush, italic: true } })])).objects[0];
    assert.equal(target.style.brush, brush); assert.equal(target.style.italic, true);
  }
  assert.throws(() => IO.validateProject(document([object({ style: { brush: 'script' } })])), /画笔类型/);
});
test('工程 JSON 往返保留颜色、曲率、竖排与擦除', () => {
  const doc = IO.validateProject(document([object({ ...curve, erasures: finelyErased.erasures }), object({ id: 'vertical-text', type: 'text', text: '甲乙\n丙丁', style: { fill: '#ABC', textDirection: 'vertical' } })]));
  const restored = IO.validateProject(JSON.stringify({ format: 'graphite-studio', version: 1, document: doc }));
  assert.deepEqual(plain(restored), plain(doc)); assert.equal(restored.objects[1].style.fill, '#aabbcc');
});
test('真实工程下载内容可再次打开，文件名清洗', async () => {
  const source = document([finelyErased], { name: 'CON:草稿/版本?' }); IO.exportProject(source);
  const result = downloads.at(-1); assert.match(result.name, /\.graphite$/); assert.ok(!/[<>:"/\\|?*]/.test(result.name));
  assert.equal(IO.validateProject(await result.blob.text()).objects[0].erasures[0].size, 1);
});
test('真实 SVG 下载保留 UTF-8 文字及导出尺寸', async () => {
  IO.exportSvg(document([object({ type: 'text', text: '精准表达' })]), true);
  const result = downloads.at(-1); assert.match(result.name, /\.svg$/); assert.match(await result.blob.text(), /精准表达/); assert.match(await result.blob.text(), /viewBox="0 0 1200 800"/);
});
test('本地保存与恢复可往返', () => {
  assert.equal(IO.loadLocal(), null); assert.equal(IO.saveLocal(document([finelyErased])), true);
  assert.equal(IO.loadLocal().objects[0].erasures[0].size, 1);
});
test('损坏存档报出明确中文错误', () => {
  const key = 'paint10-plus-project-v2', previous = storage.get(key); storage.set(key, '{broken');
  assert.throws(() => IO.loadLocal(), /无法恢复/); storage.set(key, previous);
});
test('存储空间不足提醒手动保存', () => {
  const previous = sandbox.localStorage.setItem; sandbox.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try { assert.throws(() => IO.saveLocal(document()), /下载工程文件/); } finally { sandbox.localStorage.setItem = previous; }
});
test('旧布尔箭头转换为统一枚举', () => {
  const target = IO.validateProject(document([object({ style: { startArrow: true, endArrow: false } })])).objects[0];
  assert.equal(target.style.startArrow, 'arrow'); assert.equal(target.style.endArrow, 'none');
});
test('合法零高度水平线与坐标上限可保存', () => {
  const target = IO.validateProject(document([object({ type: 'line', x: -100000, y: 100000, w: 100000, h: 0, points: [{ x: 0, y: 0 }, { x: 100000, y: 0 }] })])).objects[0];
  assert.equal(target.h, 0); assert.equal(target.x, -100000); assert.equal(target.w, 100000);
});
test('1 × 1 像素画布支持裁剪和保存，零尺寸被拒绝', () => {
  const doc = IO.validateProject(document([], { width: 1, height: 1 }));
  assert.equal(doc.width, 1); assert.equal(doc.height, 1);
  assert.throws(() => IO.validateProject(document([], { width: 0 })), /画布宽度/);
  assert.throws(() => IO.validateProject(document([], { height: 0 })), /画布高度/);
});
test('非有限数字与数字字符串被拒绝', () => {
  for (const value of [NaN, Infinity, '100']) assert.throws(() => IO.validateProject(document([], { width: value })), /有效数字/);
});
test('超限画布、负宽度和过大坐标被拒绝', () => {
  assert.throws(() => IO.validateProject(document([], { width: 12001 })), /画布宽度/);
  assert.throws(() => IO.validateProject(document([object({ w: -1 })])), /宽度/);
  assert.throws(() => IO.validateProject(document([object({ x: 100001 })])), /横坐标/);
});
test('重复和含注入字符的对象标识符被拒绝', () => {
  assert.throws(() => IO.validateProject(document([object(), object()])), /重复对象标识符/);
  assert.throws(() => IO.validateProject(document([object({ id: 'x" onclick="evil' })])), /标识符不合法/);
});
test('不支持的对象类型、版本和损坏 JSON 被拒绝', () => {
  assert.throws(() => IO.validateProject(document([object({ type: 'script' })])), /类型不受支持/);
  assert.throws(() => IO.validateProject({ format: 'graphite-studio', version: 2, document: document() }), /版本暂不受支持/);
  assert.throws(() => IO.validateProject('{invalid'), /有效的 JSON/);
});
test('无效颜色、alpha HEX 和透明画布背景被拒绝', () => {
  for (const color of ['#abcd', '#11223344', 'url(javascript:evil)']) assert.throws(() => IO.validateProject(document([object({ style: { fill: color } })])), /十六进制颜色/);
  assert.throws(() => IO.validateProject(document([], { background: 'none' })), /背景不能为透明色/);
});
test('无效样式枚举与越界字号被拒绝', () => {
  assert.throws(() => IO.validateProject(document([object({ style: { textDirection: 'sideways' } })])), /文字方向/);
  assert.throws(() => IO.validateProject(document([object({ style: { fontSize: 501 } })])), /字号/);
  assert.throws(() => IO.validateProject(document([object({ style: { opacity: -0.1 } })])), /不透明度/);
});
test('空擦除轨迹和非法坐标被拒绝', () => {
  assert.throws(() => IO.validateProject(document([object({ erasures: [{ size: 1, points: [] }] })])), /空白擦除轨迹/);
  assert.throws(() => IO.validateProject(document([object({ points: [{ x: NaN, y: 0 }] })])), /横坐标/);
});
test('超过 2000 个对象的工程被拒绝', () => {
  const objects = Array.from({ length: 2001 }, (_, index) => object({ id: 'limit-' + index }));
  assert.throws(() => IO.validateProject(document(objects)), /最多支持 2000/);
});
test('单轨迹坐标点上限被执行', () => {
  assert.throws(() => IO.validateProject(document([object({ points: Array(20001).fill({ x: 0, y: 0 }) })])), /最多包含 20000/);
});
test('总坐标点上限包含每个对象和擦除记录', () => {
  const objects = Array.from({ length: 12 }, (_, index) => object({ id: 'points-' + index, points: Array(20000).fill({ x: 0, y: 0 }) }));
  objects[0].erasures = [{ size: 1, points: Array(10001).fill({ x: 0, y: 0 }) }];
  assert.throws(() => IO.validateProject(document(objects)), /超过 250000/);
});
test('超长文本不会进入工程', () => { assert.throws(() => IO.validateProject(document([object({ type: 'text', text: '甲'.repeat(50001) })])), /文本必须是长度不超过 50000/); });
test('PNG 超过 6400 万像素时先拒绝分配内存', async () => { await assert.rejects(() => IO.exportPng(document([], { width: 12000, height: 12000 })), /6400 万像素/); });
test('PNG 无效倍率被拒绝', async () => { await assert.rejects(() => IO.exportPng(document(), { scale: 0 }), /导出倍率/); });

(async () => {
  let passed = 0;
  for (const { name, run } of tests) {
    try { await run(); passed++; }
    catch (error) { console.error('失败：' + name); throw error; }
  }
  console.log('通过 ' + passed + ' 项核心回归测试（几何、擦除、文字、SVG、工程和数据边界）。');
})().catch(error => { console.error(error); process.exitCode = 1; });
