(function () {
  'use strict';
  const $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)], api = window.WebMixCG;
  if (!api) return;
  const query = new URLSearchParams(location.search), channelId = query.get('channel') || '';
  const channel = channelId && 'BroadcastChannel' in window ? new BroadcastChannel(`webmix-cg:${channelId}`) : null;
  const canvas = $('#preview'), ctx = canvas.getContext('2d'), stage = $('#canvas-stage'), selectionBox = $('#selection-box');
  const MAX_IMAGE_BYTES = 1024 * 1024;
  const MAX_EMBEDDED_IMAGE_CHARS = 1_500_000;
  let doc = api.defaults(), selectedId = '', connected = false, isOnAir = false, isStaged = false, currentSlot = 0, revision = 0, zoom = 1, toastTimer = 0;
  let undoStack = [], redoStack = [], typeCheckpoint = 0, drag = null, syncTimer = 0, saveTimer = 0, rendering = false, animationRunning = false, lastAnimationFrame = 0;
  const snapshot = value => JSON.parse(JSON.stringify(value));
  const activeScene = () => doc.scenes.find(scene => scene.id === doc.activeSceneId) || doc.scenes[0];
  const elements = () => activeScene()?.elements || [];
  const selectedElement = () => elements().find(element => element.id === selectedId) || null;
  const tell = message => { $('#toast').textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 4500); };
  const setSaveState = message => { $('#save-state').textContent = message; };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const storageKey = () => `webmix:cg-draft:${channelId || 'standalone'}`;
  function send(type, payload = {}) {
    if (!channel) return;
    channel.postMessage({ protocolVersion: 1, channel: channelId, messageId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, ...payload });
  }
  function checkpoint() {
    const serialized = JSON.stringify(doc);
    if (undoStack.at(-1) !== serialized) undoStack.push(serialized);
    if (undoStack.length > 30) undoStack.shift();
    redoStack = []; refreshHistoryButtons();
  }
  function refreshHistoryButtons() { $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length; }
  function replaceDocument(next, { history = false, broadcast = true, notice = true } = {}) {
    if (history) checkpoint();
    doc = api.sanitize(next); selectedId = doc.scenes.find(scene => scene.id === doc.activeSceneId)?.elements[0]?.id || '';
    renderAll(); persistDraft();
    if (broadcast) queueSync();
    if (notice) tell('อัปเดต CG แล้ว');
  }
  function mutate(mutator, { history = true, sync = true, localRender = true } = {}) {
    if (history) checkpoint();
    const next = snapshot(doc); mutator(next);
    doc = api.sanitize(next);
    if (localRender) renderAll();
    persistDraft();
    if (sync) queueSync();
  }
  function queueSync() {
    if (!channel) { setSaveState('บันทึกในเครื่อง'); return; }
    setSaveState('กำลังซิงก์…'); clearTimeout(syncTimer);
    syncTimer = setTimeout(() => send('document:update', { revision: ++revision, document: doc }), 100);
  }
  function persistDraft() {
    setSaveState(connected ? 'บันทึกแล้ว' : 'บันทึกในเครื่อง'); clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(storageKey(), JSON.stringify(doc)); } catch { setSaveState('พื้นที่บันทึกเต็ม'); } }, 300);
  }
  function findElementIn(documentValue, id) {
    return documentValue.scenes.find(scene => scene.id === documentValue.activeSceneId)?.elements.find(element => element.id === id);
  }
  function renderAll() {
    if (document.activeElement !== $('#doc-name')) $('#doc-name').value = doc.name;
    if (document.activeElement !== $('#inspector-doc-name')) $('#inspector-doc-name').value = doc.name;
    renderScenes(); renderTree(); renderInspector(); positionSelection(); drawPreview(); refreshHistoryButtons();
    $('#transition-in').value = doc.playback.in; $('#transition-out').value = doc.playback.out; $('#transition-duration').value = doc.playback.durationMs;
    $('#overlay-slot').value = String(currentSlot); $('#overlay-label').textContent = `Overlay ${currentSlot + 1}`;
    $('#take').disabled = $('#clear').disabled = $('#preview-webmix').disabled = !connected;
    $('#take').textContent = isOnAir ? 'อัปเดตบนจอ' : 'Take';
    $('#preview-webmix').textContent = isStaged ? 'เอาออกจาก Preview' : 'Preview ใน WebMix';
    // ป้ายสถานะแบบเดียวกับสตูดิโอ: ON AIR (แดง) · PREVIEW (เขียว) · OFF AIR
    const chip = $('#air-chip');
    chip.textContent = isOnAir ? 'ON AIR' : isStaged ? 'PREVIEW' : connected ? 'OFF AIR' : 'ไม่ได้เชื่อมต่อ';
    chip.className = 'air-chip' + (isOnAir ? ' is-pgm' : isStaged ? ' is-pvw' : '');
    $('.playout-row').classList.toggle('is-onair', isOnAir);
    ensureTickerLoop();
  }
  function sceneMarkup(scene, compact = false) {
    const active = scene.id === doc.activeSceneId ? ' is-active' : '';
    return `<div class="scene-entry${active}"><button class="${compact ? 'scene-card' : 'scene-chip'}${active}" data-scene-select="${escapeHtml(scene.id)}" title="ดับเบิลคลิกเพื่อเปลี่ยนชื่อ">${compact ? `<small>SCENE ${doc.scenes.indexOf(scene) + 1}</small><b>${escapeHtml(scene.name)}</b>` : escapeHtml(scene.name)}</button>${compact ? '' : `<span class="scene-actions"><button data-scene-copy="${escapeHtml(scene.id)}" title="ทำซ้ำ Scene">⧉</button><button data-scene-up="${escapeHtml(scene.id)}" title="เลื่อนขึ้น">↑</button><button data-scene-down="${escapeHtml(scene.id)}" title="เลื่อนลง">↓</button><button data-scene-delete="${escapeHtml(scene.id)}" title="ลบ Scene">×</button></span>`}</div>`;
  }
  function renderScenes() {
    $('#scene-list').innerHTML = doc.scenes.map(scene => sceneMarkup(scene)).join('');
    $('#scene-cards').innerHTML = doc.scenes.map(scene => sceneMarkup(scene, true)).join('');
  }
  function renderTree() {
    const ordered = [...elements()].sort((a, b) => b.transform.zIndex - a.transform.zIndex);
    $('#element-tree').innerHTML = ordered.length ? ordered.map(element => `<div class="element-row${element.id === selectedId ? ' is-selected' : ''}" data-select-element="${escapeHtml(element.id)}"><button class="eye${element.visible ? '' : ' is-off'}" data-toggle-visible="${escapeHtml(element.id)}" title="แสดง/ซ่อน">${element.visible ? '◉' : '○'}</button><span class="layer-icon">${element.type === 'text' ? 'T' : element.type === 'ticker' ? '≋' : element.type === 'image' ? '▧' : '▭'}</span><span class="layer-name">${escapeHtml(element.name)}</span>${element.locked ? '<span class="lock">🔒</span>' : ''}</div>`).join('') : '<div class="empty-tree">Scene นี้ยังไม่มี elements<br>เพิ่ม Text, Shape, Image หรือ Ticker ด้านล่าง</div>';
  }
  function renderInspector() {
    const element = selectedElement(), documentMode = !element;
    $('#inspector-title').textContent = element ? element.name : 'Document';
    $('#document-inspector').hidden = !documentMode; $('#element-inspector').hidden = documentMode; $('#delete-element').hidden = documentMode;
    if (!element) return;
    const put = (selector, value) => { const field = $(selector); if (document.activeElement !== field) field.value = value; };
    put('#element-name', element.name);
    put('#pos-x', Math.round(element.transform.x)); put('#pos-y', Math.round(element.transform.y));
    put('#pos-w', Math.round(element.transform.width)); put('#pos-h', Math.round(element.transform.height)); put('#pos-rotation', Math.round(element.transform.rotation));
    $('#element-visible').checked = element.visible; $('#element-locked').checked = element.locked;
    const textElement = element.type === 'text' || element.type === 'ticker';
    $('#text-properties').hidden = !textElement; $('#ticker-speed-field').hidden = element.type !== 'ticker';
    $('#shape-properties').hidden = element.type !== 'shape'; $('#image-properties').hidden = element.type !== 'image';
    if (textElement) {
      put('#text-content', element.content.value); put('#font-size', element.style.fontSize); put('#font-weight', String(element.style.fontWeight));
      put('#font-family', element.style.fontFamily); put('#text-color', element.style.color.startsWith('#') && element.style.color.length === 7 ? element.style.color : '#ffffff'); put('#text-align', element.style.align); put('#ticker-speed', element.style.tickerSpeed);
    } else if (element.type === 'shape') { put('#shape-fill', element.style.fill.startsWith('#') && element.style.fill.length === 7 ? element.style.fill : '#ef4c38'); put('#shape-radius', element.style.radius); }
    else put('#image-fit', element.style.fit);
  }
  function positionSelection() {
    const element = selectedElement();
    if (!element) { selectionBox.hidden = true; return; }
    const rect = stage.getBoundingClientRect(), t = element.transform;
    selectionBox.hidden = false;
    selectionBox.style.left = `${t.x / 1920 * 100}%`; selectionBox.style.top = `${t.y / 1080 * 100}%`;
    selectionBox.style.width = `${t.width / 1920 * 100}%`; selectionBox.style.height = `${t.height / 1080 * 100}%`;
    selectionBox.style.transform = `rotate(${t.rotation}deg)`;
    selectionBox.setAttribute('aria-label', `เลือก ${element.name}`);
    selectionBox.style.visibility = rect.width ? 'visible' : 'hidden';
  }
  function drawPreview() {
    if (rendering) return; rendering = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height); api.draw(ctx, doc, canvas.width, canvas.height);
    const element = selectedElement();
    if (element) {
      const t = element.transform; ctx.save(); ctx.translate(t.x + t.width / 2, t.y + t.height / 2); ctx.rotate(t.rotation * Math.PI / 180);
      ctx.strokeStyle = '#4a9aff'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.strokeRect(-t.width / 2, -t.height / 2, t.width, t.height); ctx.restore();
    }
    rendering = false;
  }
  function animateTicker(now) {
    if (now - lastAnimationFrame > 33) { drawPreview(); lastAnimationFrame = now; }
    if (elements().some(element => element.type === 'ticker' && element.visible)) requestAnimationFrame(animateTicker);
    else animationRunning = false;
  }
  function ensureTickerLoop() {
    if (!animationRunning && elements().some(element => element.type === 'ticker' && element.visible)) {
      animationRunning = true; lastAnimationFrame = 0; requestAnimationFrame(animateTicker);
    }
  }
  function selectScene(id) { if (!doc.scenes.some(scene => scene.id === id)) return; mutate(next => { next.activeSceneId = id; }, { history: false, sync: true }); selectedId = activeScene().elements[0]?.id || ''; renderAll(); }
  function createScene() {
    if (doc.scenes.length >= 30) return tell('สร้าง Scene ได้ไม่เกิน 30 ฉาก');
    checkpoint(); const next = api.addScene(doc, `Scene ${doc.scenes.length + 1}`); doc = next; selectedId = ''; renderAll(); persistDraft(); queueSync();
  }
  function duplicateScene(id) {
    if (doc.scenes.length >= 30) return tell('สร้าง Scene ได้ไม่เกิน 30 ฉาก');
    checkpoint(); const source = doc.scenes.find(scene => scene.id === id); if (!source) return; const sourceIndex = doc.scenes.indexOf(source);
    const copy = snapshot(source); copy.id = `scene-${Math.random().toString(36).slice(2, 9)}`; copy.name = `${source.name} Copy`;
    copy.elements.forEach(element => { element.id = `el-${Math.random().toString(36).slice(2, 9)}`; });
    doc = snapshot(doc);
    doc.scenes.splice(sourceIndex + 1, 0, copy); doc.activeSceneId = copy.id; doc = api.sanitize(doc); selectedId = copy.elements[0]?.id || ''; renderAll(); persistDraft(); queueSync();
  }
  function moveScene(id, delta) {
    const at = doc.scenes.findIndex(scene => scene.id === id), to = at + delta; if (at < 0 || to < 0 || to >= doc.scenes.length) return;
    mutate(next => { const [item] = next.scenes.splice(at, 1); next.scenes.splice(to, 0, item); });
  }
  function renameScene(id) {
    const scene = doc.scenes.find(item => item.id === id); if (!scene) return;
    const name = prompt('ชื่อ Scene', scene.name); if (name == null || !name.trim()) return;
    mutate(next => { const target = next.scenes.find(item => item.id === id); target.name = name.trim().slice(0, 80); });
  }
  function addElement(type, extra = {}) {
    const scene = activeScene(); if (!scene) return;
    const ordered = scene.elements;
    const el = type === 'text' || type === 'ticker'
      ? { id: `el-${Math.random().toString(36).slice(2, 9)}`, type, name: type === 'ticker' ? 'ตัววิ่ง' : 'ข้อความใหม่', visible: true, locked: false, transform: { x: 650, y: 440, width: 620, height: 92, rotation: 0, zIndex: ordered.length }, style: { color: '#ffffff', backgroundColor: 'transparent', fontFamily: 'IBM Plex Sans Thai', fontSize: 52, fontWeight: 700, align: 'left', lineHeight: 1.2, padding: 0, radius: 0, tickerSpeed: 80 }, content: { mode: 'static', value: type === 'ticker' ? 'ข้อความวิ่งสำหรับไลฟ์' : 'ข้อความใหม่' }, ...extra }
      : type === 'shape'
        ? { id: `el-${Math.random().toString(36).slice(2, 9)}`, type, name: 'Shape ใหม่', visible: true, locked: false, transform: { x: 700, y: 420, width: 520, height: 220, rotation: 0, zIndex: ordered.length }, style: { fill: '#ef4c38', radius: 14, borderColor: 'transparent', borderWidth: 0, shadow: false }, content: {}, ...extra }
        : { id: `el-${Math.random().toString(36).slice(2, 9)}`, type, name: 'Image', visible: true, locked: false, transform: { x: 700, y: 380, width: 480, height: 270, rotation: 0, zIndex: ordered.length }, style: { fit: 'contain', radius: 0 }, content: { src: '', alt: '' }, ...extra };
    checkpoint(); doc = snapshot(doc); activeScene().elements.push(el); doc = api.sanitize(doc); selectedId = el.id; renderAll(); persistDraft(); queueSync();
  }
  function addText() { addElement('text'); $('#text-content').focus(); $('#text-content').select(); }
  function addImageFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return tell('รองรับเฉพาะ PNG, JPEG และ WebP');
    if (file.size > MAX_IMAGE_BYTES) return tell('ไฟล์ภาพต้องมีขนาดไม่เกิน 1 MB ในเวอร์ชันนี้');
    const reader = new FileReader(); reader.onload = () => {
      const data = String(reader.result || ''); if (data.length > 3_000_000) return tell('ไฟล์ภาพหลังเข้ารหัสมีขนาดใหญ่เกินไป');
      const existing = doc.scenes.flatMap(scene => scene.elements).reduce((sum, element) => sum + (element.type === 'image' ? element.content.src.length : 0), 0);
      if (existing + data.length > MAX_EMBEDDED_IMAGE_CHARS) return tell('พื้นที่ภาพรวมในเอกสาร CG เต็มแล้ว (ไม่เกิน 1.5 MB หลังเข้ารหัส)');
      addElement('image', { content: { src: data, alt: file.name.slice(0, 120) } }); tell('เพิ่มภาพลงบน Canvas แล้ว');
    }; reader.onerror = () => tell('อ่านไฟล์ภาพไม่สำเร็จ'); reader.readAsDataURL(file);
  }
  function patchElement(patch, { history = true, sync = true } = {}) {
    if (!selectedId) return;
    mutate(next => { const el = findElementIn(next, selectedId); if (!el) return; patch(el); }, { history, sync });
  }
  function changePosition(key, value) {
    const n = Number(value); if (!Number.isFinite(n)) return;
    patchElement(el => { const field = { x: 'x', y: 'y', w: 'width', h: 'height', rotation: 'rotation' }[key]; el.transform[field] = Math.round(n); });
  }
  function toggleVisibility(id) { const el = elements().find(item => item.id === id); if (!el) return; mutate(next => { findElementIn(next, id).visible = !el.visible; }); }
  function reorderElement(delta) {
    const scene = activeScene(), at = scene.elements.findIndex(el => el.id === selectedId), to = at + delta;
    if (at < 0 || to < 0 || to >= scene.elements.length) return;
    mutate(next => { const items = next.scenes.find(s => s.id === next.activeSceneId).elements; const [item] = items.splice(at, 1); items.splice(to, 0, item); items.forEach((el, i) => { el.transform.zIndex = i; }); });
  }
  function duplicateElement() {
    const el = selectedElement(); if (!el) return;
    const copy = snapshot(el); copy.id = `el-${Math.random().toString(36).slice(2, 9)}`; copy.name = `${copy.name} Copy`; copy.transform.x += 30; copy.transform.y += 30; copy.transform.zIndex = elements().length;
    checkpoint(); doc = snapshot(doc); activeScene().elements.push(copy); doc = api.sanitize(doc); selectedId = copy.id; renderAll(); persistDraft(); queueSync();
  }
  function deleteElement() {
    if (!selectedId) return;
    const id = selectedId; mutate(next => { const scene = next.scenes.find(item => item.id === next.activeSceneId); scene.elements = scene.elements.filter(el => el.id !== id); });
    selectedId = elements()[0]?.id || ''; renderAll();
  }
  function applyTemplate(template) {
    const scene = activeScene(); if (!scene) return;
    if (scene.elements.length && !confirm('แทนที่ Elements ใน Scene นี้ด้วย Template ใช่หรือไม่?')) return;
    const base = api.createTemplate(template); const newElements = snapshot(base.scenes[0].elements);
    mutate(next => { const target = next.scenes.find(item => item.id === next.activeSceneId); target.name = template; target.elements = newElements; });
    selectedId = elements()[0]?.id || ''; renderAll(); tell('ใส่ Template แล้ว — คลิกเลือกเพื่อปรับแต่ละชิ้น');
  }
  function applyInspectorValue(id, mutator, { history = true } = {}) {
    const element = selectedElement(); if (!element) return;
    patchElement(mutator, { history });
  }
  function bindValue(id, handler, event = 'input') { $(id).addEventListener(event, e => handler(e.target.value, e.target)); }
  function renderConnectionState() {
    const status = $('.connection'); status.classList.toggle('is-connected', connected);
    $('#connection-text').textContent = connected ? 'เชื่อมต่อ WebMix แล้ว' : channel ? 'กำลังเชื่อมต่อ…' : 'โหมดออกแบบ';
    $('#take').disabled = $('#clear').disabled = $('#preview-webmix').disabled = !connected;
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(doc)); doc = api.sanitize(JSON.parse(undoStack.pop())); selectedId = ''; renderAll(); persistDraft(); queueSync();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(doc)); doc = api.sanitize(JSON.parse(redoStack.pop())); selectedId = ''; renderAll(); persistDraft(); queueSync();
  }
  function saveLibrary() {
    try {
      const key = 'webmix:cg-projects', list = JSON.parse(localStorage.getItem(key) || '[]'), saved = { id: doc.id, name: doc.name, document: doc, savedAt: new Date().toISOString() };
      const at = list.findIndex(item => item.id === doc.id); if (at >= 0) list[at] = saved; else list.unshift(saved);
      localStorage.setItem(key, JSON.stringify(list.slice(0, 40))); fillLibrary(); tell(`บันทึก “${doc.name}” ไว้ในเครื่องแล้ว`);
    } catch { tell('บันทึกไม่สำเร็จ พื้นที่จัดเก็บของเบราว์เซอร์อาจเต็ม'); }
  }
  function fillLibrary() {
    let list = []; try { list = JSON.parse(localStorage.getItem('webmix:cg-projects') || '[]'); } catch {}
    $('#library').innerHTML = '<option value="">แบบที่บันทึก</option>' + list.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || 'แบบไม่มีชื่อ')}</option>`).join('');
  }
  function exportDocument() {
    const blob = new Blob([JSON.stringify({ app: 'webmix-cg', version: api.schemaVersion, document: doc }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `${doc.name.replace(/[^\p{L}\p{N}-]+/gu, '-') || 'webmix-cg'}.webmix-cg.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importDocument(file) {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) return tell('ไฟล์ CG ต้องมีขนาดไม่เกิน 12 MB');
    try {
      const data = JSON.parse(await file.text()), incoming = api.sanitize(data.document || data.design || data);
      const embedded = incoming.scenes.flatMap(scene => scene.elements).reduce((sum, element) => sum + (element.type === 'image' ? element.content.src.length : 0), 0);
      if (embedded > MAX_EMBEDDED_IMAGE_CHARS) return tell('ไฟล์มีภาพรวมเกิน 1.5 MB หลังเข้ารหัส');
      replaceDocument(incoming, { history: true }); tell(`นำเข้า “${doc.name}” แล้ว`);
    } catch { tell('ไฟล์ไม่ถูกต้อง หรือข้อมูล CG ไม่รองรับ'); }
  }
  function setDocumentName(value) {
    mutate(next => { next.name = value.slice(0, 80); }, { history: false, sync: true });
  }
  function setPlayback(key, value) {
    mutate(next => { if (key === 'durationMs') next.playback.durationMs = Math.max(150, Math.min(3000, Number(value) || 500)); else next.playback[key] = value; }, { history: true });
  }
  function pointerPosition(event) {
    const rect = stage.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width * 1920, y: (event.clientY - rect.top) / rect.height * 1080 };
  }
  function hitTest(point) {
    return [...elements()].sort((a, b) => b.transform.zIndex - a.transform.zIndex).find(el => el.visible && !el.locked && point.x >= el.transform.x && point.x <= el.transform.x + el.transform.width && point.y >= el.transform.y && point.y <= el.transform.y + el.transform.height) || null;
  }
  function startDrag(event, mode, corner = 'se') {
    const element = selectedElement(); if (!element || element.locked) return;
    event.preventDefault(); event.stopPropagation(); checkpoint(); const point = pointerPosition(event), t = snapshot(element.transform);
    drag = { pointerId: event.pointerId, mode, corner, start: point, transform: t };
    stage.setPointerCapture?.(event.pointerId);
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const point = pointerPosition(event), target = hitTest(point);
    if (!target) { selectedId = ''; renderAll(); return; }
    selectedId = target.id; renderAll(); startDrag(event, 'move');
  });
  selectionBox.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.handle');
    if (!handle) { startDrag(event, 'move'); return; }
    startDrag(event, 'resize', [...handle.classList].find(name => ['nw', 'ne', 'sw', 'se'].includes(name)) || 'se');
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointerPosition(event), dx = point.x - drag.start.x, dy = point.y - drag.start.y, start = drag.transform;
    mutate(next => {
      const el = findElementIn(next, selectedId); if (!el) return;
      if (drag.mode === 'move') { el.transform.x = Math.round(start.x + dx); el.transform.y = Math.round(start.y + dy); }
      else {
        const left = drag.corner.includes('w'), top = drag.corner.includes('n');
        el.transform.width = Math.max(30, Math.round(start.width + (left ? -dx : dx)));
        el.transform.height = Math.max(24, Math.round(start.height + (top ? -dy : dy)));
        if (left) el.transform.x = Math.round(start.x + dx); if (top) el.transform.y = Math.round(start.y + dy);
      }
    }, { history: false, localRender: false, sync: false });
    drawPreview(); positionSelection();
  });
  function endDrag(event) { if (drag && (!event || drag.pointerId === event.pointerId)) { drag = null; renderTree(); renderInspector(); positionSelection(); queueSync(); } }
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag); stage.addEventListener('lostpointercapture', endDrag);
  $('#element-tree').addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle-visible]'); if (toggle) { event.stopPropagation(); toggleVisibility(toggle.dataset.toggleVisible); return; }
    const row = event.target.closest('[data-select-element]'); if (row) { selectedId = row.dataset.selectElement; renderAll(); }
  });
  function sceneActions(event) {
    const button = event.target.closest('[data-scene-select],[data-scene-copy],[data-scene-up],[data-scene-down]'); if (!button) return;
    if (button.dataset.sceneCopy) duplicateScene(button.dataset.sceneCopy);
    else if (button.dataset.sceneUp) moveScene(button.dataset.sceneUp, -1);
    else if (button.dataset.sceneDown) moveScene(button.dataset.sceneDown, 1);
    else selectScene(button.dataset.sceneSelect);
  }
  $('#scene-list').addEventListener('click', sceneActions); $('#scene-cards').addEventListener('click', sceneActions);
  $('#scene-list').addEventListener('dblclick', event => { const button = event.target.closest('[data-scene-select]'); if (button) renameScene(button.dataset.sceneSelect); });
  $('#scene-list').addEventListener('click', event => { if (event.target.closest('[data-scene-delete]')) { const id = event.target.closest('[data-scene-delete]').dataset.sceneDelete; if (doc.scenes.length <= 1) return tell('ต้องมีอย่างน้อย 1 Scene'); if (!confirm('ลบ Scene นี้หรือไม่?')) return; mutate(next => { next.scenes = next.scenes.filter(scene => scene.id !== id); if (next.activeSceneId === id) next.activeSceneId = next.scenes[0].id; }); selectedId = ''; renderAll(); } });
  $('#add-scene').addEventListener('click', createScene); $('#add-scene-bottom').addEventListener('click', createScene); $('#add-text').addEventListener('click', addText);
  $$('[data-add="text"]').forEach(button => button.addEventListener('click', addText));
  $$('[data-add="shape"]').forEach(button => button.addEventListener('click', () => addElement('shape')));
  $$('[data-add="image"]').forEach(button => button.addEventListener('click', () => $('#image-file').click()));
  $$('[data-add="ticker"]').forEach(button => button.addEventListener('click', () => addElement('ticker')));
  $('#image-file').addEventListener('change', event => { addImageFile(event.target.files?.[0]); event.target.value = ''; });
  $$('.template-list [data-template]').forEach(button => button.addEventListener('click', () => applyTemplate(button.dataset.template)));
  $$('.panel-tabs [data-left-tab]').forEach(button => button.addEventListener('click', () => {
    $$('.panel-tabs .tab').forEach(tab => tab.classList.toggle('is-active', tab === button));
    $('#layers-panel').hidden = button.dataset.leftTab !== 'layers'; $('#templates-panel').hidden = button.dataset.leftTab !== 'templates';
  }));
  $('#delete-element').addEventListener('click', deleteElement); $('#duplicate-element').addEventListener('click', duplicateElement);
  $('#layer-up').addEventListener('click', () => reorderElement(1)); $('#layer-down').addEventListener('click', () => reorderElement(-1));
  bindValue('#doc-name', value => setDocumentName(value)); bindValue('#inspector-doc-name', value => setDocumentName(value));
  bindValue('#element-name', value => patchElement(el => { el.name = value.slice(0, 80); }, { history: false }));
  bindValue('#pos-x', value => changePosition('x', value), 'change'); bindValue('#pos-y', value => changePosition('y', value), 'change');
  bindValue('#pos-w', value => changePosition('w', value), 'change'); bindValue('#pos-h', value => changePosition('h', value), 'change');
  bindValue('#pos-rotation', value => changePosition('rotation', value), 'change');
  bindValue('#text-content', value => patchElement(el => { el.content.value = value; }, { history: !typeCheckpoint }));
  $('#text-content').addEventListener('input', () => { clearTimeout(typeCheckpoint); typeCheckpoint = setTimeout(() => { typeCheckpoint = 0; }, 600); });
  bindValue('#font-size', value => patchElement(el => { el.style.fontSize = Number(value); }, { history: false }));
  bindValue('#font-weight', value => patchElement(el => { el.style.fontWeight = Number(value); } ), 'change');
  bindValue('#font-family', value => patchElement(el => { el.style.fontFamily = value; }), 'change');
  bindValue('#text-color', value => patchElement(el => { el.style.color = value; }, { history: false }));
  bindValue('#text-align', value => patchElement(el => { el.style.align = value; }), 'change');
  bindValue('#shape-fill', value => patchElement(el => { el.style.fill = value; }, { history: false }));
  bindValue('#shape-radius', value => patchElement(el => { el.style.radius = Number(value); }, { history: false }));
  bindValue('#ticker-speed', value => patchElement(el => { el.style.tickerSpeed = Number(value); }, { history: false }));
  bindValue('#image-fit', value => patchElement(el => { el.style.fit = value; }), 'change');
  $('#element-visible').addEventListener('change', event => patchElement(el => { el.visible = event.target.checked; }));
  $('#element-locked').addEventListener('change', event => patchElement(el => { el.locked = event.target.checked; }));
  bindValue('#transition-in', value => setPlayback('in', value), 'change'); bindValue('#transition-out', value => setPlayback('out', value), 'change'); bindValue('#transition-duration', value => setPlayback('durationMs', value), 'change');
  $('#overlay-slot').addEventListener('change', event => { currentSlot = Math.max(0, Math.min(7, Number(event.target.value) || 0)); $('#overlay-label').textContent = `Overlay ${currentSlot + 1}`; });
  $('#safe-guides').addEventListener('change', event => { $('#safe-overlay').hidden = !event.target.checked; });
  $('#zoom-in').addEventListener('click', () => { zoom = Math.min(2, +(zoom + .1).toFixed(1)); $('#zoom-label').textContent = `${Math.round(zoom * 100)}%`; $('#canvas-zoom').textContent = `${Math.round(zoom * 100)}%`; stage.style.transform = `scale(${zoom})`; });
  $('#zoom-out').addEventListener('click', () => { zoom = Math.max(.5, +(zoom - .1).toFixed(1)); $('#zoom-label').textContent = `${Math.round(zoom * 100)}%`; $('#canvas-zoom').textContent = `${Math.round(zoom * 100)}%`; stage.style.transform = `scale(${zoom})`; });
  $('#undo').addEventListener('click', undo); $('#redo').addEventListener('click', redo);
  addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    if ((event.key === 'Backspace' || event.key === 'Delete') && selectedId && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { event.preventDefault(); deleteElement(); }
  });
  $('#save-project').addEventListener('click', saveLibrary);
  $('#library').addEventListener('change', event => {
    if (!event.target.value) return;
    try { const item = JSON.parse(localStorage.getItem('webmix:cg-projects') || '[]').find(entry => entry.id === event.target.value); if (item) replaceDocument(item.document || item, { history: true }); }
    catch { tell('เปิดแบบที่บันทึกไว้ไม่ได้'); }
    event.target.value = '';
  });
  $('#export-project').addEventListener('click', exportDocument); $('#import-project').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', event => { importDocument(event.target.files?.[0]); event.target.value = ''; });
  $('#preview-webmix').addEventListener('click', () => {
    if (isStaged) { send('preview:clear', { slot: currentSlot }); isStaged = false; tell('นำกราฟิกออกจาก Preview แล้ว'); }
    else { send('preview:set', { slot: currentSlot, sceneId: doc.activeSceneId }); isStaged = true; tell(`ส่งไป Preview · Overlay ${currentSlot + 1}`); }
    renderAll();
  });
  $('#take').addEventListener('click', () => send('take', { slot: currentSlot, effect: doc.playback.in, duration: doc.playback.durationMs }));
  $('#clear').addEventListener('click', () => send('clear', { slot: currentSlot, effect: doc.playback.out, duration: doc.playback.durationMs }));

  channel?.addEventListener('message', event => {
    const msg = event.data; if (!msg || msg.channel !== channelId) return;
    if (msg.type === 'snapshot' || msg.type === 'init') {
      connected = true; doc = api.sanitize(msg.document || msg.design || doc); revision = Number(msg.revision) || revision;
      currentSlot = Number.isInteger(msg.slot) ? Math.max(0, Math.min(7, msg.slot)) : currentSlot; isOnAir = !!msg.visible; isStaged = !!msg.staged;
      setSaveState('บันทึกแล้ว'); renderConnectionState(); renderAll(); persistDraft();
    } else if (msg.type === 'document:ack') { revision = Math.max(revision, Number(msg.revision) || revision); setSaveState('บันทึกแล้ว'); }
    else if (msg.type === 'document:update' && msg.document) { doc = api.sanitize(msg.document); revision = Number(msg.revision) || revision; renderAll(); }
    else if (msg.type === 'document:rollback') { doc = api.sanitize(msg.document || doc); renderAll(); persistDraft(); tell(msg.message || 'WebMix ปฏิเสธการบันทึก CG'); }
    else if (msg.type === 'onair:state' || msg.type === 'state') { isOnAir = !!msg.visible; isStaged = !!msg.staged; if (Number.isInteger(msg.slot) && msg.slot >= 0) currentSlot = msg.slot; renderAll(); }
    else if (msg.type === 'disconnect') { connected = false; isOnAir = false; isStaged = false; renderConnectionState(); renderAll(); tell(msg.message || 'ตัดการเชื่อมต่อจาก WebMix'); }
    else if (msg.type === 'error') { tell(msg.message || 'WebMix ทำรายการไม่สำเร็จ'); }
  });
  $('#library').addEventListener('focus', fillLibrary);
  if (channel) {
    renderConnectionState(); setTimeout(() => { if (!connected) { $('#connection-text').textContent = 'ไม่พบ WebMix'; tell('เปิด CG Studio จากแหล่งภาพ CG Studio ใน WebMix เพื่อเชื่อมต่อ'); } }, 2200);
    send('hello', { protocolVersion: 1 });
  } else {
    try { const draft = localStorage.getItem(storageKey()); if (draft) doc = api.sanitize(JSON.parse(draft)); } catch {}
  }
  renderAll(); fillLibrary();
  addEventListener('webmix-cg-image-ready', drawPreview);
  addEventListener('resize', positionSelection);
})();
