/* WebMix — ที่เก็บข้อมูลในเบราว์เซอร์: IndexedDB (โฟลเดอร์บันทึก) และ OPFS (ไฟล์วิดีโอ/รูปของโชว์) */
(function (WM) {
  'use strict';

  const canUseOpfs = !!(navigator.storage && navigator.storage.getDirectory && window.FileSystemFileHandle && 'createWritable' in FileSystemFileHandle.prototype);
  const idb = {
    open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('webmix', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async get(key) {
      const db = await this.open();
      return new Promise(res => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); });
    },
    async set(key, value) {
      const db = await this.open();
      return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = () => res(); t.onerror = () => res(); });
    },
    async del(key) {
      const db = await this.open();
      return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(key); t.oncomplete = () => res(); t.onerror = () => res(); });
    }
  };

  const mediaStore = {
    dir: null,
    async open() {
      if (!canUseOpfs) return null;
      if (!this.dir) {
        const root = await navigator.storage.getDirectory();
        this.dir = await root.getDirectoryHandle('webmix-media', { create: true });
      }
      return this.dir;
    },
    async put(key, file) {
      let dir;
      try {
        dir = await this.open();
        if (!dir) return false;
        if (navigator.storage.persist) navigator.storage.persist().catch(() => {});
        const w = await (await dir.getFileHandle(key, { create: true })).createWritable();
        await w.write(file);
        await w.close();
        return true;
      } catch (e) {
        if (dir) await dir.removeEntry(key).catch(() => {});
        return false;
      }
    },
    async get(key) {
      try {
        const dir = await this.open();
        return dir ? await (await dir.getFileHandle(key)).getFile() : null;
      } catch (e) { return null; }
    },
    async del(key) {
      try { const dir = await this.open(); if (dir) await dir.removeEntry(key); } catch (e) {}
    },
    // ลบไฟล์ที่ไม่มี Input ใช้แล้ว
    async prune(keep) {
      try {
        const dir = await this.open();
        if (!dir) return;
        const stale = [];
        for await (const [name] of dir.entries()) if (!keep.has(name)) stale.push(name);
        for (const name of stale) await dir.removeEntry(name).catch(() => {});
      } catch (e) {}
    }
  };

  Object.assign(WM, { idb, canUseOpfs, mediaStore });
})(window.WebMix);
