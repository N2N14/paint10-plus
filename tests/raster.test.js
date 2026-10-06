'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ Uint8ClampedArray, Uint8Array, ArrayBuffer, DataView, Array, Number, Math, Error, Object, String, console });
vm.runInContext(fs.readFileSync(path.join(root, 'fill-worker.js'), 'utf8'), context, { filename: 'fill-worker.js' });
const core = context.DrawingFillCore;
let assertions = 0;

function check(condition, message) { assert.ok(condition, message); assertions++; }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function grid(width, height, color = [255, 255, 255, 255]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) pixels.set(color, index * 4);
  return pixels;
}
function pixel(data, width, x, y) { return Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)); }
function paint(data, width, x, y, color) { data.set(color, (y * width + x) * 4); }
const RED = [255, 0, 0, 255], BLACK = [0, 0, 0, 255], WHITE = [255, 255, 255, 255];

// A closed, one-pixel frame must retain its stroke and the outside pixels.
{
  const data = grid(9, 9);
  for (let index = 2; index <= 6; index++) {
    paint(data, 9, index, 2, BLACK); paint(data, 9, index, 6, BLACK);
    paint(data, 9, 2, index, BLACK); paint(data, 9, 6, index, BLACK);
  }
  const result = core.floodFillSync(data, 9, 9, 4, 4, RED, 24);
  check(result.changed, 'closed area changes'); equal(result.count, 9, 'only the nine interior pixels fill');
  equal(pixel(data, 9, 4, 4), RED, 'interior color'); equal(pixel(data, 9, 2, 4), BLACK, 'boundary retained');
  equal(pixel(data, 9, 0, 0), WHITE, 'outside retained');
}

// Fill follows cardinal neighbors only, so touching corners do not leak.
{
  const data = grid(3, 3, BLACK);
  paint(data, 3, 0, 0, WHITE); paint(data, 3, 1, 1, WHITE); paint(data, 3, 2, 2, WHITE);
  const result = core.floodFillSync(data, 3, 3, 0, 0, RED, 24);
  equal(result.count, 1, 'diagonal islands are disconnected'); equal(pixel(data, 3, 1, 1), WHITE, 'diagonal color unchanged');
}

// The tolerance is compared with the seed, never the previously visited pixel.
{
  const data = grid(5, 1);
  [255, 245, 235, 225, 215].forEach((value, index) => paint(data, 5, index, 0, [value, value, value, 255]));
  const result = core.floodFillSync(data, 5, 1, 0, 0, RED, 24);
  equal(result.count, 3, 'color ramp stops at fixed seed tolerance');
  equal(pixel(data, 5, 3, 0), [225, 225, 225, 255], 'antialiased boundary remains');
}

// Invisible RGB values of transparent PNG pixels do not divide one clear region.
{
  const data = grid(4, 1, [0, 0, 0, 0]);
  paint(data, 4, 1, 0, [255, 12, 35, 0]); paint(data, 4, 2, 0, [33, 122, 55, 10]); paint(data, 4, 3, 0, [0, 0, 0, 255]);
  const result = core.floodFillSync(data, 4, 1, 0, 0, RED, 24);
  equal(result.count, 3, 'transparent hidden colors are ignored'); equal(pixel(data, 4, 3, 0), BLACK, 'opaque boundary stays intact');
}

{
  const data = grid(3, 2, RED), before = new Uint8ClampedArray(data);
  const result = core.floodFillSync(data, 3, 2, 1, 1, RED, 24);
  check(!result.changed, 'same color is a no-op'); equal(result.count, 0, 'no pixels changed'); equal(data, before, 'same-color data untouched');
}

// Disjoint horizontal spans and holes exercise scanline enqueuing.
{
  const data = grid(7, 7);
  for (let y = 1; y <= 5; y++) paint(data, 7, 3, y, BLACK);
  const result = core.floodFillSync(data, 7, 7, 0, 0, RED, 0);
  equal(result.count, 44, 'fill reaches both sides around obstacle');
  for (let y = 1; y <= 5; y++) equal(pixel(data, 7, 3, y), BLACK, 'hole retained');
}

// A large job yields regularly; fallback can return control between batches.
{
  const data = grid(500, 200), job = core.createFillJob(data, 500, 200, 0, 0, RED, 0);
  let yielded = 0, step;
  do { step = job.step(); if (!step.done) yielded++; } while (!step.done);
  check(yielded >= 5, 'large fill is split into cooperative batches'); equal(step.value.count, 100000, 'large fill is complete');
}

for (const [x, y] of [[-1, 0], [3, 0], [0, -1], [0, 2], [NaN, 0]]) {
  assert.throws(() => core.floodFillSync(grid(3, 2), 3, 2, x, y, RED), /画板内/); assertions++;
}
assert.throws(() => core.floodFillSync(grid(3, 2), 3, 2, 0, 0, [1, 2, 3, 300]), /颜色/); assertions++;
assert.throws(() => core.floodFillSync(new Uint8ClampedArray(1), 1, 1, 0, 0, RED), /像素数据/); assertions++;

// Compare varied connected components with a simple reference implementation.
function reference(data, width, height, x, y) {
  const color = pixel(data, width, x, y), queue = [y * width + x], visited = new Set(queue);
  let count = 0;
  while (queue.length) {
    const index = queue.pop(), px = index % width, py = Math.floor(index / width);
    if (pixel(data, width, px, py).some((value, channel) => value !== color[channel])) continue;
    paint(data, width, px, py, RED); count++;
    for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
      const neighbor = ny * width + nx;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && !visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
    }
  }
  return count;
}
let randomSeed = 82983;
function random() { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 4294967296; }
for (let trial = 0; trial < 100; trial++) {
  const width = 7 + Math.floor(random() * 20), height = 7 + Math.floor(random() * 20), data = grid(width, height);
  for (let index = 0; index < width * height; index++) if (random() < 0.28) data.set(BLACK, index * 4);
  const x = Math.floor(random() * width), y = Math.floor(random() * height), expected = new Uint8ClampedArray(data);
  const expectedCount = reference(expected, width, height, x, y), result = core.floodFillSync(data, width, height, x, y, RED, 0);
  equal(result.count, expectedCount, 'random flood component count ' + trial); equal(data, expected, 'random flood exact pixels ' + trial);
}

// A Worker sends the computed pixels back as a transferable ArrayBuffer.
{
  let handler, posted;
  const workerScope = {
    addEventListener(name, listener) { if (name === 'message') handler = listener; },
    postMessage(message, transfers) { posted = { message, transfers }; }
  };
  const workerContext = vm.createContext({ self: workerScope, Uint8ClampedArray, Uint8Array, ArrayBuffer, Array, Number, Math, Error, Object });
  vm.runInContext(fs.readFileSync(path.join(root, 'fill-worker.js'), 'utf8'), workerContext);
  const data = grid(2, 2);
  handler({ data: { id: 77, buffer: data.buffer, width: 2, height: 2, x: 0, y: 0, color: RED, tolerance: 0 } });
  equal(posted.message.id, 77, 'worker preserves request ID'); check(posted.message.changed, 'worker reports actual change');
  equal(Array.from(new Uint8ClampedArray(posted.message.buffer)), Array.from(grid(2, 2, RED)), 'worker returns filled pixels');
  equal(posted.transfers.length, 1, 'worker transfers one buffer');
  handler({ data: { id: 78, buffer: data.buffer, width: 2, height: 2, x: -1, y: 0, color: RED } });
  check(/画板内/.test(posted.message.error), 'worker reports a clear validation error');
}

async function testRasterAPI() {
  const canvases = [], revoked = [], markupCalls = [];
  class FakeCanvas {
    constructor() {
      this.width = 1; this.height = 1; this.pixels = null; this.operations = [];
      this.context = {
        drawImage: (...args) => this.operations.push(['draw', ...args]),
        translate: (...args) => this.operations.push(['translate', ...args]),
        rotate: (...args) => this.operations.push(['rotate', ...args]),
        scale: (...args) => this.operations.push(['scale', ...args]),
        getImageData: (x, y, width, height) => {
          if (!this.pixels) this.pixels = grid(this.width, this.height);
          const data = new Uint8ClampedArray(width * height * 4);
          for (let row = 0; row < height; row++) {
            data.set(this.pixels.subarray(((y + row) * this.width + x) * 4, ((y + row) * this.width + x + width) * 4), row * width * 4);
          }
          return { data };
        },
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: imageData => { this.pixels = new Uint8ClampedArray(imageData.data); }
      };
    }
    getContext() { return this.context; }
    toDataURL() { return 'data:image/png;base64,AQ=='; }
  }
  class FakeImage {
    constructor() { this.naturalWidth = 3; this.naturalHeight = 2; }
    set src(value) { this.source = value; queueMicrotask(() => { if (this.onload) this.onload(); }); }
  }
  context.document = {
    fonts: { ready: Promise.resolve() },
    createElement(type) { assert.equal(type, 'canvas'); const canvas = new FakeCanvas(); canvases.push(canvas); return canvas; }
  };
  context.URL = {
    createObjectURL: () => 'blob:test-' + canvases.length,
    revokeObjectURL: value => revoked.push(value)
  };
  context.Blob = Blob; context.Image = FakeImage;
  context.setTimeout = setTimeout; context.clearTimeout = clearTimeout;
  context.DrawingRender = {
    documentMarkup(objects, doc, options) { markupCalls.push({ objects, doc, options }); return '<svg/>'; }
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'raster.js'), 'utf8'), context, { filename: 'raster.js' });
  const raster = context.DrawingRaster, doc = { width: 3, height: 2, objects: [], background: '#FFFFFF' };
  for (const method of ['readImage', 'rasterize', 'fill', 'pickColor', 'crop', 'transform', 'resize']) check(typeof raster[method] === 'function', 'exposes ' + method);
  const composed = await raster.rasterize(doc, { transparent: true });
  equal([composed.width, composed.height], [3, 2], 'rasterize keeps source pixel resolution');
  check(markupCalls.at(-1).options.transparent, 'rasterize forwards transparency');
  check(revoked.length === 1, 'SVG object URL is released');
  await assert.rejects(() => raster.rasterize({ ...doc, width: 12001 }), /图片过大/); assertions++;
  await assert.rejects(() => raster.rasterize({ ...doc, width: 10000, height: 10000 }), /6400 万/); assertions++;
  await assert.rejects(() => raster.rasterize({ ...doc, objects: [{ type: 'image', src: 'https://example.com/a.png' }] }), /外部链接/); assertions++;
  await assert.rejects(() => raster.readImage({ size: 20 * 1024 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer(0) }), /20 MB/); assertions++;
  await assert.rejects(() => raster.readImage(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com"/></svg>'], { type: 'image/png' })), /不接受 SVG/); assertions++;
  const largePNGHeader = new Uint8Array(24);
  largePNGHeader.set([137, 80, 78, 71, 13, 10, 26, 10]); largePNGHeader.set([73, 72, 68, 82], 12);
  const pngView = new DataView(largePNGHeader.buffer); pngView.setUint32(16, 12001); pngView.setUint32(20, 1);
  await assert.rejects(() => raster.readImage(new Blob([largePNGHeader])), /图片过大/); assertions++;
  const validPNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  const image = await raster.readImage(new Blob([validPNG], { type: 'image/png' }));
  check(image.src.startsWith('data:image/png;base64,'), 'import is normalized to embedded PNG');
  equal(await raster.pickColor(doc, { x: 1, y: 1 }), '#FFFFFF', 'picker returns canonical HEX from composite pixels');
  await assert.rejects(() => raster.pickColor(doc, { x: 3, y: 1 }), /画板内/); assertions++;
  const before = JSON.stringify(doc), filled = await raster.fill(doc, { x: 0, y: 0 }, '#ff0000', { tolerance: 0 });
  check(filled.changed, 'cooperative fallback reports a real fill');
  equal(pixel(canvases.at(-1).pixels, 3, 2, 1), RED, 'fallback writes resulting pixels into the canvas');
  equal(JSON.stringify(doc), before, 'raster API does not mutate the document');
  check(!(await raster.fill(doc, { x: 0, y: 0 }, '#FFFFFF')).changed, 'same-color UI fill returns false');
  await assert.rejects(() => raster.fill(doc, { x: 0, y: 0 }, '#F00'), /六位 HEX/); assertions++;
  const cropped = await raster.crop(doc, { x: 1, y: 0, w: 5, h: 1 });
  equal([cropped.width, cropped.height], [2, 1], 'crop clips to the actual source boundary');
  await assert.rejects(() => raster.crop(doc, { x: 4, y: 0, w: 2, h: 1 }), /画板相交/); assertions++;
  const right = await raster.transform(doc, 'right');
  equal([right.width, right.height], [2, 3], 'right rotation swaps actual pixel dimensions');
  equal(canvases.at(-1).operations[0], ['translate', 2, 0], 'right rotation uses source height');
  await raster.transform(doc, 'flip-h');
  equal(canvases.at(-1).operations[1], ['scale', -1, 1], 'horizontal flip mirrors actual image pixels');
  await assert.rejects(() => raster.transform(doc, 'unsupported'), /方式无效/); assertions++;
  const resized = await raster.resize(doc, 7, 4);
  equal([resized.width, resized.height], [7, 4], 'resize creates requested target dimensions');
  equal(canvases.at(-1).operations[0].slice(2), [0, 0, 3, 2, 0, 0, 7, 4], 'resize stretches the full source image');
  check(canvases.at(-1).context.imageSmoothingQuality === 'high', 'resize requests high-quality sampling');
}

async function testPaintImageCommands() {
  const busyStates = [], notices = [], errors = [], applied = [], inserted = [], rasterCalls = [], selections = [];
  let version = 0, clipboard = null, region = { x: 2, y: 3, w: 5, h: 4 }, cleared;
  const result = { src: 'data:image/png;base64,AQ==', width: 20, height: 10, changed: true };
  const input = {
    dataset: {}, value: '', files: [], clicks: 0,
    addEventListener(name, handler) { this.handler = handler; },
    removeEventListener(name, handler) { if (this.handler === handler) this.handler = null; },
    click() { this.clicks++; }
  };
  const rasterMock = {
    fill: async (doc, point, color) => { rasterCalls.push(['fill', point, color]); return result; },
    pickColor: async () => '#123456',
    crop: async (doc, selection, options) => { rasterCalls.push(['crop', selection, options]); return result; },
    transform: async (doc, operation) => { rasterCalls.push(['transform', operation]); return result; },
    resize: async (doc, width, height) => { rasterCalls.push(['resize', width, height]); return result; },
    readImage: async file => { rasterCalls.push(['readImage', file]); return result; },
    rasterize: async (doc, options) => {
      rasterCalls.push(['rasterize', options]);
      return { width: 20, height: 10, getContext: () => ({ clearRect: (...args) => { cleared = args; } }), toDataURL: () => result.src };
    }
  };
  const controller = {
    getDocument: () => ({ width: 20, height: 10, objects: [] }), snapshot: () => String(version),
    applyPixels(before, pixels, label) { if (before !== String(version)) return false; applied.push({ before, pixels, label }); version++; return true; },
    insertImage(image, name, mode) { inserted.push({ image, name, mode }); version++; return true; },
    report: error => errors.push(error), notify: message => notices.push(message),
    getRegion: () => region, setBusy: value => busyStates.push(value),
    getClipboard: () => clipboard, setClipboard: value => { clipboard = value; }, setSelection: ids => selections.push(ids)
  };
  const commandContext = vm.createContext({
    document: { getElementById: id => id === 'image-input' ? input : null }, DrawingRaster: rasterMock,
    navigator: { clipboard: { read: async () => [{ types: ['text/plain', 'image/png'], getType: async () => new Blob(['image']) }] } },
    Error, Object, String, Number, Math, Promise
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'paint-images.js'), 'utf8'), commandContext, { filename: 'paint-images.js' });
  const commands = commandContext.createPaintImages(controller);
  check(await commands.fill({ x: 2, y: 3 }, '#FF0000'), 'image command applies fill');
  equal(applied.at(-1).label, '油漆桶填充', 'fill has an undo label');
  equal(await commands.pick({ x: 1, y: 1 }), '#123456', 'picker command returns HEX');
  check(await commands.crop(), 'crop command applies selected region');
  check(await commands.rotate(180), 'rotation accepts numeric 180'); equal(rasterCalls.at(-1), ['transform', '180'], 'rotation normalizes operation');
  check(await commands.resize(30, 40), 'resize command applies raster result'); equal(rasterCalls.at(-1), ['resize', 30, 40], 'resize forwards target dimensions');
  check(await commands.eraseRegion(), 'erase command clears selected region'); equal(cleared, [2, 3, 5, 4], 'erase clears only selected rectangle');
  check(rasterCalls.some(call => call[0] === 'rasterize' && call[1].transparent), 'erase preserves transparency outside region');
  check(await commands.copy(), 'copy command succeeds'); check(clipboard.image === result, 'copy uses image clipboard format');
  check(rasterCalls.at(-1)[2].transparent, 'copy requests transparent pixels');
  check(await commands.cut(), 'cut command succeeds'); equal(applied.at(-1).label, '剪切选区', 'cut is one undo operation');
  check(clipboard.image === result, 'cut retains the copied image'); check(selections.at(-1).length === 0, 'cut clears selection');
  check(await commands.paste(), 'paste handles image clipboard'); equal(inserted.at(-1).mode, 'paste', 'paste inserts rather than replacing document');
  clipboard = [{ type: 'rect' }]; const insertsBefore = inserted.length;
  check(!(await commands.paste()), 'object clipboard is left for object paste fallback'); equal(inserted.length, insertsBefore, 'object clipboard does not insert a raster');
  clipboard = null; check(await commands.paste(), 'empty internal clipboard reads system image');
  check(rasterCalls.some(call => call[0] === 'readImage' && call[1] instanceof Blob), 'system image uses validated image importer');
  clipboard = []; check(await commands.paste(), 'empty object list also permits system image paste');
  check(commands.open('paste'), 'open command launches file chooser'); equal(input.dataset.mode, 'paste', 'file chooser stores mode'); equal(input.clicks, 1, 'file chooser opens exactly once');
  input.files = [{ name: '示例.png' }]; await input.handler(); equal(inserted.at(-1).name, '示例.png', 'file import keeps its name'); equal(inserted.at(-1).mode, 'paste', 'file change keeps requested import mode');
  let finishFill;
  rasterMock.fill = () => new Promise(resolve => { finishFill = resolve; });
  const countBeforeStale = applied.length, pending = commands.fill({ x: 1, y: 1 }, '#FF0000');
  version++; finishFill(result);
  check(!(await pending), 'stale image result is discarded'); equal(applied.length, countBeforeStale, 'stale result never overwrites edits');
  check(notices.some(message => message.includes('画板已变化')), 'stale result gives a clear notification');
  const running = commands.fill({ x: 1, y: 1 }, '#FF0000');
  check(!(await commands.rotate('right')), 'another raster edit cannot overlap an active operation');
  finishFill(result); check(await running, 'active operation completes after busy conflict');
  rasterMock.fill = async () => { throw new Error('测试图片读取失败'); };
  check(!(await commands.fill({ x: 1, y: 1 }, '#FF0000')), 'failed operation returns false'); check(errors.at(-1).message.includes('读取失败'), 'failed operation is reported');
  equal(busyStates.at(-1), false, 'failed operation clears busy state');
  region = null; check(!(await commands.crop()), 'crop without region is declined'); check(!(await commands.copy()), 'copy without region permits caller fallback');
  commands.destroy(); check(input.handler === null, 'destroy removes file listener');
  check(busyStates.filter(Boolean).length === busyStates.filter(value => !value).length, 'all image commands release busy state');
}

async function testMovingPixels() {
  const made = [], commits = [], errors = [], busyStates = [];
  let version = 0, latestCanvas;
  class PixelCanvas {
    constructor(width = 1, height = 1) { this.width = width; this.height = height; this.values = null; }
    get pixels() {
      if (!this.values || this.values.length !== this.width * this.height * 4) this.values = grid(this.width, this.height, [0, 0, 0, 0]);
      return this.values;
    }
    getContext() {
      const canvas = this;
      return {
        clearRect(x, y, w, h) {
          for (let row = Math.max(0, y); row < Math.min(canvas.height, y + h); row++) {
            for (let column = Math.max(0, x); column < Math.min(canvas.width, x + w); column++) paint(canvas.pixels, canvas.width, column, row, [0, 0, 0, 0]);
          }
        },
        drawImage(source, ...args) {
          let sx = 0, sy = 0, sw = source.width, sh = source.height, dx, dy;
          if (args.length === 2) [dx, dy] = args;
          else [sx, sy, sw, sh, dx, dy] = args;
          const values = new Uint8ClampedArray(source.pixels);
          for (let row = 0; row < sh; row++) for (let column = 0; column < sw; column++) {
            const x = dx + column, y = dy + row;
            if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
            const rgba = pixel(values, source.width, sx + column, sy + row);
            if (rgba[3]) paint(canvas.pixels, canvas.width, x, y, rgba);
          }
        }
      };
    }
    toDataURL() { return 'data:image/png;base64,' + Buffer.from(this.pixels).toString('base64'); }
  }
  const source = grid(5, 3);
  for (let x = 0; x < 5; x++) {
    paint(source, 5, x, 0, [0, 0, x * 40, 255]);
    paint(source, 5, x, 1, [x * 40, 0, 0, 255]);
    paint(source, 5, x, 2, [0, x * 40, 0, 255]);
  }
  const moveContext = vm.createContext({
    document: { getElementById: () => null, createElement: type => { assert.equal(type, 'canvas'); const canvas = new PixelCanvas(); made.push(canvas); return canvas; } },
    DrawingRaster: { rasterize: async (doc, options) => {
      check(options.transparent, 'region move preserves source transparency');
      latestCanvas = new PixelCanvas(5, 3); latestCanvas.pixels.set(source); return latestCanvas;
    } },
    Error, Object, String, Number, Math, Promise
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'paint-images.js'), 'utf8'), moveContext);
  const commands = moveContext.createPaintImages({
    getDocument: () => ({ width: 5, height: 3 }), snapshot: () => String(version),
    applyPixels(before, result, label) { if (before !== String(version)) return false; commits.push({ result, label }); version++; return true; },
    report: error => errors.push(error), notify: () => {}, setBusy: value => busyStates.push(value)
  });
  check(await commands.moveRegion({ x: -1, y: 1, w: 4, h: 2 }, 1.4, 0.4), 'clipped selection moves overlapping source');
  equal([made.at(-1).width, made.at(-1).height], [3, 2], 'temporary canvas only contains visible source pixels');
  equal(commits.at(-1).label, '移动选区', 'pixel move is one undo transaction');
  for (let row = 1; row <= 2; row++) {
    equal(pixel(latestCanvas.pixels, 5, 0, row), [0, 0, 0, 0], 'original leftmost pixel is cleared');
    for (let column = 0; column < 3; column++) equal(pixel(latestCanvas.pixels, 5, column + 1, row), pixel(source, 5, column, row), 'overlap preserves moved source pixel');
    equal(pixel(latestCanvas.pixels, 5, 4, row), pixel(source, 5, 4, row), 'unselected far pixels are preserved');
  }
  for (let column = 0; column < 5; column++) equal(pixel(latestCanvas.pixels, 5, column, 0), pixel(source, 5, column, 0), 'unselected row is preserved');
  equal(Array.from(Buffer.from(commits.at(-1).result.src.split(',')[1], 'base64')), Array.from(latestCanvas.pixels), 'applied result serializes the moved pixels');
  const commitsBefore = commits.length;
  check(!(await commands.moveRegion({ x: 1, y: 1, w: 2, h: 1 }, 0.2, -0.2)), 'rounded zero move is a no-op');
  equal(commits.length, commitsBefore, 'zero move does not add undo');
  check(!(await commands.moveRegion({ x: 20, y: 1, w: 2, h: 1 }, 1, 0)), 'selection outside canvas is a no-op');
  check(!(await commands.moveRegion({ x: 1, y: 1, w: 2, h: 1 }, Infinity, 0)), 'nonfinite delta is rejected');
  check(errors.at(-1).message.includes('有效数值'), 'invalid movement gives a clear error');
  check(await commands.moveRegion({ x: -0.2, y: 0.6, w: 2.4, h: 1.6 }, 1, 0), 'fractional source bounds move');
  equal([made.at(-1).width, made.at(-1).height], [3, 3], 'fractional bounds are clamped with floor and ceil');
  equal(busyStates.at(-1), false, 'move always releases busy state');
}

Promise.resolve().then(testRasterAPI).then(testPaintImageCommands).then(testMovingPixels).then(() => console.log('像素洪泛填充、图片 API 和图片命令：' + assertions + ' 项检查通过。')).catch(error => { console.error(error); process.exitCode = 1; });
