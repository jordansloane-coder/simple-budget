// Data layer. Two interchangeable back ends behind one tiny API:
//   - "local": IndexedDB on this phone (works instantly, no setup)
//   - "cloud": Firebase Firestore under one shared household login, with offline support, so both
//              phones see the same data live.
// Collections: settings (one doc, id "main"), cycles (per-month caps/notes, id = cycle start date),
// expenses, images (full receipt photo, id = expense id).

const Store = (() => {
  const LS_CFG = 'sb.fbconfig';
  // Firebase web config for this household's project. Not a secret — access is enforced by the
  // Firestore security rules (one shared login), not by hiding this.
  const BUILTIN_CFG = {
    apiKey: 'AIzaSyBnr7HainkVlMbIQbrl0QX7K06IzIEg3Q8',
    authDomain: 'simple-budget-7a5b9.firebaseapp.com',
    projectId: 'simple-budget-7a5b9',
    storageBucket: 'simple-budget-7a5b9.firebasestorage.app',
    messagingSenderId: '638276880029',
    appId: '1:638276880029:web:2bcd2397d40e978a533674',
  };
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

  let mode = 'local';
  let fs = null;
  let auth = null;
  let hid = null;
  let email = null;
  let syncError = null;
  const subs = {};
  let dbp = null;
  let onError = () => {};

  // ---------- local (IndexedDB) ----------
  function localDb() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('simple-budget-local', 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore('docs', { keyPath: 'path' });
        s.createIndex('col', 'col');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  async function lStore(m) { const db = await localDb(); return db.transaction('docs', m).objectStore('docs'); }
  async function lAll(col) {
    const s = await lStore('readonly');
    const rows = await req(s.index('col').getAll(col));
    return rows.map((r) => ({ ...r.data, id: r.id }));
  }
  async function lPut(col, id, data) {
    const s = await lStore('readwrite');
    await req(s.put({ path: col + '/' + id, col, id, data }));
    notifyLocal(col);
  }
  async function lDel(col, id) {
    const s = await lStore('readwrite');
    await req(s.delete(col + '/' + id));
    notifyLocal(col);
  }
  async function lGet(col, id) {
    const s = await lStore('readonly');
    const r = await req(s.get(col + '/' + id));
    return r ? { ...r.data, id } : null;
  }
  async function notifyLocal(col) {
    const rows = await lAll(col);
    (subs[col] || []).forEach((cb) => cb(rows));
  }

  // ---------- cloud (Firestore) ----------
  const coll = (col) => fs.collection('households').doc(hid).collection(col);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the sync library — check your connection.'));
      document.head.appendChild(s);
    });
  }

  async function loadFirebase(config) {
    if (!window.firebase) {
      await loadScript(FB + 'firebase-app-compat.js');
      await loadScript(FB + 'firebase-auth-compat.js');
      await loadScript(FB + 'firebase-firestore-compat.js');
    }
    if (!firebase.apps.length) firebase.initializeApp(config);
    auth = firebase.auth();
    fs = firebase.firestore();
    try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* already enabled / unsupported */ }
  }

  function readCfg() {
    try { return JSON.parse(localStorage.getItem(LS_CFG) || 'null'); } catch (e) { return null; }
  }

  function authMessage(e) {
    const code = (e && e.code) || '';
    if (code.includes('email-already-in-use')) return 'That email already has a household account — use "Sign in" instead.';
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Wrong email or password.';
    if (code.includes('weak-password')) return 'Password needs at least 6 characters.';
    if (code.includes('invalid-email')) return 'That email address doesn\'t look right.';
    if (code.includes('operation-not-allowed')) return 'Email/password sign-in isn\'t enabled in your Firebase project yet (see SETUP-SYNC.md).';
    if (code.includes('network')) return 'No connection — try again when you\'re online.';
    return (e && e.message) || 'Sign-in failed.';
  }

  return {
    get mode() { return mode; },
    get email() { return email; },
    get syncError() { return syncError; },
    get hasConfig() { return !!readCfg(); },
    set onError(fn) { onError = fn; },

    async init() {
      const cfg = readCfg();
      if (!cfg) return;
      try {
        await loadFirebase(cfg);
        const user = await new Promise((resolve) => {
          const off = auth.onAuthStateChanged((u) => { off(); resolve(u); });
        });
        if (user) { mode = 'cloud'; hid = user.uid; email = user.email; }
        else syncError = 'Sync is set up but this phone is signed out. Sign in from Settings.';
      } catch (e) {
        syncError = e.message;
      }
    },

    subscribe(col, cb) {
      if (mode === 'cloud') {
        return coll(col).onSnapshot(
          (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
          (e) => onError(e)
        );
      }
      (subs[col] = subs[col] || new Set()).add(cb);
      lAll(col).then(cb);
      return () => subs[col].delete(cb);
    },

    // Cloud writes are fire-and-forget: Firestore queues them offline and the listeners fire at once.
    put(col, id, data) {
      if (mode === 'cloud') { coll(col).doc(id).set(data).catch(onError); return Promise.resolve(); }
      return lPut(col, id, data);
    },
    remove(col, id) {
      if (mode === 'cloud') { coll(col).doc(id).delete().catch(onError); return Promise.resolve(); }
      return lDel(col, id);
    },
    async get(col, id) {
      if (mode === 'cloud') {
        try { const d = await coll(col).doc(id).get(); return d.exists ? { ...d.data(), id } : null; } catch (e) { return null; }
      }
      return lGet(col, id);
    },
    async getAll(col) {
      if (mode === 'cloud') return (await coll(col).get()).docs.map((d) => ({ ...d.data(), id: d.id }));
      return lAll(col);
    },

    // ----- sync setup -----
    async connect(em, pw, create) {
      const cfg = BUILTIN_CFG;
      await loadFirebase(cfg);
      let cred;
      try {
        cred = create
          ? await auth.createUserWithEmailAndPassword(em, pw)
          : await auth.signInWithEmailAndPassword(em, pw);
      } catch (e) { throw new Error(authMessage(e)); }
      localStorage.setItem(LS_CFG, JSON.stringify(cfg));
      mode = 'cloud'; hid = cred.user.uid; email = cred.user.email;
      const local = await lAll('expenses');
      let cloudHas = false;
      try {
        cloudHas = !(await coll('expenses').limit(1).get()).empty;
      } catch (e) {
        throw new Error('Signed in, but the database isn\'t reachable. Make sure Firestore is created and the rules are published (see SETUP-SYNC.md).');
      }
      return { localCount: local.length, cloudHas };
    },

    async uploadLocal(includeSettings) {
      const cols = ['cycles', 'expenses', 'images'];
      if (includeSettings) cols.unshift('settings');
      for (const col of cols) {
        for (const row of await lAll(col)) {
          const { id, ...data } = row;
          await coll(col).doc(id).set(data);
        }
      }
    },

    async signOut() {
      try { if (auth) await auth.signOut(); } catch (e) { /* ignore */ }
      localStorage.removeItem(LS_CFG);
    },
  };
})();
