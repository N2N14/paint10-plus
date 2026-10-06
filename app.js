/* 画图增强版 — UTF-8, dependency-free interaction controller. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const G = window.DrawingGeometry;
  const R = window.DrawingRender;
  const IO = window.DrawingIO;
  const Pixels = window.DrawingRaster;
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const uid = () => 'o-' + (window.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  const labels = { select:'选择',hand:'移动画布',freehand:'自由画笔',line:'直线',curve:'贝塞尔曲线',polyline:'折线',rect:'矩形',roundrect:'圆角矩形',ellipse:'椭圆',diamond:'菱形',triangle:'三角形',star:'星形',hexagon:'六边形',parallelogram:'平行四边形',trapezoid:'梯形',cylinder:'圆柱',cloud:'云形',speech:'对话框',frame:'边框',arc:'弧线',arrow:'箭头',doublearrow:'双向箭头',text:'文字',eraser:'精细橡皮',eyedropper:'吸管' };
  const hints = { select:'拖动移动 · Shift 多选 · 双击编辑文字',hand:'拖动平移画布 · 滚轮缩放',freehand:'按住并绘制 · 调整描边与线宽',curve:'拖动绘制 · 选中后拖动蓝色控制点调整弧度',polyline:'逐点单击 · 双击或 Enter 完成 · Esc 取消',text:'点击画布添加文字 · 支持横排与竖排',eraser:'拖动擦除局部 · 支持 1 px 精细擦除 · 可撤销',eyedropper:'点击图形采集颜色 · 右侧选择描边或填充' };
  Object.assign(labels,{fill:'填充颜色',zoom:'放大镜',image:'图像',polygon:'多边形',righttriangle:'直角三角形',pentagon:'五边形',octagon:'八边形',star4:'四角星',star6:'六角星',arrowright:'向右箭头',arrowleft:'向左箭头',arrowup:'向上箭头',arrowdown:'向下箭头',lightning:'闪电',heart:'心形',speechoval:'椭圆对话框'});
  Object.assign(hints,{fill:'单击填充封闭区域 · 右键使用颜色 2',zoom:'单击放大 · 右键缩小',polyline:'逐点单击 · 点起点闭合多边形 · Enter 完成折线'});
  const baseStyle = { stroke:'#000000',fill:'none',strokeWidth:1,dash:'solid',opacity:1,startArrow:'none',endArrow:'none',fontFamily:'Microsoft YaHei',fontSize:28,bold:false,italic:false,brush:'pencil',textDirection:'horizontal',align:'left',lineHeight:1.4 };
  let defaults = clone(baseStyle);
  let doc = { name:'未命名画布',width:900,height:520,background:'#FFFFFF',objects:[] };
  let region = null, busy = false, activeColor = 'primary', rulersVisible = false;
  const paintColors = {primary:'#000000',secondary:'#FFFFFF'};
  let selected = [];
  let tool = 'select';
  let view = { zoom:1,x:0,y:0 };
  let action = null;
  let polyline = null;
  let pointer = { x:0,y:0 };
  let past = [], future = [];
  let renderQueued = false, saveTimer, toastTimer, rangeSnapshot = null;
  let spaceDown = false, clipboard = null, editingTextId = null, textPosition = null;
  let storageWarningShown = false;
  let layerSignature = '';
  const viewport = $('viewport');
  const svg = $('drawing-svg');
  const snapshot = () => JSON.stringify(doc);
  const selectionObjects = () => doc.objects.filter(o => selected.includes(o.id));
  const firstSelected = () => doc.objects.find(o => o.id === selected[0]);
  const editableSelection = () => selectionObjects().filter(o => !o.locked);
  const esc = s => String(s).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'),3500);
  }
  function fail(error) { console.error(error); toast(error.message || '操作未完成，请重试。'); }
  function persist() {
    $('save-status').textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const saved = IO.saveLocal(doc);
        $('save-status').textContent = saved === false ? '请保存工程' : '已自动保存';
        if (saved === false && !storageWarningShown) { storageWarningShown = true; toast('浏览器存储不可用，请用「保存工程」保留作品。'); }
      } catch (e) {
        $('save-status').textContent = '请保存工程';
        if (!storageWarningShown) { storageWarningShown = true; toast('自动保存空间不足，请用「保存工程」保留作品。'); }
      }
    },500);
  }
  function commit(before) {
    let after = snapshot();
    if (before !== after) {
      try {
        if (after.length > 20*1024*1024) throw new Error('工程超过 20 MB，请拆分画布或减少对象。');
        IO.validateProject(doc);
      } catch (error) {
        doc = JSON.parse(before); action = null; polyline = null; rangeSnapshot = null;
        selected = selected.filter(id => doc.objects.some(o => o.id === id));
        toast('未应用更改：'+error.message); updateUI(); scheduleRender(); return false;
      }
      past.push(before);
      trimHistory(past);
      future = [];
      persist();
    }
    updateUI(); scheduleRender();
    return true;
  }
  function trimHistory(history) {
    let size = history.reduce((sum,item) => sum+item.length,0);
    while (history.length > 1 && (history.length > 70 || size > 16*1024*1024)) size -= history.shift().length;
  }
  function transact(fn) { const before = snapshot(); fn(); commit(before); }
  function restore(data) {
    doc = JSON.parse(data); selected = []; region = null; action = null; polyline = null;
    updateUI(); scheduleRender(); persist();
  }
  function undo() {
    cancelAction();
    if (!past.length) return;
    future.push(snapshot()); trimHistory(future); restore(past.pop()); toast('已撤销');
  }
  function redo() {
    cancelAction();
    if (!future.length) return;
    past.push(snapshot()); trimHistory(past); restore(future.pop()); toast('已重做');
  }
  function setSelection(ids) {
    region = null;
    selected = ids.filter(id => doc.objects.some(o => o.id === id));
    updateUI(); scheduleRender();
  }
  function setTool(value) {
    cancelAction(); tool = value;
    if (!['select','hand','eyedropper'].includes(value)) { selected = []; region = null; }
    document.querySelectorAll('button[data-tool]').forEach(b => { b.classList.toggle('active',b.dataset.tool === tool); b.setAttribute('aria-pressed',String(b.dataset.tool === tool)); });
    viewport.dataset.tool = tool;
    $('tool-label').textContent = labels[tool];
    const shortcut={select:'V',hand:'H',freehand:'B',line:'L',curve:'C',polyline:'P',rect:'R',ellipse:'O',text:'T',eraser:'E',eyedropper:'I'}[tool];
    $('tool-shortcut').textContent=shortcut||'';$('tool-shortcut').hidden=!shortcut;
    $('tool-hint').textContent = hints[tool] || '拖动绘制 · 按住 Shift 约束比例 · Esc 取消';
    $('text-panel').hidden = tool !== 'text' && firstSelected()?.type !== 'text';
    $('eraser-panel').hidden = tool !== 'eraser';
    $('eraser-cursor').hidden = true;
    if (value === 'eraser') { $('enhancements-panel').hidden = false; $('enhancements-toggle').setAttribute('aria-expanded','true'); }
    updateUI();
    scheduleRender();
  }
  function worldPoint(e, snap = false) {
    const b = viewport.getBoundingClientRect();
    let x = (e.clientX-b.left+viewport.scrollLeft-view.x)/view.zoom, y = (e.clientY-b.top+viewport.scrollTop-view.y)/view.zoom;
    if (snap && $('snap-toggle').checked && !e.altKey) { x = Math.round(x/10)*10; y = Math.round(y/10)*10; }
    return {x,y};
  }
  const inside = p => p.x >= 0 && p.y >= 0 && p.x < doc.width && p.y < doc.height;
  function hit(p, includeLocked = true) {
    return [...doc.objects].reverse().find(o => o.visible !== false && (includeLocked || !o.locked) && G.hitTest(o,p,5/view.zoom));
  }
  function applyView() {
    $('canvas-container').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
    const percent = Math.round(view.zoom*100);
    const zoomSelect = $('zoom-select');
    zoomSelect.querySelector('[data-custom]')?.remove();
    if (![...zoomSelect.options].some(o => +o.value === percent)) { const o = new Option(percent+'%',String(percent)); o.dataset.custom = 'true'; zoomSelect.add(o); }
    zoomSelect.value = String(percent);
    $('zoom-slider').value = percent;
    drawRulers(); scheduleRender();
  }
  function fitView() {
    const b = viewport.getBoundingClientRect();
    view.zoom = clamp(Math.min((b.width-96)/doc.width,(b.height-100)/doc.height),0.1,2);
    view.x = Math.max(8,(b.width-doc.width*view.zoom)/2);
    view.y = Math.max(8,(b.height-doc.height*view.zoom)/2);
    viewport.scrollLeft = viewport.scrollTop = 0;
    applyView();
  }
  function actualSize() { const origin=$('rulers-toggle').checked?32:8;view={zoom:1,x:origin,y:origin}; viewport.scrollLeft=viewport.scrollTop=0; applyView(); }
  function zoomTo(zoom, client = null) {
    const b = viewport.getBoundingClientRect();
    const p = client || { x:b.width/2,y:b.height/2 };
    const w = {x:(p.x+viewport.scrollLeft-view.x)/view.zoom,y:(p.y+viewport.scrollTop-view.y)/view.zoom};
    view.zoom = clamp(zoom,0.1,8); view.x = Math.max(8,p.x-w.x*view.zoom); view.y = Math.max(8,p.y-w.y*view.zoom);
    applyView();
    viewport.scrollLeft=Math.max(0,w.x*view.zoom+view.x-p.x); viewport.scrollTop=Math.max(0,w.y*view.zoom+view.y-p.y);drawRulers();
  }
  function drawRulers() {
    const step = view.zoom < 0.35 ? 200 : view.zoom < 0.8 ? 100 : view.zoom < 2 ? 50 : 20;
    for (const [id,vertical,offset] of [['ruler-top',false,view.x-viewport.scrollLeft],['ruler-left',true,view.y-viewport.scrollTop]]) {
      const el = $(id), length = vertical ? viewport.clientHeight : viewport.clientWidth;
      el.style.left=viewport.scrollLeft+'px';el.style.top=viewport.scrollTop+'px';
      if (el.tagName === 'CANVAS') {
        const dpr = window.devicePixelRatio || 1;
        el.width = (vertical ? 24 : length)*dpr; el.height = (vertical ? length : 24)*dpr;
        const ctx = el.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,el.width,el.height);
        ctx.strokeStyle = '#D8DCE5'; ctx.fillStyle = '#8C95A6'; ctx.font = '9px Arial';
        for (let value = Math.floor(-offset/view.zoom/step)*step; value*view.zoom+offset <= length; value += step/5) {
          const at = value*view.zoom+offset; if (at < 0) continue;
          const major = Math.abs(value/step-Math.round(value/step)) < 0.01;
          ctx.beginPath(); if (vertical) { ctx.moveTo(24,at); ctx.lineTo(major?13:19,at); } else { ctx.moveTo(at,24); ctx.lineTo(at,major?13:19); } ctx.stroke();
          if (major) { if (vertical) { ctx.save(); ctx.translate(9,at+3); ctx.rotate(-Math.PI/2); ctx.fillText(Math.round(value),0,0); ctx.restore(); } else ctx.fillText(Math.round(value),at+3,10); }
        }
      } else {
        const marks = [];
        for (let n = Math.ceil(-offset/view.zoom/step)*step; n*view.zoom+offset < length; n += step) marks.push(`<span style="position:absolute;${vertical?'top':'left'}:${n*view.zoom+offset}px">${n}</span>`);
        el.innerHTML = marks.join('');
      }
    }
    const corner=document.querySelector('.ruler-corner');corner.style.left=viewport.scrollLeft+'px';corner.style.top=viewport.scrollTop+'px';
  }
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }
  function render() {
    svg.setAttribute('width',doc.width); svg.setAttribute('height',doc.height); svg.setAttribute('viewBox',`0 0 ${doc.width} ${doc.height}`);
    $('canvas-container').style.width = doc.width+'px'; $('canvas-container').style.height = doc.height+'px';
    $('paper-background').setAttribute('width',doc.width); $('paper-background').setAttribute('height',doc.height); $('paper-background').setAttribute('fill',doc.background);
    $('canvas-defs').innerHTML = `<pattern id="canvas-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0 H0 V20" fill="none" stroke="#CED6DF" stroke-width="0.5"/></pattern><clipPath id="paper-clip"><rect width="${doc.width}" height="${doc.height}"/></clipPath>`;
    $('objects-layer').setAttribute('clip-path','url(#paper-clip)');$('preview-layer').setAttribute('clip-path','url(#paper-clip)');
    $('grid-layer').innerHTML = $('grid-toggle').checked ? `<rect width="${doc.width}" height="${doc.height}" fill="url(#canvas-grid)" pointer-events="none"/>` : '';
    $('objects-layer').innerHTML = doc.objects.filter(o => o.visible !== false).map(o => R.objectMarkup(o,{interactive:true})).join('');
    $('selection-layer').innerHTML = selectionMarkup();
    let preview = '';
    if (action?.kind === 'draw' && action.object) preview = R.objectMarkup(action.object);
    if (action?.kind === 'marquee') { const a = action.start, b = pointer; preview = `<rect x="${Math.min(a.x,b.x)}" y="${Math.min(a.y,b.y)}" width="${Math.abs(a.x-b.x)}" height="${Math.abs(a.y-b.y)}" fill="#5266E81A" stroke="#5266E8" stroke-width="${1/view.zoom}"/>`; }
    if (polyline) {
      const points = [...polyline.points,pointer];
      const n = G.normalizePoints(points);
      preview = R.objectMarkup({id:'preview',type:'polyline',x:n.x,y:n.y,w:n.w,h:n.h,points:n.points,style:defaults,visible:true});
      preview += polyline.points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${3/view.zoom}" fill="#5266E8"/>`).join('');
    }
    $('preview-layer').innerHTML = preview;
    $('object-count').textContent = doc.objects.length+' 个对象';
  }
  function selectionMarkup() {
    if (tool !== 'select' && !['curve','line','text'].includes(tool)) return '';
    const s = 7/view.zoom, line = 1/view.zoom;
    if (region) return `<rect x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" fill="none" stroke="#000000" stroke-width="${line}" stroke-dasharray="${3/view.zoom} ${3/view.zoom}" pointer-events="none"/>`;
    if (selected.length > 1) return selectionObjects().filter(o=>o.visible !== false).map(o => {const b=G.bounds(o);return `<rect x="${b.x-3/view.zoom}" y="${b.y-3/view.zoom}" width="${Math.max(b.w,2)}" height="${Math.max(b.h,2)}" fill="none" stroke="#5266E8" stroke-width="${line}" stroke-dasharray="${4/view.zoom} ${3/view.zoom}" pointer-events="none"/>`;}).join('');
    const o = firstSelected(); if (!o || o.visible === false) return '';
    const w = Math.max(o.w,1), h = Math.max(o.h,1);
    let m = `<g transform="translate(${o.x} ${o.y}) rotate(${o.rotation||0} ${w/2} ${h/2})"><rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#5266E8" stroke-width="${line}" pointer-events="none"/>`;
    if (!o.locked) {
      for (const [name,x,y] of [['nw',0,0],['ne',w,0],['sw',0,h],['se',w,h]]) m += `<rect data-handle="${name}" x="${x-s/2}" y="${y-s/2}" width="${s}" height="${s}" rx="${1/view.zoom}" fill="white" stroke="#5266E8" stroke-width="${line}" style="cursor:${name==='nw'||name==='se'?'nwse':'nesw'}-resize"/>`;
      m += `<path d="M ${w/2} 0 L ${w/2} ${-24/view.zoom}" stroke="#5266E8" stroke-width="${line}" pointer-events="none"/><circle data-handle="rotate" cx="${w/2}" cy="${-28/view.zoom}" r="${4/view.zoom}" fill="white" stroke="#5266E8" stroke-width="${line}" style="cursor:grab"/>`;
      if (o.type === 'curve' && o.points?.length === 3) {
        const [a,c,b] = o.points;
        m += `<path d="M${a.x} ${a.y} L${c.x} ${c.y} L${b.x} ${b.y}" stroke="#8D9AF1" stroke-width="${line}" stroke-dasharray="${4/view.zoom} ${4/view.zoom}" fill="none" pointer-events="none"/>`;
      }
      if (['line','curve','arrow','doublearrow'].includes(o.type) && o.points) o.points.forEach((p,i)=>{ m += `<circle data-handle="point-${i}" cx="${p.x}" cy="${p.y}" r="${5/view.zoom}" fill="${o.type==='curve'&&i===1?'#5266E8':'white'}" stroke="#5266E8" stroke-width="${line}" style="cursor:move"/>`; });
    }
    return m+'</g>';
  }
  function updateUI() {
    const o = firstSelected(), style = o?.style || defaults;
    $('document-name').value = doc.name;
    document.title=doc.name+' - 画图增强版';
    $('undo').disabled = !past.length; $('redo').disabled = !future.length;
    $('selection-label').textContent = selected.length > 1 ? `已选择 ${selected.length} 个对象` : o ? `${o.name || labels[o.type]}${o.locked?' · 已锁定':''}` : '绘制属性';
    $('stroke-color').value = paintColors.primary; $('fill-color').value = paintColors.secondary;
    $('stroke-picker').value = paintColors.primary; $('fill-picker').value = paintColors.secondary;
    $('primary-color-chip').style.background = paintColors.primary; $('secondary-color-chip').style.background = paintColors.secondary;
    $('primary-color').classList.toggle('active',activeColor === 'primary'); $('secondary-color').classList.toggle('active',activeColor === 'secondary');
    $('outline-mode').value = style.stroke === 'none' ? 'none' : 'solid'; $('fill-mode').value = style.fill === 'none' ? 'none' : 'solid';
    $('brush-style').value = defaults.brush || 'pencil';
    $('stroke-none').classList.toggle('active',style.stroke === 'none'); $('fill-none').classList.toggle('active',style.fill === 'none');
    $('stroke-width').value = style.strokeWidth; $('line-style').value = style.dash;
    $('opacity').value = Math.round(style.opacity*100); $('opacity-value').textContent = Math.round(style.opacity*100)+'%';
    $('start-arrow').value = style.startArrow; $('end-arrow').value = style.endArrow;
    $('font-family').value = style.fontFamily; $('font-size').value = style.fontSize;
    $('text-direction').value = style.textDirection; $('text-align').value = style.align;
    $('font-bold').checked = style.bold; $('line-height').value = style.lineHeight;
    $('text-content').value = o?.type === 'text' ? o.text || '' : '';
    $('text-panel').hidden = tool !== 'text' && o?.type !== 'text'; $('eraser-panel').hidden = tool !== 'eraser';
    $('geometry-panel').classList.toggle('muted',!o);
    for (const [id,key] of [['object-x','x'],['object-y','y'],['object-w','w'],['object-h','h'],['object-rotation','rotation']]) { $(id).value = o ? Math.round((o[key]||0)*10)/10 : ''; $(id).disabled = !o || o.locked || selected.length > 1; }
    for (const id of ['bring-forward','send-backward','duplicate-object','delete-object']) $(id).disabled = !selected.length || !editableSelection().length;
    $('canvas-width').value = doc.width; $('canvas-height').value = doc.height; $('canvas-background').value = doc.background;
    $('canvas-size-status').textContent = `${doc.width} × ${doc.height} 像素`;
    const area = getRegion(); $('selection-size-status').textContent = area ? `${Math.round(area.w)} × ${Math.round(area.h)} 像素` : '';
    $('crop-selection').disabled = !area || busy;
    $('clipboard-copy').disabled = !area; $('clipboard-cut').disabled = !area;
    updateRGB(); renderLayers();
    for (const input of document.querySelectorAll('#document-name,#stroke-color,#fill-color,#color-r,#color-g,#color-b,#stroke-width,#font-size,#line-height,#text-content,#object-x,#object-y,#object-w,#object-h,#object-rotation')) input.dataset.committedValue = input.value;
    $('status-message').textContent = busy ? '正在处理图像…' : o?.locked ? '此对象已锁定，请在图层中解锁' : region ? '已选择图像区域，可复制或裁剪' : selected.length ? `${selected.length} 个对象已选中` : (hints[tool] || '按住 Shift 可绘制正方形或正圆');
  }
  function updateRGB() {
    const target = $('color-target').value;
    const color = paintColors[target === 'fill' ? 'secondary' : 'primary'];
    const rgb = [1,3,5].map(n=>parseInt(color.slice(n,n+2),16));
    ['color-r','color-g','color-b'].forEach((id,i)=>$(id).value=rgb[i]);
  }
  function renderLayers() {
    const signature = JSON.stringify(doc.objects.map(o=>[o.id,o.name,o.type,o.visible,o.locked,selected.includes(o.id)]));
    if (signature === layerSignature) return;
    layerSignature = signature;
    $('layers-list').innerHTML = [...doc.objects].reverse().map(o=>`<div class="layer-item${selected.includes(o.id)?' selected':''}${o.visible===false?' is-hidden':''}" data-layer-id="${esc(o.id)}" role="listitem"><button class="layer-name" data-layer-action="select" title="选择${esc(o.name||labels[o.type])}"><span class="layer-type">${o.type==='text'?'T':o.type==='ellipse'?'○':['line','curve','arrow','doublearrow'].includes(o.type)?'↗':'◇'}</span><span>${esc(o.name||labels[o.type])}</span></button><div class="layer-actions"><button data-layer-action="visible" title="${o.visible===false?'显示':'隐藏'}对象" aria-label="${o.visible===false?'显示':'隐藏'}对象">${o.visible===false?'◌':'◉'}</button><button data-layer-action="lock" title="${o.locked?'解锁':'锁定'}对象" aria-label="${o.locked?'解锁':'锁定'}对象">${o.locked?'▣':'▢'}</button></div></div>`).join('') || '<div class="layers-empty">画布上的每个图形<br>都会出现在这里</div>';
  }
  function parseColor(raw) {
    const s = raw.trim();
    if (/^(无|none|transparent)$/i.test(s)) return 'none';
    if (/^#?[0-9a-f]{6}$/i.test(s)) return '#'+s.replace('#','').toUpperCase();
    if (/^#?[0-9a-f]{3}$/i.test(s)) return '#'+s.replace('#','').split('').map(c=>c+c).join('').toUpperCase();
    throw new Error('请输入正确的 HEX 色号，例如 #5266E8；或输入“无”。');
  }
  function textSize(o) {
    const s=o.style, ctx=document.createElement('canvas').getContext('2d');
    ctx.font=`${s.bold?'bold ':''}${s.fontSize}px "${s.fontFamily}"`;
    const layout=G.textLayout(o,{measureText:text=>ctx.measureText(text)});
    o.w=Math.max(s.fontSize,layout.width);o.h=Math.max(s.fontSize,layout.height);
  }
  function changeStyle(key,value,before = null) {
    const start = before || snapshot(); defaults[key] = value;
    editableSelection().forEach(o => { o.style[key] = value; if (o.type==='text' && ['fontSize','fontFamily','bold','textDirection','lineHeight'].includes(key)) textSize(o); });
    commit(start);
  }
  function setColorSlot(slot) { activeColor=slot; $('color-target').value=slot==='secondary'?'fill':'stroke'; updateUI(); }
  function setPaintColor(value,slot=activeColor) {
    const color=parseColor(value),key=slot==='secondary'?'fill':'stroke';
    if(color==='none'){changeStyle(key,'none');return;}
    const before=snapshot(); paintColors[slot]=color;
    if(slot==='primary'){
      defaults.stroke=color;
      editableSelection().forEach(o=>{if(o.type==='text')o.style.fill=color;else if(o.type!=='image')o.style.stroke=color;});
    } else {
      if(defaults.fill!=='none')defaults.fill=color;
      editableSelection().forEach(o=>{if(o.type!=='text'&&o.type!=='image'&&o.style.fill!=='none')o.style.fill=color;});
    }
    commit(before);
  }
  function getRegion() {
    if(region)return {...region};
    const items=selectionObjects().filter(o=>o.visible!==false);if(!items.length)return null;
    const bounds=items.map(o=>G.paintBounds(o)),x=Math.max(0,Math.min(...bounds.map(b=>b.x))),y=Math.max(0,Math.min(...bounds.map(b=>b.y)));
    const right=Math.min(doc.width,Math.max(...bounds.map(b=>b.x+b.w))),bottom=Math.min(doc.height,Math.max(...bounds.map(b=>b.y+b.h)));
    return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;
  }
  function imageObject(result,name='图像') { return {id:uid(),type:'image',name,x:0,y:0,w:result.width,h:result.height,src:result.src,rotation:0,visible:true,locked:false,style:{...clone(baseStyle),stroke:'none',fill:'none'}}; }
  function applyPixels(before,result,label) {
    if(snapshot()!==before){toast('画板已变动，请重新执行图像操作。');return false;}
    if(result.changed===false){toast('颜色相同，无需填充。');return false;}
    doc.width=result.width;doc.height=result.height;doc.objects=[imageObject(result,label)];selected=[];region=null;
    if(!commit(before))return false;toast(label+'完成，可撤销恢复。');return true;
  }
  function insertImage(result,name,mode) {
    cancelAction();const before=snapshot(),o=imageObject(result,name||'粘贴图像');
    if(mode==='open'){doc={name:(name||'未命名画布').replace(/\.[^.]+$/,''),width:result.width,height:result.height,background:'#FFFFFF',objects:[o]};selected=[];region=null;}
    else {
      o.x=region?.x??0;o.y=region?.y??0;
      if(o.x+o.w>12000)o.x=0;if(o.y+o.h>12000)o.y=0;
      doc.width=Math.max(doc.width,Math.ceil(o.x+o.w));doc.height=Math.max(doc.height,Math.ceil(o.y+o.h));
      doc.objects.push(o);selected=[o.id];region=null;
    }
    if(!commit(before))return false;setTool('select');if(mode==='open')actualSize();toast(mode==='open'?'图片已打开。':'图像已粘贴，可拖动调整。');return true;
  }
  const imageCommands = window.createPaintImages({getDocument:()=>clone(doc),snapshot,applyPixels,insertImage,report:fail,notify:toast,getRegion,setBusy:value=>{busy=value;updateUI();},getClipboard:()=>clipboard,setClipboard:value=>{clipboard=value;},setSelection});
  async function copySelection() {
    if(region)return imageCommands.copy();
    if(!selected.length)return; clipboard=clone(selectionObjects());toast('已复制 '+clipboard.length+' 个对象。');
  }
  async function cutSelection() {
    if(region)return imageCommands.cut();
    if(!selected.length)return; await copySelection();deleteSelected();
  }
  async function pasteSelection() {
    if(Array.isArray(clipboard)&&clipboard.length){setTool('select');transact(()=>{const copies=clipboard.map(o=>({...clone(o),id:uid(),x:o.x+24,y:o.y+24,locked:false}));doc.objects.push(...copies);selected=copies.map(o=>o.id);region=null;clipboard=copies;});return;}
    await imageCommands.paste();
  }
  function setBrush(brush) {
    setTool('freehand');defaults.brush=brush;defaults.stroke=paintColors.primary;defaults.strokeWidth=brush==='marker'?18:brush==='brush'?5:1;defaults.opacity=brush==='marker'?0.4:1;updateUI();
  }
  function selectAll() {setTool('select');setSelection(doc.objects.filter(o=>o.visible!==false).map(o=>o.id));if(!selected.length){region={x:0,y:0,w:doc.width,h:doc.height};updateUI();scheduleRender();}}
  function openResize() {
    $('resize-mode').value='pixels';$('resize-width').value=doc.width;$('resize-height').value=doc.height;$('resize-keep-ratio').checked=true;$('resize-dialog').showModal();
  }
  function resizeCanvasFromHandle(e,axis) {
    if(busy)return;cancelAction();action={kind:'canvas-size',axis,before:snapshot(),start:worldPoint(e),width:doc.width,height:doc.height};e.stopPropagation();capture(e);
  }
  function scaledObject(o,width,height) {
    const oldW=Math.max(o.w,0.01),oldH=Math.max(o.h,0.01);
    if (o.type === 'text') {
      const rx=width/oldW,ry=height/oldH,scale=Math.abs(rx-1)<0.000001?ry:Math.abs(ry-1)<0.000001?rx:Math.min(rx,ry);
      o.style.fontSize=clamp(o.style.fontSize*scale,6,500);textSize(o);width=o.w;height=o.h;
    }
    const sx=width/oldW,sy=height/oldH;
    if (o.points) o.points=o.points.map(p=>({x:p.x*sx,y:p.y*sy}));
    if (o.erasures) o.erasures=o.erasures.map(e=>({size:e.size*Math.sqrt(Math.abs(sx*sy)),points:e.points.map(p=>({x:p.x*sx,y:p.y*sy}))}));
    o.w=width;o.h=height;
  }
  function makeShape(type,a,b,shift,paintStyle=defaults) {
    let dx=b.x-a.x,dy=b.y-a.y;
    if (shift) {
      if (['line','curve','arrow','doublearrow'].includes(type)) { const length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;dx=Math.cos(angle)*length;dy=Math.sin(angle)*length; }
      else {const size=Math.max(Math.abs(dx),Math.abs(dy));dx=(dx<0?-1:1)*size;dy=(dy<0?-1:1)*size;}
    }
    const x=Math.min(a.x,a.x+dx),y=Math.min(a.y,a.y+dy),w=Math.abs(dx),h=Math.abs(dy);
    const o={id:uid(),type,name:labels[type],x,y,w,h,rotation:0,visible:true,locked:false,style:clone(paintStyle)};
    if (['line','curve','arrow','doublearrow'].includes(type)) {
      const p0={x:a.x-x,y:a.y-y},p1={x:a.x+dx-x,y:a.y+dy-y};
      if (type==='curve') {const length=Math.hypot(dx,dy),bend=length*0.35;const c={x:(p0.x+p1.x)/2+(length?dy/length:0)*bend,y:(p0.y+p1.y)/2-(length?dx/length:1)*bend};const n=G.normalizePoints([p0,c,p1]);o.x+=n.x;o.y+=n.y;o.w=n.w;o.h=n.h;o.points=n.points;} else o.points=[p0,p1];
      o.style.fill='none';
    }
    if (['freehand','polyline','arc'].includes(type)) o.style.fill='none';
    return o;
  }
  function startEraser(p) {
    action={kind:'erase',before:snapshot(),last:p,paths:new Map()};
    eraseAt(p,p); scheduleRender();
  }
  function eraseAt(from,to) {
    const size=+$('eraser-size').value;
    for (const o of doc.objects) {
      if (o.visible===false || o.locked) continue;
      const b=G.paintBounds ? G.paintBounds(o) : G.bounds(o), pad=size/2;
      if (Math.max(from.x,to.x)+pad<b.x || Math.min(from.x,to.x)-pad>b.x+b.w || Math.max(from.y,to.y)+pad<b.y || Math.min(from.y,to.y)-pad>b.y+b.h) continue;
      let path=action.paths.get(o.id);
      if (!path) {path={size,points:[G.worldToLocal(o,from)]};o.erasures ||= [];o.erasures.push(path);action.paths.set(o.id,path);}
      path.points.push(G.worldToLocal(o,to));
    }
    action.last=to;
  }
  function onPointerDown(e) {
    if (busy || ![0,1,2].includes(e.button)) return;
    if (e.target.closest('#ruler-top,#ruler-left,.canvas-size-handle')) return;
    viewport.focus({preventScroll:true});
    pointer=worldPoint(e,!['select','freehand','eraser','eyedropper','hand'].includes(tool));
    if (spaceDown || tool==='hand' || e.button===1) {action={kind:'pan',start:{x:e.clientX,y:e.clientY},view:{...view}};capture(e);return;}
    const handle=e.target.closest('[data-handle]')?.dataset.handle,o=firstSelected();
    if (handle && o && !o.locked && selected.length===1) {action={kind:handle==='rotate'?'rotate':handle.startsWith('point-')?'point':'resize',handle,before:snapshot(),start:pointer,original:clone(o)};capture(e);return;}
    if (!inside(pointer)) { if (tool==='select') setSelection([]);return; }
    if(tool==='zoom'){const b=viewport.getBoundingClientRect();zoomTo(view.zoom*(e.button===2?1/1.5:1.5),{x:e.clientX-b.left,y:e.clientY-b.top});return;}
    if(tool==='fill'){imageCommands.fill(pointer,paintColors[e.button===2?'secondary':'primary']);return;}
    if (tool==='select') {
      if(region&&pointer.x>=region.x&&pointer.x<=region.x+region.w&&pointer.y>=region.y&&pointer.y<=region.y+region.h){
        action={kind:'region-move',start:pointer,original:{...region},dx:0,dy:0};capture(e);return;
      }
      const target=hit(pointer);
      if (target && (target.type!=='image'||selected.includes(target.id)||e.shiftKey)) {
        if (e.shiftKey) {setSelection(selected.includes(target.id)?selected.filter(id=>id!==target.id):[...selected,target.id]);}
        else if (!selected.includes(target.id)) setSelection([target.id]);
        const originals=editableSelection().map(clone);
        if (originals.length) {action={kind:'move',before:snapshot(),start:pointer,originals};capture(e);}
      } else {const old=e.shiftKey?[...selected]:[];setSelection(old);action={kind:'marquee',start:pointer,old};capture(e);}
      return;
    }
    if (tool==='eyedropper') {
      imageCommands.pick(pointer).then(color=>{if(color){setPaintColor(color,e.button===2?'secondary':'primary');toast('已采集 '+color);}}).catch(fail);return;
    }
    if (tool==='text') {openText(pointer);return;}
    if (tool==='eraser') {startEraser(pointer);capture(e);return;}
    if (tool==='polyline') {
      if(polyline?.points.length>=3&&Math.hypot(pointer.x-polyline.points[0].x,pointer.y-polyline.points[0].y)<=6/view.zoom){finishPolyline(true);return;}
      if (!polyline) polyline={points:[pointer]};else if(Math.hypot(pointer.x-polyline.points.at(-1).x,pointer.y-polyline.points.at(-1).y)>1/view.zoom) polyline.points.push(pointer);
      scheduleRender();return;
    }
    const paintStyle=clone(defaults);
    if(e.button===2){paintStyle.stroke=paintColors.secondary;if(paintStyle.fill!=='none')paintStyle.fill=paintColors.primary;}
    action={kind:'draw',before:snapshot(),start:pointer,object:makeShape(tool,pointer,pointer,e.shiftKey,paintStyle),paintStyle,points:[pointer]};
    if (tool==='freehand') {action.object.points=[{x:0,y:0}];action.object.style.fill='none';}
    setSelection([]);capture(e);scheduleRender();
  }
  function capture(e) {try{viewport.setPointerCapture(e.pointerId);}catch{}e.preventDefault();}
  function onPointerMove(e) {
    pointer=worldPoint(e,!['erase','pan','move','marquee'].includes(action?.kind) && !['select','freehand','eraser','eyedropper','hand'].includes(tool));
    $('coordinates').textContent=`X ${Math.round(pointer.x)}  Y ${Math.round(pointer.y)}`;
    if(tool==='eraser') {
      const rect=viewport.getBoundingClientRect(),cursor=$('eraser-cursor'),size=+$('eraser-size').value*view.zoom;
      cursor.hidden=false;cursor.style.width=cursor.style.height=Math.max(2,size)+'px';cursor.style.left=(e.clientX-rect.left+viewport.scrollLeft)+'px';cursor.style.top=(e.clientY-rect.top+viewport.scrollTop)+'px';
    }
    if (!action) {if(polyline)scheduleRender();return;}
    if (action.kind==='pan') {view.x=action.view.x+e.clientX-action.start.x;view.y=action.view.y+e.clientY-action.start.y;applyView();return;}
    if(action.kind==='canvas-size'){
      if(action.axis!=='bottom')doc.width=clamp(Math.round(action.width+pointer.x-action.start.x),1,12000);
      if(action.axis!=='right')doc.height=clamp(Math.round(action.height+pointer.y-action.start.y),1,12000);
      scheduleRender();return;
    }
    if(action.kind==='region-move'){
      action.dx=Math.round(pointer.x-action.start.x);action.dy=Math.round(pointer.y-action.start.y);
      region={...action.original,x:action.original.x+action.dx,y:action.original.y+action.dy};scheduleRender();return;
    }
    if (action.kind==='draw') {
      if (tool==='freehand') {
        const last=action.points.at(-1);if(Math.hypot(pointer.x-last.x,pointer.y-last.y)<0.75/view.zoom)return;
        action.points.push(pointer);const n=G.normalizePoints(action.points);Object.assign(action.object,{x:n.x,y:n.y,w:n.w,h:n.h,points:n.points});
      } else {const id=action.object.id;action.object=makeShape(tool,action.start,pointer,e.shiftKey,action.paintStyle);action.object.id=id;}
    } else if(action.kind==='move') {
      let dx=pointer.x-action.start.x,dy=pointer.y-action.start.y;
      if($('snap-toggle').checked&&!e.altKey){const lead=action.originals[0];dx=Math.round((lead.x+dx)/10)*10-lead.x;dy=Math.round((lead.y+dy)/10)*10-lead.y;}
      if(e.shiftKey){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0;}
      action.originals.forEach(original=>{const o=doc.objects.find(o=>o.id===original.id);o.x=original.x+dx;o.y=original.y+dy;});
    } else if (action.kind==='resize') resizeFromPointer(pointer,e.shiftKey);
    else if(action.kind==='rotate') {
      const o=doc.objects.find(o=>o.id===action.original.id),orig=action.original,c={x:orig.x+orig.w/2,y:orig.y+orig.h/2};
      const initial=Math.atan2(action.start.y-c.y,action.start.x-c.x),now=Math.atan2(pointer.y-c.y,pointer.x-c.x);
      let degrees=(orig.rotation||0)+(now-initial)*180/Math.PI;if(e.shiftKey)degrees=Math.round(degrees/15)*15;o.rotation=Math.round(degrees*10)/10;
    } else if(action.kind==='point') {
      const orig=action.original,o=doc.objects.find(o=>o.id===orig.id),index=+action.handle.slice(6);
      const points=orig.points.map((p,i)=>i===index?pointer:G.localToWorld(orig,p)),n=G.normalizePoints(points);
      Object.assign(o,{rotation:0,x:n.x,y:n.y,w:n.w,h:n.h,points:n.points});
      if(orig.erasures?.length) o.erasures=orig.erasures.map(e=>({size:e.size,points:e.points.map(p=>{const w=G.localToWorld(orig,p);return{x:w.x-n.x,y:w.y-n.y};})}));
    } else if(action.kind==='erase') eraseAt(action.last,pointer);
    scheduleRender();
  }
  function resizeFromPointer(p,constrain) {
    const orig=action.original,o=doc.objects.find(o=>o.id===orig.id),local=G.worldToLocal(orig,p),left=action.handle.includes('w'),top=action.handle.includes('n');
    const anchor={x:left?orig.w:0,y:top?orig.h:0},worldAnchor=G.localToWorld(orig,anchor);
    let w=Math.max(2,left?orig.w-local.x:local.x),h=Math.max(2,top?orig.h-local.y:local.y);
    if(constrain){const ratio=Math.max(orig.w,0.01)/Math.max(orig.h,0.01);if(w/h>ratio)h=w/ratio;else w=h*ratio;}
    Object.assign(o,clone(orig));scaledObject(o,w,h);
    w=o.w;h=o.h;
    const newAnchor={x:left?w:0,y:top?h:0},angle=(orig.rotation||0)*Math.PI/180,c={x:w/2,y:h/2},dx=newAnchor.x-c.x,dy=newAnchor.y-c.y;
    o.x=worldAnchor.x-c.x-(dx*Math.cos(angle)-dy*Math.sin(angle));o.y=worldAnchor.y-c.y-(dx*Math.sin(angle)+dy*Math.cos(angle));
  }
  function onPointerUp(e) {
    if(!action)return;
    const a=action;action=null;
    if(a.kind==='draw') {
      const o=a.object;
      const distance=Math.hypot(pointer.x-a.start.x,pointer.y-a.start.y);
      if(o.type==='freehand' && a.points.length===1){o.points=[{x:0,y:0},{x:0.01,y:0.01}];o.w=o.h=0.01;}
      else if(o.type!=='freehand' && distance<2/view.zoom){scheduleRender();return;}
      doc.objects.push(o);selected=[o.id];commit(a.before);
      if(o.type==='freehand')setSelection([]);else setTool('select');
    } else if(a.kind==='marquee') {
      const b={x:Math.min(a.start.x,pointer.x),y:Math.min(a.start.y,pointer.y),w:Math.abs(a.start.x-pointer.x),h:Math.abs(a.start.y-pointer.y)};
      const ids=doc.objects.filter(o=>{if(o.visible===false)return false;const ob=G.bounds(o);return ob.x>=b.x&&ob.y>=b.y&&ob.x+ob.w<=b.x+b.w&&ob.y+ob.h<=b.y+b.h;}).map(o=>o.id);
      setSelection([...new Set([...a.old,...ids])]);
      const x=clamp(b.x,0,doc.width),y=clamp(b.y,0,doc.height),right=clamp(b.x+b.w,0,doc.width),bottom=clamp(b.y+b.h,0,doc.height);
      if(right-x>=1&&bottom-y>=1)region={x,y,w:right-x,h:bottom-y};updateUI();
    } else if(a.kind==='region-move'){
      region={...a.original};if(a.dx||a.dy)imageCommands.moveRegion(a.original,a.dx,a.dy).then(applied=>{
        if(!applied)return;const x=clamp(a.original.x+a.dx,0,doc.width),y=clamp(a.original.y+a.dy,0,doc.height);
        const right=clamp(a.original.x+a.dx+a.original.w,0,doc.width),bottom=clamp(a.original.y+a.dy+a.original.h,0,doc.height);
        region=right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;updateUI();scheduleRender();
      });
    } else if(a.before) commit(a.before);
    scheduleRender();
    if(e && viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
  }
  function cancelAction() {
    if(action?.before)doc=JSON.parse(action.before);
    if(action?.kind==='region-move')region={...action.original};
    action=null;polyline=null;rangeSnapshot=null;selected=selected.filter(id=>doc.objects.some(o=>o.id===id));scheduleRender();
  }
  function finishPolyline(closed=false) {
    if(!polyline)return;
    const pts=polyline.points.filter((p,i,a)=>!i||Math.hypot(p.x-a[i-1].x,p.y-a[i-1].y)>0.5);
    if(pts.length>1){const n=G.normalizePoints(pts),o={id:uid(),type:closed?'polygon':'polyline',name:closed?'多边形':'折线',x:n.x,y:n.y,w:n.w,h:n.h,points:n.points,rotation:0,visible:true,locked:false,style:{...clone(defaults),fill:closed?defaults.fill:'none'}};transact(()=>{doc.objects.push(o);selected=[o.id];});}
    polyline=null;setTool('select');
  }
  function openText(p,o=null) {
    editingTextId=o?.id||null;textPosition=p;
    $('text-dialog').querySelector('h2').textContent=o?'编辑文字':'添加文字';
    $('text-confirm').textContent=o?'保存修改':'添加到画板';
    $('text-input').value=o?.text||'';$('text-vertical').checked=(o?.style||defaults).textDirection==='vertical';
    $('text-dialog').showModal();setTimeout(()=>$('text-input').focus(),0);
  }
  function confirmText() {
    const text=$('text-input').value.slice(0,10000);if(!text.trim()){toast('请先输入文字。');return;}
    transact(()=>{
      let o=doc.objects.find(o=>o.id===editingTextId);
      if(!o){o={id:uid(),type:'text',name:'文字',x:textPosition.x,y:textPosition.y,w:1,h:1,rotation:0,visible:true,locked:false,style:clone(defaults)};o.style.fill=paintColors.primary;o.style.stroke='none';doc.objects.push(o);}
      o.text=text;o.name=text.split('\n')[0].slice(0,16);o.style.textDirection=$('text-vertical').checked?'vertical':'horizontal';textSize(o);selected=[o.id];
    });$('text-dialog').close();setTool('select');
  }
  function deleteSelected() {
    if(region){imageCommands.eraseRegion();return;}
    const ids=editableSelection().map(o=>o.id);if(!ids.length)return;
    transact(()=>{doc.objects=doc.objects.filter(o=>!ids.includes(o.id));selected=selected.filter(id=>!ids.includes(id));});
  }
  function duplicateSelection(offset=20) {
    const originals=editableSelection();if(!originals.length)return;
    transact(()=>{const copies=originals.map(o=>({...clone(o),id:uid(),name:((o.name||labels[o.type])+' 副本').slice(0,160),x:o.x+offset,y:o.y+offset,locked:false}));doc.objects.push(...copies);selected=copies.map(o=>o.id);});
  }
  function reorder(forward) {
    const ids=new Set(editableSelection().map(o=>o.id));
    transact(()=>{
      if(forward){for(let i=doc.objects.length-2;i>=0;i--)if(ids.has(doc.objects[i].id)&&!ids.has(doc.objects[i+1].id))[doc.objects[i],doc.objects[i+1]]=[doc.objects[i+1],doc.objects[i]];}
      else for(let i=1;i<doc.objects.length;i++)if(ids.has(doc.objects[i].id)&&!ids.has(doc.objects[i-1].id))[doc.objects[i],doc.objects[i-1]]=[doc.objects[i-1],doc.objects[i]];
    });
  }
  function sampleDocument() {
    const objects=[];
    const shape=(type,x,y,w,h,style={},extra={})=>{const o={id:uid(),type,name:labels[type],x,y,w,h,rotation:0,visible:true,locked:false,style:{...clone(baseStyle),...style},...extra};objects.push(o);return o;};
    const text=(value,x,y,size,color='#26334D',extra={})=>{const o=shape('text',x,y,1,1,{fill:color,stroke:'none',fontSize:size,...extra},{text:value,name:value.split('\n')[0]});textSize(o);return o;};
    text('让灵感，有形状。',105,84,44,'#25324A',{bold:true});
    text('每一条线、每一种颜色，都由你精准掌控',108,157,18,'#8790A4');
    shape('roundrect',102,250,260,140,{fill:'#EDF0FF',stroke:'#6C7CEC',strokeWidth:2});
    text('01  构思',130,280,15,'#6A78D5');text('从一个想法开始',130,318,24,'#35467C',{bold:true});
    shape('diamond',476,246,184,148,{fill:'#FFF5E9',stroke:'#E5AF62',strokeWidth:2});
    text('02',552,278,16,'#BD8743');text('自由绘制',520,309,21,'#7A5B2B',{bold:true});
    shape('roundrect',782,250,260,140,{fill:'#E9F5F0',stroke:'#72B29A',strokeWidth:2});
    text('03  交付',810,280,15,'#56927C');text('表达更清晰',810,318,24,'#376E5B',{bold:true});
    shape('arrow',380,322,78,0,{stroke:'#8E99C1',strokeWidth:2.5},{points:[{x:0,y:0},{x:78,y:0}]});
    shape('arrow',678,322,86,0,{stroke:'#8E99C1',strokeWidth:2.5},{points:[{x:0,y:0},{x:86,y:0}]});
    shape('curve',230,401,670,210,{stroke:'#8998CD',strokeWidth:2,dash:'dashed',endArrow:'arrow'},{points:[{x:670,y:0},{x:355,y:210},{x:0,y:0}]});
    text('反复打磨，让每个细节都恰到好处',409,450,17,'#8794BA');
    shape('frame',102,577,940,110,{stroke:'#D5DBE8',strokeWidth:1.5,dash:'dotted',fill:'none'});
    shape('star',129,606,42,42,{fill:'#E7EBFF',stroke:'#7E8BDD',strokeWidth:1.5});
    text('双击文字编辑内容，拖动曲线控制点改变弧度',194,607,18,'#5A6780');
    text('点击「新建」开始你的画布，或自由修改这张示例',194,642,14,'#959EAF');
    text('精准表达',1090,252,21,'#7282BF',{textDirection:'vertical',lineHeight:1.5});
    return {name:'灵感工作流 · 可编辑示例',width:1200,height:800,background:'#FFFFFF',objects};
  }

  document.querySelectorAll('button[data-tool]').forEach(b=>b.addEventListener('click',()=>b.dataset.tool==='freehand'?setBrush('pencil'):setTool(b.dataset.tool)));
  viewport.addEventListener('pointerdown',onPointerDown);
  viewport.addEventListener('pointermove',onPointerMove);
  viewport.addEventListener('pointerup',onPointerUp);
  viewport.addEventListener('pointercancel',()=>{cancelAction();updateUI();});
  viewport.addEventListener('pointerleave',()=>{$('eraser-cursor').hidden=true;});
  viewport.addEventListener('contextmenu',e=>e.preventDefault());
  viewport.addEventListener('scroll',drawRulers,{passive:true});
  viewport.addEventListener('dblclick',e=>{if(tool==='polyline'){finishPolyline();return;}if(tool==='select'){const o=hit(worldPoint(e));if(o?.type==='text'&&!o.locked)openText({x:o.x,y:o.y},o);}});
  viewport.addEventListener('wheel',e=>{e.preventDefault();const b=viewport.getBoundingClientRect();zoomTo(view.zoom*Math.exp(-e.deltaY*0.0015),{x:e.clientX-b.left,y:e.clientY-b.top});},{passive:false});
  $('zoom-in').onclick=()=>zoomTo(view.zoom*1.2);$('zoom-out').onclick=()=>zoomTo(view.zoom/1.2);$('zoom-fit').onclick=fitView;$('zoom-select').onchange=e=>zoomTo(+e.target.value/100);
  $('grid-toggle').onchange=scheduleRender;$('snap-toggle').onchange=()=>toast($('snap-toggle').checked?'已开启 10 px 网格吸附，按住 Alt 临时关闭':'已关闭网格吸附');
  $('undo').onclick=undo;$('redo').onclick=redo;
  $('new-document').onclick=()=>{cancelAction();transact(()=>{doc={name:'未命名画布',width:900,height:520,background:'#FFFFFF',objects:[]};selected=[];region=null;});defaults=clone(baseStyle);paintColors.primary='#000000';paintColors.secondary='#FFFFFF';setTool('freehand');actualSize();toast('新画布已就绪，之前的作品可撤销恢复。');};
  $('sample-open').onclick=()=>{cancelAction();transact(()=>{doc=sampleDocument();selected=[];region=null;});setTool('select');fitView();toast('示例里的每个元素都可以编辑。');};
  $('document-name').onchange=e=>transact(()=>doc.name=e.target.value.trim().slice(0,100)||'未命名画布');
  $('save-project').onclick=()=>{try{IO.exportProject(doc);toast('已下载可再次编辑的工程文件。');}catch(e){fail(e);}};
  $('import-project').onclick=()=>$('file-input').click();
  $('file-input').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>20*1024*1024)throw new Error('工程文件过大，请选择小于 20 MB 的文件。');const imported=IO.validateProject(JSON.parse(await file.text()));cancelAction();transact(()=>{doc=imported;selected=[];region=null;});setTool('select');fitView();toast('工程已打开，所有图形均可继续编辑。');}catch(err){fail(err instanceof SyntaxError?new Error('这不是有效的绘图工程文件。'):err);}finally{e.target.value='';}
  };
  $('export-open').onclick=()=>$('export-dialog').showModal();$('export-cancel').onclick=()=>$('export-dialog').close();
  $('export-format').onchange=()=>{$('export-scale').disabled=$('export-format').value==='svg';};
  $('export-confirm').onclick=async()=>{
    const button=$('export-confirm'),old=button.textContent;button.disabled=true;button.textContent='正在导出…';
    try{if($('export-format').value==='svg')IO.exportSvg(doc,$('export-transparent').checked);else await IO.exportPng(doc,{scale:+$('export-scale').value,transparent:$('export-transparent').checked});$('export-dialog').close();toast('作品已导出。');}catch(e){fail(e);}finally{button.disabled=false;button.textContent=old;}
  };
  $('help-open').onclick=()=>$('help-dialog').showModal();$('help-close').onclick=()=>$('help-dialog').close();
  $('text-confirm').onclick=confirmText;$('text-cancel').onclick=()=>$('text-dialog').close();
  $('text-input').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();confirmText();}};
  for(const [id,slot] of [['stroke-color','primary'],['fill-color','secondary']])$(id).onchange=e=>{try{setPaintColor(e.target.value,slot);}catch(err){toast(err.message);updateUI();}};
  for(const [id,slot] of [['stroke-picker','primary'],['fill-picker','secondary']])$(id).onchange=e=>setPaintColor(e.target.value.toUpperCase(),slot);
  $('stroke-none').onclick=()=>changeStyle('stroke','none');$('fill-none').onclick=()=>changeStyle('fill','none');
  $('color-target').onchange=()=>setColorSlot($('color-target').value==='fill'?'secondary':'primary');
  document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>setPaintColor(b.dataset.color.toUpperCase()));
  ['color-r','color-g','color-b'].forEach(id=>$(id).onchange=()=>{const values=['color-r','color-g','color-b'].map(id=>Number($(id).value));if(values.some(n=>!Number.isFinite(n)||n<0||n>255)){toast('RGB 数值需要在 0–255 之间。');updateRGB();return;}setPaintColor('#'+values.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('').toUpperCase(),$('color-target').value==='fill'?'secondary':'primary');});
  $('outline-mode').onchange=e=>changeStyle('stroke',e.target.value==='none'?'none':paintColors.primary);
  $('fill-mode').onchange=e=>changeStyle('fill',e.target.value==='none'?'none':paintColors.secondary);
  const styleFields=[['stroke-width','strokeWidth',0.1,100],['font-size','fontSize',6,500],['line-height','lineHeight',0.8,4]];
  styleFields.forEach(([id,key,min,max])=>$(id).onchange=e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<min||value>max){toast(`数值需要在 ${min}–${max} 之间。`);updateUI();return;}changeStyle(key,value);});
  for(const [id,key] of [['line-style','dash'],['start-arrow','startArrow'],['end-arrow','endArrow'],['font-family','fontFamily'],['text-direction','textDirection'],['text-align','align']])$(id).onchange=e=>changeStyle(key,e.target.value);
  $('font-bold').onchange=e=>changeStyle('bold',e.target.checked);
  $('opacity').oninput=e=>{rangeSnapshot ||= snapshot();defaults.opacity=+e.target.value/100;editableSelection().forEach(o=>o.style.opacity=defaults.opacity);$('opacity-value').textContent=e.target.value+'%';scheduleRender();};
  $('opacity').onchange=()=>{const before=rangeSnapshot;rangeSnapshot=null;commit(before||snapshot());};
  $('eraser-size').oninput=e=>$('eraser-size-value').textContent=e.target.value+' px';
  $('text-content').onchange=e=>{const o=firstSelected();if(o?.type!=='text'||o.locked)return;transact(()=>{o.text=e.target.value.slice(0,10000);o.name=o.text.split('\n')[0].slice(0,16)||'文字';textSize(o);});};
  for(const [id,key] of [['object-x','x'],['object-y','y'],['object-w','w'],['object-h','h'],['object-rotation','rotation']])$(id).onchange=e=>{
    const o=firstSelected(),value=Number(e.target.value);if(!o||o.locked)return;
    if(!Number.isFinite(value)||Math.abs(value)>100000||(['w','h'].includes(key)&&value<=0)){toast('请输入有效数值，宽高必须大于 0。');updateUI();return;}
    transact(()=>{if(key==='w')scaledObject(o,value,Math.max(o.h,0.01));else if(key==='h')scaledObject(o,Math.max(o.w,0.01),value);else o[key]=value;});
  };
  $('delete-object').onclick=deleteSelected;$('duplicate-object').onclick=()=>duplicateSelection();$('bring-forward').onclick=()=>reorder(true);$('send-backward').onclick=()=>reorder(false);
  $('layers-list').onclick=e=>{
    const el=e.target.closest('[data-layer-id]'),button=e.target.closest('[data-layer-action]');if(!el||!button)return;
    const o=doc.objects.find(o=>o.id===el.dataset.layerId);if(!o)return;
    if(button.dataset.layerAction==='select'){setTool('select');setSelection(e.shiftKey?[...new Set([...selected,o.id])]:[o.id]);}
    else transact(()=>{if(button.dataset.layerAction==='visible')o.visible=o.visible===false;else o.locked=!o.locked;});
  };
  $('canvas-apply').onclick=()=>{
    const width=Number($('canvas-width').value),height=Number($('canvas-height').value);
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>12000||height>12000){toast('画布宽高应为 1–12000 之间的整数像素。');updateUI();return;}
    transact(()=>{doc.width=width;doc.height=height;doc.background=$('canvas-background').value;});fitView();toast(`画布已调整为 ${width} × ${height} px。`);
  };
  $('resize-mode').onchange=()=>{const percent=$('resize-mode').value==='percent';$('resize-width').value=percent?100:doc.width;$('resize-height').value=percent?100:doc.height;};
  for(const [id,other] of [['resize-width','resize-height'],['resize-height','resize-width']])$(id).oninput=()=>{
    if(!$('resize-keep-ratio').checked)return;const value=Number($(id).value);if(!Number.isFinite(value)||value<=0)return;
    $(other).value=$('resize-mode').value==='percent'?value:Math.max(1,Math.round(value*(id==='resize-width'?doc.height/doc.width:doc.width/doc.height)));
  };
  $('resize-cancel').onclick=()=>$('resize-dialog').close();
  $('resize-confirm').onclick=async()=>{
    let w=Number($('resize-width').value),h=Number($('resize-height').value);
    if($('resize-mode').value==='percent'){w=Math.round(doc.width*w/100);h=Math.round(doc.height*h/100);}
    if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>12000||h>12000){toast('尺寸需要是 1–12000 之间的整数像素。');return;}
    $('resize-dialog').close();await imageCommands.resize(w,h);
  };
  document.addEventListener('paste',async e=>{
    if(e.target.matches('input,textarea,[contenteditable]')||document.querySelector('dialog[open]'))return;
    const file=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));if(!file)return;e.preventDefault();
    try{insertImage(await Pixels.readImage(file),'粘贴图像','paste');}catch(error){fail(error);}
  });
  // Apply edited values on blur or Enter, including browser autofill and assistive input.
  for (const input of document.querySelectorAll('#document-name,#stroke-color,#fill-color,#color-r,#color-g,#color-b,#stroke-width,#font-size,#line-height,#text-content,#object-x,#object-y,#object-w,#object-h,#object-rotation')) {
    input.addEventListener('blur',()=>{if(input.value!==input.dataset.committedValue)input.dispatchEvent(new Event('change',{bubbles:true}));});
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&input.tagName!=='TEXTAREA'){e.preventDefault();input.blur();}});
  }
  document.addEventListener('keydown',e=>{
    const typing=e.target.matches('input,textarea,select,[contenteditable]'),modal=!!document.querySelector('dialog[open]');
    const mod=e.ctrlKey||e.metaKey;
    if(modal){if(mod&&e.key.toLowerCase()==='s')e.preventDefault();return;}
    if(mod&&e.key.toLowerCase()==='s'){e.preventDefault();if(typing)e.target.blur();try{IO.exportProject(doc);toast('已保存工程文件。');}catch(error){fail(error);}return;}
    if(typing)return;
    if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
    if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
    if(mod&&e.key==='0'){e.preventDefault();fitView();return;}
    if(mod&&e.key.toLowerCase()==='n'){e.preventDefault();$('new-document').click();return;}
    if(mod&&e.key.toLowerCase()==='o'){e.preventDefault();imageCommands.open('open');return;}
    if(mod&&e.key.toLowerCase()==='a'){e.preventDefault();selectAll();return;}
    if(mod&&e.key.toLowerCase()==='d'){e.preventDefault();duplicateSelection();return;}
    if(mod&&e.key.toLowerCase()==='c'){e.preventDefault();copySelection();return;}
    if(mod&&e.key.toLowerCase()==='x'){e.preventDefault();cutSelection();return;}
    if(mod&&e.key.toLowerCase()==='v'&&clipboard){e.preventDefault();pasteSelection();return;}
    if(e.code==='Space'){e.preventDefault();spaceDown=true;viewport.classList.add('panning');return;}
    if(e.key==='Escape'){cancelAction();setSelection([]);return;}
    if(e.key==='Enter'&&polyline){e.preventDefault();finishPolyline();return;}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected();return;}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&selected.length){e.preventDefault();const step=e.shiftKey?10:1;transact(()=>editableSelection().forEach(o=>{o.x+=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;o.y+=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;}));return;}
    if(mod||e.altKey)return;
    const keys={v:'select',h:'hand',b:'freehand',l:'line',c:'curve',r:'rect',o:'ellipse',t:'text',e:'eraser',i:'eyedropper',p:'polyline',f:'fill',z:'zoom'};
    if(keys[e.key.toLowerCase()])setTool(keys[e.key.toLowerCase()]);
    if(e.key==='+'||e.key==='=')zoomTo(view.zoom*1.2);if(e.key==='-')zoomTo(view.zoom/1.2);if(e.key==='0')fitView();
  });
  document.addEventListener('keyup',e=>{if(e.code==='Space'){spaceDown=false;viewport.classList.remove('panning');}});
  window.addEventListener('blur',()=>{spaceDown=false;viewport.classList.remove('panning');if(action){cancelAction();updateUI();}});
  window.addEventListener('resize',()=>{
    const visible=$('rulers-toggle').checked;if(visible!==rulersVisible){view.x+=visible?24:-24;view.y+=visible?24:-24;rulersVisible=visible;applyView();}else drawRulers();
  });
  window.addEventListener('beforeunload',()=>{clearTimeout(saveTimer);try{IO.saveLocal(doc);}catch{}});
  window.PaintController={setTool,setBrush,zoomIn:()=>zoomTo(view.zoom*1.2),zoomOut:()=>zoomTo(view.zoom/1.2),zoom:percent=>zoomTo(percent/100),actualSize,fitView,setColorSlot,setColor:setPaintColor,openResize,copy:copySelection,cut:cutSelection,paste:pasteSelection,crop:()=>imageCommands.crop(),rotate:operation=>imageCommands.rotate(operation),openImage:mode=>imageCommands.open(mode),selectAll,newDocument:()=>$('new-document').click(),resizeCanvasFromHandle,report:fail};
  try { const stored=IO.loadLocal(); if(stored)doc=stored; } catch {toast('无法读取上次的自动保存，已打开空白画板。');}
  updateUI();setTool('freehand');requestAnimationFrame(actualSize);
  $('save-status').textContent='本地自动保存';
  // Read-only diagnostics for integration verification and exported artifacts.
  window.GraphiteStudio = { getDocument:()=>clone(doc),getView:()=>({...view}),getSelection:()=>[...selected],getTool:()=>tool };
})();
