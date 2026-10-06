/* UTF-8. The same scanline engine runs in a Worker and in a yielding fallback. */
(function (scope) {
  'use strict';

  const YIELD_EVERY = 20000;

  function prepare(data, width, height, x, y, color, tolerance) {
    if (!(data instanceof Uint8ClampedArray) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) {
      throw new Error('填充像素数据无效。');
    }
    if (width > 12000 || height > 12000 || width * height > 64000000) throw new Error('画板过大：单边最多 12000 像素，总计最多 6400 万像素。');
    if (!Array.isArray(color) || color.length !== 4 || color.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error('填充颜色无效。');
    const startX = Math.floor(Number(x)), startY = Math.floor(Number(y));
    if (!Number.isFinite(startX) || !Number.isFinite(startY) || startX < 0 || startY < 0 || startX >= width || startY >= height) throw new Error('填充点必须在画板内。');
    return { data, width, height, startX, startY, color, tolerance: Math.min(255, Math.max(0, Math.round(Number(tolerance) || 0))) };
  }

  function* fillGenerator(options) {
    const { data, width, height, startX, startY, color, tolerance } = options;
    const start = startY * width + startX, seed = Array.from(data.subarray(start * 4, start * 4 + 4));
    if (seed.every((value, channel) => value === color[channel])) return { data, changed: false, count: 0 };
    const marks = new Uint8Array(width * height), stack = [start];
    marks[start] = 1;
    let scans = 0, count = 0;
    // Comparing every pixel with the original seed prevents a gradual color ramp
    // from letting fill drift through an antialiased boundary. Transparent RGB is
    // invisible, so compare alpha and premultiplied color rather than hidden RGB.
    const matches = index => {
      const offset = index * 4, alpha = data[offset + 3];
      if (Math.abs(alpha - seed[3]) > tolerance) return false;
      for (let channel = 0; channel < 3; channel++) {
        if (Math.abs(data[offset + channel] * alpha / 255 - seed[channel] * seed[3] / 255) > tolerance) return false;
      }
      return true;
    };
    const enqueue = index => {
      if (marks[index] !== 0) return;
      marks[index] = 1;
      stack.push(index);
    };
    while (stack.length) {
      const index = stack.pop();
      if (++scans >= YIELD_EVERY) { scans = 0; yield { count }; }
      if (marks[index] === 2 || !matches(index)) continue;
      const row = Math.floor(index / width), rowStart = row * width;
      let left = index - rowStart;
      while (left > 0 && marks[rowStart + left - 1] !== 2 && matches(rowStart + left - 1)) {
        left--;
        if (++scans >= YIELD_EVERY) { scans = 0; yield { count }; }
      }
      let previousUp = false, previousDown = false;
      for (let column = left; column < width; column++) {
        const current = rowStart + column;
        if (++scans >= YIELD_EVERY) { scans = 0; yield { count }; }
        if (marks[current] === 2 || !matches(current)) break;
        marks[current] = 2;
        const offset = current * 4;
        data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2]; data[offset + 3] = color[3];
        count++;
        const up = row > 0 && marks[current - width] !== 2 && matches(current - width);
        const down = row < height - 1 && marks[current + width] !== 2 && matches(current + width);
        if (up && !previousUp) enqueue(current - width);
        if (down && !previousDown) enqueue(current + width);
        previousUp = up; previousDown = down;
      }
    }
    return { data, changed: count > 0, count };
  }

  function createFillJob(data, width, height, x, y, color, tolerance = 24) {
    const iterator = fillGenerator(prepare(data, width, height, x, y, color, tolerance));
    return { step: () => iterator.next() };
  }

  function floodFillSync(data, width, height, x, y, color, tolerance = 24) {
    const job = createFillJob(data, width, height, x, y, color, tolerance);
    let step;
    do { step = job.step(); } while (!step.done);
    return step.value;
  }

  scope.DrawingFillCore = Object.freeze({ createFillJob, floodFillSync, yieldEvery: YIELD_EVERY });
  if (typeof scope.postMessage === 'function' && typeof scope.document === 'undefined' && typeof scope.addEventListener === 'function') {
    scope.addEventListener('message', event => {
      const request = event.data || {};
      try {
        const result = floodFillSync(new Uint8ClampedArray(request.buffer), request.width, request.height, request.x, request.y, request.color, request.tolerance);
        scope.postMessage({ id: request.id, buffer: result.data.buffer, changed: result.changed, count: result.count }, [result.data.buffer]);
      } catch (error) {
        scope.postMessage({ id: request.id, error: error && error.message || '像素填充失败。' });
      }
    });
  }
})(typeof self !== 'undefined' ? self : globalThis);
