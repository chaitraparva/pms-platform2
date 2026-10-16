/* eslint-disable @typescript-eslint/no-explicit-any */
// The app's data API. Pages call `api.from(...)`, `rpc(...)`,
// `api.auth` and `api.storage`, and everything is answered by the
// on-device database in ./localdb, so the site needs no backend, keys or storage service.
import * as db from './localdb';

export const configured = true;

export interface Session { user: { id: string; email: string }; access_token: string }
type Res<T = any> = { data: T; error: { message: string } | null; count?: number | null };
const ok = <T,>(data: T, count?: number | null): Res<T> => ({ data, error: null, count });
const err = (e: unknown): Res<any> => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });

/* ---------- session ---------- */
const SKEY = 'pms-session';
function readSession(): Session | null {
  try { const s = JSON.parse(localStorage.getItem(SKEY) || 'null'); return s && s.user ? s : null; } catch { return null; }
}
let session: Session | null = readSession();
db.setCurrentUser(session?.user.id ?? null);
const authListeners = new Set<(ev: string, s: Session | null) => void>();
function setSession(s: Session | null, ev: string) {
  session = s; db.setCurrentUser(s?.user.id ?? null);
  try { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); } catch { /* private mode */ }
  authListeners.forEach(f => f(ev, s));
}

/* ---------- query builder ---------- */
type Filter = (r: any) => boolean;
const likeRe = (p: string) => new RegExp('^' + String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
const cmp = (a: any, b: any) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

class Query implements PromiseLike<Res> {
  private filters: Filter[] = [];
  private cols: string[] | null = null;
  private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private one: 'single' | 'maybe' | null = null;
  private countOpt = false;
  private head = false;
  private op: 'select' | 'insert' | 'delete' | 'update' = 'select';
  private payload: any = null;
  constructor(private table: string) {}

  select(cols = '*', opts: { count?: string; head?: boolean } = {}) {
    if (this.op === 'select') this.op = 'select';
    this.cols = cols.trim() === '*' ? null : cols.split(',').map(c => c.trim()).filter(Boolean);
    this.countOpt = !!opts.count; this.head = !!opts.head; return this;
  }
  insert(v: any) { this.op = 'insert'; this.payload = v; return this; }
  update(v: any) { this.op = 'update'; this.payload = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: any) { this.filters.push(r => r[c] === v || (r[c] != null && v != null && String(r[c]) === String(v))); return this; }
  neq(c: string, v: any) { this.filters.push(r => String(r[c]) !== String(v)); return this; }
  in(c: string, vs: any[]) { const s = new Set((vs || []).map(String)); this.filters.push(r => s.has(String(r[c]))); return this; }
  is(c: string, v: any) { this.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
  gt(c: string, v: any) { this.filters.push(r => r[c] != null && cmp(r[c], v) > 0); return this; }
  gte(c: string, v: any) { this.filters.push(r => r[c] != null && cmp(r[c], v) >= 0); return this; }
  lt(c: string, v: any) { this.filters.push(r => r[c] != null && cmp(r[c], v) < 0); return this; }
  lte(c: string, v: any) { this.filters.push(r => r[c] != null && cmp(r[c], v) <= 0); return this; }
  ilike(c: string, p: string) { const re = likeRe(p); this.filters.push(r => re.test(String(r[c] ?? ''))); return this; }
  like(c: string, p: string) { return this.ilike(c, p); }
  /** PostgREST "or" filter, e.g. `full_name.ilike.%ana%,email.ilike.%ana%`. */
  or(expr: string) {
    const parts = expr.split(/,(?=[a-z_]+\.(?:eq|ilike|like|neq|is)\.)/i).map(p => { const m = p.match(/^([a-z_]+)\.(eq|ilike|like|neq|is)\.(.*)$/i); return m ? { c: m[1], op: m[2].toLowerCase(), v: m[3] } : null; }).filter(Boolean) as { c: string; op: string; v: string }[];
    this.filters.push(r => parts.some(p => p.op === 'eq' ? String(r[p.c]) === p.v : p.op === 'neq' ? String(r[p.c]) !== p.v : p.op === 'is' ? (p.v === 'null' ? r[p.c] == null : String(r[p.c]) === p.v) : likeRe(p.v).test(String(r[p.c] ?? ''))));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) { this.orders.push({ col, asc: opts.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.rng = [a, b]; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }

  private rows(): any[] {
    const v = db.view(this.table);
    const base = v || db.T(this.table);
    return base.filter(r => db.canRead(this.table, r));
  }
  private shape(rows: any[]) { return rows.map(r => { const c = JSON.parse(JSON.stringify(r)); if (!this.cols) return c; const o: any = {}; this.cols.forEach(k => { o[k] = c[k]; }); return o; }); }

  private async exec(): Promise<Res> {
    await db.ready();
    if (this.op === 'insert') {
      if (!db.canWrite(this.table)) return err('You do not have permission to do this.');
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((x: any) => ({ id: db.uuid(), created_at: new Date().toISOString(), ...x }));
      db.T(this.table).push(...list); db.persist(this.table);
      const out = this.shape(list);
      return ok(this.one ? out[0] ?? null : out);
    }
    let rows = this.rows().filter(r => this.filters.every(f => f(r)));
    if (this.op === 'delete' || this.op === 'update') {
      if (!db.canWrite(this.table)) return err('You do not have permission to do this.');
      const set = new Set(rows);
      if (this.op === 'delete') { const all = db.T(this.table); for (let i = all.length - 1; i >= 0; i--) if (set.has(all[i])) all.splice(i, 1); }
      else rows.forEach(r => Object.assign(r, this.payload, { updated_at: new Date().toISOString() }));
      db.persist(this.table); return ok(this.shape(rows));
    }
    for (const o of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col]));
    const count = rows.length;
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    if (this.head) return ok(null, this.countOpt ? count : null);
    const out = this.shape(rows);
    if (this.one === 'single') return out.length === 1 ? ok(out[0]) : err(out.length ? 'More than one row returned.' : 'Record not found.');
    if (this.one === 'maybe') return ok(out[0] ?? null);
    return ok(out, this.countOpt ? count : null);
  }
  then<A = Res, B = never>(onOk?: ((v: Res) => A | PromiseLike<A>) | null, onErr?: ((e: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.exec().catch(e => err(e)).then(onOk, onErr);
  }
}

/* ---------- storage (files kept in this browser) ---------- */
const urlCache = new Map<string, string>();
const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
function bucket(name: string) {
  const key = (p: string) => name + '/' + p;
  return {
    async upload(path: string, file: Blob, _o?: unknown): Promise<Res> {
      try {
        await db.ready(); await db.files.put(key(path), file);
        // public images (logo, property photos) are kept as data links so they survive a reload
        if (name === 'branding') urlCache.set(key(path), await toDataUrl(file));
        return ok({ path });
      } catch (e) { return err(e); }
    },
    async remove(paths: string[]): Promise<Res> { try { await Promise.all(paths.map(p => db.files.del(key(p)))); return ok(null); } catch (e) { return err(e); } },
    async createSignedUrl(path: string, _s?: number): Promise<Res<{ signedUrl: string } | null>> {
      const b = await db.files.get(key(path)).catch(() => undefined);
      return b ? ok({ signedUrl: URL.createObjectURL(b) }) : err('This file is not available on this device.');
    },
    getPublicUrl(path: string) { return { data: { publicUrl: urlCache.get(key(path)) || '' } }; }
  };
}

/* ---------- auth ---------- */
const auth = {
  async getSession() { await db.ready(); if (session && !db.userEmail(session.user.id)) setSession(null, 'SIGNED_OUT'); return { data: { session }, error: null }; },
  async getUser() { await db.ready(); return { data: { user: session?.user ?? null }, error: null }; },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    await db.ready();
    const id = await db.checkLogin(email, password);
    if (!id) return { data: { session: null }, error: { message: 'Invalid login credentials' } };
    const s: Session = { user: { id, email: db.userEmail(id) }, access_token: 'local-' + db.uuid() };
    setSession(s, 'SIGNED_IN'); return { data: { session: s }, error: null };
  },
  async signOut() { setSession(null, 'SIGNED_OUT'); return { error: null }; },
  onAuthStateChange(cb: (ev: string, s: Session | null) => void) { authListeners.add(cb); return { data: { subscription: { unsubscribe: () => { authListeners.delete(cb); } } } }; },
  async updateUser({ password }: { password?: string }) {
    try { if (!session) throw new Error('Not signed in.'); if (password) await db.setPassword(session.user.id, password); authListeners.forEach(f => f('USER_UPDATED', session)); return { data: {}, error: null }; }
    catch (e) { return { data: null, error: { message: (e as Error).message } }; }
  },
  async resetPasswordForEmail(_e: string, _o?: unknown) { return { data: null, error: { message: 'Password resets are done by your administrator. Ask them to set a new temporary password for you.' } }; },
  mfa: {
    async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }; },
    async listFactors() { return { data: { totp: [] as { id: string; status: string; friendly_name?: string }[] }, error: null }; },
    async enroll(_o?: unknown): Promise<any> { return { data: null, error: { message: 'Two-factor sign-in is not available in this version.' } }; },
    async challengeAndVerify(_o?: unknown) { return { data: null, error: { message: 'Two-factor sign-in is not available in this version.' } }; },
    async unenroll(_o?: unknown) { return { data: null, error: null }; }
  }
};

/* ---------- realtime: notify listeners when the notifications table changes ---------- */
function channel(_name: string) {
  const handlers: (() => void)[] = []; let off: (() => void) | null = null;
  const ch = {
    on(_t: string, _f: unknown, h: () => void) { handlers.push(h); return ch; },
    subscribe() { off = db.onChange(t => { if (t === 'notifications') handlers.forEach(h => setTimeout(h, 0)); }); return ch; },
    unsubscribe() { off?.(); }
  };
  return ch;
}

export const api = {
  from: (table: string) => new Query(table),
  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Res> {
    try { await db.ready(); return ok(db.rpcCall(fn, args) as any); } catch (e) { return err(e); }
  },
  auth,
  storage: { from: bucket },
  channel,
  removeChannel(ch: { unsubscribe: () => void }) { ch.unsubscribe(); }
};

/** Call a database function and throw a readable error if it fails. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await api.rpc(fn, args);
  if (error) throw new Error(friendly(error.message));
  return data as T;
}

export function friendly(msg: string): string {
  if (/not signed in/i.test(msg)) return 'Your session has expired. Please sign in again.';
  return msg.replace(/^ERROR:\s*/, '');
}

/** Throw on a query error; return the data otherwise. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(friendly(res.error.message));
  return (res.data ?? ([] as unknown)) as T;
}

/** Fetch every row of a query in pages of 1000 (kept for compatibility with the existing pages). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, cap = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(friendly(error.message));
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
