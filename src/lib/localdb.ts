/* eslint-disable @typescript-eslint/no-explicit-any */
// On-device database. Tables live in memory and are saved to this browser's localStorage; uploaded
// files (brochures, documents, photos) are too large for localStorage and are kept in IndexedDB.
// Every money-moving action below follows the original database rules.
import { splitRate, investorPlanName } from './format';

type Row = Record<string, any>;
interface Store { v: number; tables: Record<string, Row[]>; seq: Record<string, number>; users: { id: string; email: string; pw: string }[] }

const DB_NAME = 'pms-local', KV = 'kv', FILES = 'files', VERSION = 1;
export const ADMIN_EMAIL = 'chaitra@parvarealty.ae';
export const ADMIN_PASSWORD = 'Parva@2026';
export const INVESTOR_EMAIL = 'ananya.rao@example.com';
export const INVESTOR_PASSWORD = 'Investor@2026';
/** Password of the sample introducer admins (Ravi, Priya, Suresh). */
export const INTRODUCER_PASSWORD = 'Admin@2026';

/* ---------- IndexedDB plumbing ---------- */
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => { r.result.createObjectStore(KV); r.result.createObjectStore(FILES); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const d = await idb();
  return new Promise((res, rej) => { const t = d.transaction(store).objectStore(store).get(key); t.onsuccess = () => res(t.result as T); t.onerror = () => rej(t.error); });
}
async function idbPut(store: string, key: string, val: unknown): Promise<void> {
  const d = await idb();
  return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
async function idbDel(store: string, key: string): Promise<void> {
  const d = await idb();
  return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
export const files = {
  put: (path: string, blob: Blob) => idbPut(FILES, path, blob),
  get: (path: string) => idbGet<Blob>(FILES, path),
  del: (path: string) => idbDel(FILES, path)
};

/* ---------- state ---------- */
let S: Store;
const TABLES = ['settings', 'profiles', 'branches', 'plans', 'plan_versions', 'investments', 'contract_amendments', 'accruals', 'payouts', 'ledger_entries',
  'announcements', 'notifications', 'documents', 'audit_logs', 'brochures', 'brochure_views', 'properties', 'admin_bonuses'];
const listeners = new Set<(table: string) => void>();
export const onChange = (f: (table: string) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function persist(...changed: string[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 120);
  changed.forEach(t => listeners.forEach(f => f(t)));
}
const LS_KEY = 'pms-db';
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* storage full or blocked */ } }
function load(): Store | undefined { try { const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); return v && v.tables ? v : undefined; } catch { return undefined; } }
export const T = (name: string): Row[] => (S.tables[name] ||= []);

/* ---------- helpers ---------- */
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const nowIso = () => new Date().toISOString();
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export function today(): string { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
const parse = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d: Date) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
/** Calendar months from the original date, clamped to month end (31 May + 6 months = 30 Nov). */
export function addMonths(s: string, n: number): string {
  const d = parse(s); const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
  const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return ty + '-' + pad(tm + 1) + '-' + pad(Math.min(day, last));
}
export const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const diffDays = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const monthlyReturn = (principal: number, rate: number) => round2(principal * rate / 100);
/** Splits the plan rate between the investor and the admin who introduced them (6% = 4% investor + 2% admin bonus).
 *  monthly_rate stays the plan rate; monthly_return is the investor's share; the total paid out never changes. */
function applySplit(i: Row): Row {
  const { investor, bonus } = splitRate(i.monthly_rate);
  const total = monthlyReturn(Number(i.principal), Number(i.monthly_rate)), mine = monthlyReturn(Number(i.principal), investor);
  return Object.assign(i, { investor_rate: investor, admin_bonus_rate: bonus, monthly_return: mine, admin_bonus: round2(total - mine) });
}
const investorRate = (i: Row) => Number(i.investor_rate ?? i.monthly_rate);
const nextSeq = (k: string, start: number) => { S.seq[k] = (S.seq[k] ?? start - 1) + 1; return S.seq[k]; };
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const str = (v: unknown, d = '') => (blank(v) ? d : String(v));
export class DbError extends Error {}
const fail = (m: string): never => { throw new DbError(m); };

export async function hash(pw: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pms-local:' + pw));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ---------- current user ---------- */
let currentUid: string | null = null;
export const setCurrentUser = (id: string | null) => { currentUid = id; };
export const uid = () => currentUid;
export const me = () => T('profiles').find(p => p.id === currentUid) || null;
export const isAdmin = () => { const p = me(); return !!p && p.role === 'super_admin' && p.account_status === 'active'; };
const requireAdmin = () => { if (!isAdmin()) fail('Only an active Super Admin can do this.'); return currentUid!; };
const actorName = (id: string | null) => { const p = T('profiles').find(x => x.id === id); return p ? (p.full_name || p.email) : 'System'; };
const settings = () => T('settings')[0];

function fmtMoney(v: number): string {
  const c = ({ INR: '₹', AED: 'AED ', USD: '$', EUR: '€', GBP: '£' } as Record<string, string>)[settings()?.currency] ?? '';
  return c + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const fmtDate = (s: string) => { const d = parse(s); return pad(d.getUTCDate()) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };

function audit(action: string, entity: string, id: string | null, label: string, reason: string, before: unknown, after: unknown) {
  const id2 = nextSeq('audit', 1);
  T('audit_logs').push({ id: id2, at: nowIso(), actor_id: currentUid, actor_name: currentUid ? actorName(currentUid) : 'System', action, entity_type: entity, entity_id: id, entity_label: label || '', reason: reason || '', before: before ?? null, after: after ?? null });
}
function notify(user: string, kind: string, title: string, body: string, link: string, srcTable: string | null, srcId: string | null): boolean {
  if (srcId && T('notifications').some(n => n.user_id === user && n.kind === kind && n.source_id === srcId)) return false;
  T('notifications').push({ id: uuid(), user_id: user, kind, title, body: body || '', link: link || '', source_table: srcTable, source_id: srcId, read_at: null, created_at: nowIso() });
  return true;
}
function ledger(e: Row) {
  if (e.source_id && T('ledger_entries').some(l => l.source_table === e.source_table && l.source_id === e.source_id && l.type === e.type)) return null;
  const row = { id: uuid(), code: 'TXN-' + pad(nextSeq('ledger', 1), 7), investment_id: null, investor_id: null, reference: '', note: '', source_table: null, source_id: null, created_by: currentUid, created_at: nowIso(), updated_at: nowIso(), ...e };
  T('ledger_entries').push(row); return row;
}
const ledgerFor = (table: string, id: string, type?: string) => T('ledger_entries').filter(l => l.source_table === table && l.source_id === id && (!type || l.type === type));
const fourEyes = (prev: string | null, what: string) => {
  const admins = T('profiles').filter(p => p.role === 'super_admin' && p.account_status === 'active').length;
  if (settings().four_eyes && admins > 1 && prev && prev === currentUid) fail(`A different Super Admin must ${what}. You performed the previous step.`);
};
const LIVE = ['active', 'matured', 'redemption_requested', 'redemption_processing'];
const isUnlocked = (i: Row) => !!i.lockin_end_date && i.lockin_end_date <= today() && LIVE.includes(i.status);

/* ---------- views ---------- */
export function view(name: string): Row[] | null {
  if (name === 'investment_balances') {
    return T('investments').map(i => {
      const acc = T('accruals').filter(a => a.investment_id === i.id), pay = T('payouts').filter(p => p.investment_id === i.id);
      const sum = (rows: Row[]) => round2(rows.reduce((s, r) => s + Number(r.amount), 0));
      return { investment_id: i.id, accrued: sum(acc), paid: sum(pay.filter(p => p.status === 'paid')), processing: sum(pay.filter(p => p.status === 'processing')),
        approved: sum(pay.filter(p => p.status === 'approved')), unapproved: sum(pay.filter(p => p.status === 'accrued' || p.status === 'failed')),
        periods_accrued: acc.filter(a => a.kind === 'regular').length };
    });
  }
  return null;
}

/* ---------- who may read what (the row-level security rules, for investors) ---------- */
export function canRead(table: string, r: Row): boolean {
  if (isAdmin()) return true;
  const u = currentUid; if (!u) return false;
  const myInv = (id: string) => T('investments').some(i => i.id === id && i.investor_id === u);
  switch (table) {
    case 'settings': return true;
    case 'profiles': return r.id === u;
    case 'branches': return r.id === me()?.branch_id;
    case 'investments': return r.investor_id === u;
    case 'investment_balances': case 'accruals': case 'contract_amendments': return myInv(r.investment_id);
    case 'payouts': case 'ledger_entries': return r.investor_id === u;
    case 'notifications': return r.user_id === u;
    case 'documents': return r.owner_id === u && r.visible_to_investor;
    case 'announcements': return r.status === 'published' && audienceOf(r).includes(u);
    case 'brochures': return brochureVisible(r.id, u);
    case 'brochure_views': return r.user_id === u;
    case 'properties': return r.status === 'published';
    default: return false;
  }
}
/** What an investor sees of a row: the admin bonus split and who introduced them stay with the admins. */
export function redact(table: string, r: Row): Row {
  if (isAdmin() || (table !== 'investments' && table !== 'profiles')) return r;
  const c: Row = { ...r };
  if (table === 'investments') {
    c.monthly_rate = investorRate(r); c.plan_name = investorPlanName(r.plan_name, r.monthly_rate);
    delete c.investor_rate; delete c.admin_bonus_rate; delete c.admin_bonus;
  } else delete c.introduced_by;
  return c;
}
/** Only these tables accept direct inserts/deletes from the browser (as before). */
export function canWrite(table: string): boolean { return isAdmin() && ['documents'].includes(table); }

/* ---------- accrual engine ---------- */
function runAccrualsFor(i: Row, asOf: string): number {
  if (!i.start_date || !LIVE.includes(i.status)) return 0;
  let n = 0;
  for (let k = 1; k <= i.lockin_months; k++) {
    const end = addMonths(i.start_date, k); if (end > asOf) break;
    if (T('accruals').some(a => a.investment_id === i.id && a.period_no === k && (a.kind === 'regular' || a.kind === 'stub'))) continue;
    const start = addMonths(i.start_date, k - 1);
    const acc = { id: uuid(), investment_id: i.id, period_no: k, kind: 'regular', period_start: start, period_end: addDays(end, -1), accrual_date: end, days: diffDays(start, end), days_in_period: diffDays(start, end), amount: Number(i.monthly_return), reverses_id: null, reason: null, created_by: null, created_at: nowIso() };
    T('accruals').push(acc); n++;
    T('payouts').push({ id: uuid(), code: 'PAY-' + pad(nextSeq('payout', 1), 6), accrual_id: acc.id, investment_id: i.id, investor_id: i.investor_id, amount: Number(i.monthly_return), due_date: addDays(end, i.payout_lag_days), status: 'accrued',
      batch_ref: null, payment_ref: null, failure_reason: null, approved_by: null, approved_at: null, sent_by: null, sent_at: null, confirmed_by: null, confirmed_at: null, paid_on: null, updated_at: nowIso() });
    ledger({ investment_id: i.id, investor_id: i.investor_id, type: 'return_accrual', amount: Number(i.monthly_return), status: 'posted', occurred_on: end, reference: i.code + ' · period ' + k,
      note: 'Monthly return ' + investorRate(i).toFixed(2) + '% on ' + fmtMoney(i.principal), source_table: 'accruals', source_id: acc.id, created_by: null });
    notify(i.investor_id, 'accrual', 'Return accrued on ' + i.code + ': ' + fmtMoney(i.monthly_return), 'Month ' + k + ' of ' + i.lockin_months + ' · not yet paid', '/portal/investments/' + i.code, 'accruals', acc.id);
    if (Number(i.admin_bonus) > 0) T('admin_bonuses').push({ id: uuid(), code: 'BON-' + pad(nextSeq('bonus', 1), 6), investment_id: i.id, investor_id: i.investor_id,
      admin_id: T('profiles').find(p => p.id === i.investor_id)?.introduced_by ?? null, accrual_id: acc.id, period_no: k, accrual_date: end, rate: Number(i.admin_bonus_rate),
      amount: Number(i.admin_bonus), status: 'accrued', payment_ref: null, paid_on: null, paid_by: null, created_at: nowIso(), updated_at: nowIso() });
  }
  if (i.status === 'active' && i.maturity_date <= asOf) {
    i.status = 'matured'; i.updated_at = nowIso();
    notify(i.investor_id, 'unlocked', 'Principal unlocked on ' + i.code, fmtMoney(i.principal) + ' has completed its ' + i.lockin_months + '-month lock-in.', '/portal/investments?view=unlocked', 'investments', i.id);
  } else if (i.status === 'active' && diffDays(asOf, i.maturity_date) <= settings().approaching_days) {
    notify(i.investor_id, 'maturity_reminder', i.code + ' unlocks on ' + fmtDate(i.maturity_date), 'Lock-in ends in ' + diffDays(asOf, i.maturity_date) + ' days.', '/portal/lock-in', 'investments', i.id);
  }
  return n;
}
/** The hourly job of the old server: run on load and every hour while the app is open. */
export function runAllAccruals(asOf = today()): number {
  let n = 0; T('investments').forEach(i => { n += runAccrualsFor(i, asOf); });
  if (n) persist('accruals', 'payouts', 'ledger_entries', 'notifications', 'investments', 'admin_bonuses');
  return n;
}

/* ---------- plans ---------- */
function insertPlanVersion(plan: string, version: number, v: Row, reason: string) {
  const row = { id: uuid(), plan_id: plan, version, monthly_rate: Number(v.monthly_rate), min_amount: Number(v.min_amount), max_amount: Number(v.max_amount),
    lockin_options: (v.lockin_options || []).map(Number).sort((a: number, b: number) => a - b), allow_custom_lockin: !!v.allow_custom_lockin,
    eligible_from: str(v.eligible_from, today()), eligible_to: blank(v.eligible_to) ? null : v.eligible_to, early_redemption: str(v.early_redemption, 'not_permitted'),
    early_fee_pct: Number(v.early_fee_pct || 0), payout_lag_days: blank(v.payout_lag_days) ? settings().default_payout_lag_days : Number(v.payout_lag_days),
    terms: str(v.terms), risk_disclosure: str(v.risk_disclosure), effective_from: str(v.effective_from, today()), change_reason: reason, created_by: currentUid, created_at: nowIso() };
  if (!(row.monthly_rate > 0 && row.monthly_rate <= 100)) fail('Monthly rate must be above 0 and at most 100%.');
  if (!(row.min_amount > 0)) fail('Minimum amount must be above 0.');
  if (row.max_amount < row.min_amount) fail('Maximum amount must be at least the minimum.');
  if (!row.lockin_options.length) fail('Choose at least one lock-in option.');
  if (row.eligible_to && row.eligible_to < row.eligible_from) fail('Eligibility end must be after its start.');
  T('plan_versions').push(row); return row.id;
}
function createPlan(code: string, name: string, desc: string, version: Row) {
  requireAdmin();
  const c = (blank(code) ? 'PLN-' + pad(nextSeq('plan', 1), 3) : code.trim()).toUpperCase();
  if (T('plans').some(p => p.code === c)) fail('A plan with code ' + c + ' already exists.');
  if (blank(name)) fail('Enter a plan name.');
  const id = uuid();
  T('plans').push({ id, code: c, name: name.trim(), description: desc || '', status: 'draft', current_version: 1, created_by: currentUid, created_at: nowIso(), updated_by: currentUid, updated_at: nowIso() });
  insertPlanVersion(id, 1, version, 'Plan created');
  audit('plan.create', 'plan', id, c, 'Plan created', null, version);
  return id;
}
function setPlanStatus(id: string, status: string, reason: string) {
  requireAdmin();
  const p = T('plans').find(x => x.id === id) || fail('Plan not found.');
  const old = p.status; p.status = status; p.updated_by = currentUid; p.updated_at = nowIso();
  audit('plan.status', 'plan', id, p.code, reason, { status: old }, { status });
}

/* ---------- investments ---------- */
function recordInvestment(a: Row) {
  requireAdmin();
  const s = settings();
  const inv = T('profiles').find(p => p.id === a.p_investor);
  if (!inv || inv.role !== 'investor') fail('Choose a valid investor.');
  if (inv!.kyc_status !== 'verified') fail(`${inv!.full_name} is not verified yet. Verify KYC before recording an investment.`);
  if (inv!.account_status !== 'active') fail(`${inv!.full_name} has a suspended account.`);
  const plan = T('plans').find(p => p.id === a.p_plan) || fail('Plan not found.');
  if (plan.status !== 'active') fail(`Plan ${plan.name} is not active.`);
  const pv = T('plan_versions').filter(v => v.plan_id === plan.id && v.effective_from <= today()).sort((x, y) => y.version - x.version)[0];
  if (!pv) fail(`Plan ${plan.name} has no version in effect yet.`);
  if (today() < pv.eligible_from || (pv.eligible_to && today() > pv.eligible_to)) fail(`Plan ${plan.name} is not open for new investments today.`);
  const principal = Number(a.p_principal);
  if (!(principal >= pv.min_amount && principal <= pv.max_amount)) fail(`Principal must be between ${fmtMoney(pv.min_amount)} and ${fmtMoney(pv.max_amount)}.`);
  if (round2(principal) !== principal) fail('Principal can have at most 2 decimals.');
  const lock = Number(a.p_lockin_months);
  if (!pv.lockin_options.includes(lock) && !(pv.allow_custom_lockin && s.allow_custom_lockin && lock >= 1 && lock <= 120)) fail(`Lock-in of ${lock} months is not offered on this plan.`);
  const id = uuid(), code = 'INV-' + nextSeq('investment', 1001);
  T('investments').push(applySplit({ id, code, investor_id: inv!.id, plan_id: plan.id, plan_version_id: pv.id, plan_name: plan.name, plan_version: pv.version, monthly_rate: pv.monthly_rate,
    lockin_months: lock, early_redemption: pv.early_redemption, early_fee_pct: pv.early_fee_pct, payout_lag_days: pv.payout_lag_days,
    terms: pv.terms || s.default_terms, risk_disclosure: pv.risk_disclosure || s.default_risk_disclosure, principal, monthly_return: monthlyReturn(principal, pv.monthly_rate),
    status: 'pending_funding', expected_start: a.p_expected_start || null, start_date: null, lockin_end_date: null, maturity_date: null, request_from_date: null,
    agreement_ref: str(a.p_agreement_ref), deposit_ref: str(a.p_deposit_ref), notes: str(a.p_notes), cancelled_reason: null, created_by: currentUid, created_at: nowIso(),
    activated_by: null, activated_at: null, updated_at: nowIso() }));
  ledger({ investment_id: id, investor_id: inv!.id, type: 'deposit', amount: principal, status: 'pending', occurred_on: a.p_expected_start || today(), reference: str(a.p_deposit_ref), note: 'Awaiting bank confirmation', source_table: 'investments', source_id: id });
  audit('investment.create', 'investment', id, code, 'Investment recorded', null, { principal, plan: plan.code, version: pv.version, rate: pv.monthly_rate, lockin_months: lock });
  return id;
}
function activateInvestment(id: string, start: string, ref: string, reason: string) {
  requireAdmin();
  const v = T('investments').find(i => i.id === id) || fail('Investment not found.');
  if (v.status !== 'pending_funding') fail(`${v.code} is already ${v.status}.`);
  fourEyes(v.created_by, 'confirm this deposit');
  if (!start || start > today()) fail('Start date must be today or earlier (the date funds were received).');
  if (blank(ref)) fail('Enter the bank reference for the deposit.');
  const maturity = addMonths(start, v.lockin_months);
  Object.assign(v, { status: 'active', start_date: start, lockin_end_date: maturity, maturity_date: maturity, request_from_date: addDays(maturity, -settings().request_window_days), deposit_ref: ref, activated_by: currentUid, activated_at: nowIso(), updated_at: nowIso() });
  ledgerFor('investments', id, 'deposit').forEach(l => Object.assign(l, { status: 'confirmed', reference: ref, occurred_on: start, note: 'Deposit confirmed', updated_at: nowIso() }));
  ledger({ investment_id: id, investor_id: v.investor_id, type: 'allocation', amount: v.principal, status: 'posted', occurred_on: start, reference: v.agreement_ref, note: v.plan_name + ' v' + v.plan_version, source_table: 'investments', source_id: id });
  notify(v.investor_id, 'investment_active', 'Investment ' + v.code + ' is active', fmtMoney(v.principal) + ' at ' + investorRate(v).toFixed(2) + '% per month · matures ' + fmtDate(maturity), '/portal/investments/' + v.code, 'investments', id);
  audit('investment.activate', 'investment', id, v.code, reason || 'Deposit confirmed ' + ref, { status: 'pending_funding' }, { status: 'active', start_date: start, maturity_date: maturity });
  runAccrualsFor(v, today());
}
function payoutsTransition(ids: string[], to: string, ref: string | null, reason: string | null) {
  requireAdmin();
  if (!ids || !ids.length) fail('Select at least one payout.');
  const from = ({ approved: ['accrued', 'failed'], processing: ['approved'], paid: ['processing'], failed: ['processing'] } as Record<string, string[]>)[to];
  if (!from) fail(`Payouts cannot be moved to ${to}.`);
  let r = blank(ref) ? null : String(ref).trim();
  if (to === 'paid' && !r) fail('Enter the bank reference that confirms these payments.');
  if (to === 'failed' && blank(reason)) fail('Enter why the payment failed.');
  const rows = T('payouts').filter(p => ids.includes(p.id));
  const bad = rows.filter(p => !from.includes(p.status)).length;
  if (bad) fail(`${bad} of the selected payouts cannot move to ${to} from their current status. Refresh and try again.`);
  if (to === 'processing' && !r) { const d = new Date(); r = 'BATCH-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); }
  if (to === 'paid') rows.forEach(p => fourEyes(p.sent_by, 'confirm these payments'));
  rows.forEach(p => {
    const code = T('investments').find(i => i.id === p.investment_id)?.code || '';
    p.updated_at = nowIso();
    if (to === 'approved') Object.assign(p, { status: 'approved', approved_by: currentUid, approved_at: nowIso(), failure_reason: null });
    else if (to === 'processing') {
      Object.assign(p, { status: 'processing', sent_by: currentUid, sent_at: nowIso(), batch_ref: r });
      const ex = ledgerFor('payouts', p.id, 'return_payout')[0];
      if (ex) Object.assign(ex, { status: 'pending', reference: r, occurred_on: today(), updated_at: nowIso() });
      else ledger({ investment_id: p.investment_id, investor_id: p.investor_id, type: 'return_payout', amount: p.amount, status: 'pending', occurred_on: today(), reference: r, note: p.code, source_table: 'payouts', source_id: p.id });
      notify(p.investor_id, 'payout_processing', 'Payout for ' + code + ' is being processed', fmtMoney(p.amount), '/portal/investments/' + code, 'payouts', p.id);
    } else if (to === 'paid') {
      Object.assign(p, { status: 'paid', payment_ref: r, confirmed_by: currentUid, confirmed_at: nowIso(), paid_on: today() });
      ledgerFor('payouts', p.id, 'return_payout').forEach(l => Object.assign(l, { status: 'confirmed', reference: r, occurred_on: today(), updated_at: nowIso() }));
      notify(p.investor_id, 'payout_paid', 'Return paid: ' + fmtMoney(p.amount) + ' for ' + code, 'Reference ' + r, '/portal/investments/' + code, 'payouts', p.id);
    } else {
      Object.assign(p, { status: 'failed', failure_reason: reason });
      ledgerFor('payouts', p.id, 'return_payout').forEach(l => Object.assign(l, { status: 'failed', note: reason, updated_at: nowIso() }));
    }
  });
  audit('payout.' + to, 'payout', null, rows.length + ' payouts', reason || r || '', { ids }, { status: to, reference: r });
  return rows.length;
}

/* ---------- announcements & brochures ---------- */
function audienceOf(a: Row): string[] {
  return T('profiles').filter(pr => pr.role === 'investor' && pr.account_status === 'active' && (
    a.audience === 'all'
    || (a.audience === 'selected' && (a.audience_investor_ids || []).includes(pr.id))
    || (a.audience === 'plan' && T('investments').some(i => i.investor_id === pr.id && i.plan_id === a.audience_plan_id && ['pending_funding', ...LIVE].includes(i.status)))
    || (a.audience === 'maturing' && T('investments').some(i => i.investor_id === pr.id && i.status === 'active' && i.maturity_date && diffDays(today(), i.maturity_date) >= 0 && diffDays(today(), i.maturity_date) <= (a.audience_days || 60)))
  )).map(p => p.id);
}
function brochureVisible(id: string, user: string): boolean {
  const b = T('brochures').find(x => x.id === id), p = T('profiles').find(x => x.id === user);
  if (!b || !p || p.account_status !== 'active' || b.status !== 'published') return false;
  const t = today();
  return b.publish_on <= t && (!b.starts_on || b.starts_on <= t) && (!b.ends_on || b.ends_on >= t) && (!b.branch_id || b.branch_id === p.branch_id);
}

/* ---------- dashboard ---------- */
function dashboard(branch: string | null, pFrom: string | null, pTo: string | null) {
  requireAdmin();
  const t = today(), s = settings();
  const to = pTo || t; const from = pFrom || addMonths(to.slice(0, 7) + '-01', -7);
  if (from > to) fail('The start of the date range must be before its end.');
  const inv = T('profiles').filter(p => p.role === 'investor' && (!branch || p.branch_id === branch));
  const invIds = new Set(inv.map(p => p.id)), branchOf = new Map(inv.map(p => [p.id, p.branch_id]));
  const live: Row[] = T('investments').filter(i => invIds.has(i.investor_id) && LIVE.includes(i.status)).map(i => ({ ...i, unlocked: isUnlocked(i), branch_id: branchOf.get(i.investor_id) }));
  const invById = new Map(T('investments').map(i => [i.id, i]));
  const acc: Row[] = T('accruals').filter(a => invIds.has(invById.get(a.investment_id)?.investor_id)).map(a => ({ ...a, branch_id: branchOf.get(invById.get(a.investment_id)!.investor_id) }));
  const pay: Row[] = T('payouts').filter(p => invIds.has(p.investor_id)).map(p => ({ ...p, branch_id: branchOf.get(p.investor_id) }));
  const sum = (rows: Row[], k = 'principal') => round2(rows.reduce((x, r) => x + Number(r[k]), 0));
  const OUT = ['accrued', 'approved', 'processing', 'failed'];
  const months: string[] = []; for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m + '-01', 1).slice(0, 7)) months.push(m);
  const byRate = (rows: Row[], withUnlocked: boolean) => {
    const g = new Map<number, Row[]>(); rows.forEach(r => { const k = Number(r.monthly_rate); g.set(k, [...(g.get(k) || []), r]); });
    return [...g.entries()].sort((a, b) => a[0] - b[0]).map(([rate, rs]) => ({ rate, investors: new Set(rs.map(r => r.investor_id)).size, principal: sum(rs), count: rs.length, ...(withUnlocked ? { unlocked: sum(rs.filter(r => r.unlocked)) } : {}) }));
  };
  const payStatus: Record<string, { count: number; amount: number }> = {};
  pay.forEach(p => { const x = payStatus[p.status] ||= { count: 0, amount: 0 }; x.count++; x.amount = round2(x.amount + Number(p.amount)); });
  const maturing = live.filter(i => !i.unlocked && diffDays(t, i.maturity_date) >= 0 && diffDays(t, i.maturity_date) <= s.approaching_days);
  const lockins = [...new Set(live.map(i => i.lockin_months))].sort((a, b) => a - b);
  return {
    today: t, from, to, branch_id: branch,
    registered_investors: inv.length, total_investors: inv.length, new_investors_month: inv.filter(p => p.created_at.slice(0, 7) >= t.slice(0, 7)).length,
    investors_with_investments: new Set(live.map(i => i.investor_id)).size, live_investments: live.length,
    principal_invested: sum(live), unlocked_principal: sum(live.filter(i => i.unlocked)), unlocked_count: live.filter(i => i.unlocked).length,
    locked_principal: sum(live.filter(i => !i.unlocked)), locked_count: live.filter(i => !i.unlocked).length,
    accrued_total: sum(acc, 'amount'), reversed_total: sum(acc.filter(a => a.kind === 'reversal'), 'amount'), paid_total: sum(pay.filter(p => p.status === 'paid'), 'amount'),
    outstanding_total: sum(pay.filter(p => OUT.includes(p.status)), 'amount'), outstanding_count: pay.filter(p => OUT.includes(p.status)).length,
    maturing_count: maturing.length, maturing_principal: sum(maturing),
    pending_funding: T('investments').filter(i => invIds.has(i.investor_id) && i.status === 'pending_funding').length,
    kyc_pending: inv.filter(p => p.kyc_status === 'pending').length, unassigned_investors: inv.filter(p => !p.branch_id).length, unassigned_principal: sum(live.filter(i => !i.branch_id)),
    payouts_by_status: payStatus,
    monthly: months.map(m => ({ month: m, accrued: sum(acc.filter(a => a.accrual_date.slice(0, 7) === m), 'amount'), paid: sum(pay.filter(p => p.status === 'paid' && (p.paid_on || '').slice(0, 7) === m), 'amount'), invested: sum(live.filter(i => (i.start_date || '').slice(0, 7) === m)) })),
    by_branch: T('branches').filter(b => (!branch && b.status === 'active') || b.id === branch || inv.some(p => p.branch_id === b.id)).sort((a, b) => a.name.localeCompare(b.name)).map(b => {
      const l = live.filter(i => i.branch_id === b.id);
      return { id: b.id, code: b.code, name: b.name, status: b.status, investors: inv.filter(p => p.branch_id === b.id).length, principal: sum(l), unlocked: sum(l.filter(i => i.unlocked)), locked: sum(l.filter(i => !i.unlocked)),
        accrued: sum(acc.filter(a => a.branch_id === b.id), 'amount'), paid: sum(pay.filter(p => p.branch_id === b.id && p.status === 'paid'), 'amount'), by_rate: byRate(l, false) };
    }),
    by_rate: byRate(live, true),
    by_plan: T('plans').map(p => ({ p, pv: T('plan_versions').find(v => v.plan_id === p.id && v.version === p.current_version) })).filter(x => x.pv && (x.p.status !== 'archived' || live.some(i => i.plan_id === x.p.id)))
      .map(({ p, pv }) => { const l = live.filter(i => i.plan_id === p.id); return { plan_id: p.id, plan: p.name, code: p.code, rate: pv!.monthly_rate, status: p.status, investors: new Set(l.map(i => i.investor_id)).size, principal: sum(l), count: l.length }; })
      .sort((a, b) => a.rate - b.rate || a.plan.localeCompare(b.plan)),
    by_lockin: lockins.map(m => { const l = live.filter(i => i.lockin_months === m); return { months: m, count: l.length, principal: sum(l), unlocked: sum(l.filter(i => i.unlocked)) }; })
  };
}


/* ---------- investor ranking: ROI released compared with principal ---------- */
function ranking(branch: string | null, period: string | null = null) {
  const from = period === '6m' ? addMonths(today(), -6) : period === '1y' ? addMonths(today(), -12) : null;
  const rows: Row[] = T('profiles').filter(p => p.role === 'investor' && p.account_status === 'active').map(p => {
    const live = T('investments').filter(i => i.investor_id === p.id && LIVE.includes(i.status));
    const principal = round2(live.reduce((s, i) => s + Number(i.principal), 0));
    const released = round2(T('payouts').filter(x => x.investor_id === p.id && x.status === 'paid' && (!from || (x.paid_on || '') >= from)).reduce((s, x) => s + Number(x.amount), 0));
    const since = live.map(i => i.start_date).filter(Boolean).sort()[0] || null;
    const plans = [...new Set(live.map(i => Number(i.monthly_rate)))].sort((x, y) => x - y).map(r => r + '%').join(', ');
    return { id: p.id, code: p.code, name: p.full_name || p.email, email: p.email, branch_id: p.branch_id, branch: T('branches').find(b => b.id === p.branch_id)?.name ?? null, principal, released, plans,
      multiple: principal ? Math.round((released / principal) * 1000) / 1000 : 0, since, rank: 0, branch_rank: 0 };
  }).filter(r => r.principal > 0)
    .sort((a, b) => b.multiple - a.multiple || b.released - a.released || a.name.localeCompare(b.name));
  rows.forEach((r, k) => { r.rank = k + 1; });
  const perBranch = new Map<string, number>();
  rows.forEach(r => { const k = r.branch_id || '-'; perBranch.set(k, (perBranch.get(k) || 0) + 1); r.branch_rank = perBranch.get(k)!; r.branch_total = 0; });
  rows.forEach(r => { r.branch_total = perBranch.get(r.branch_id || '-'); });
  return { total: rows.length, rows: branch ? rows.filter(r => r.branch_id === branch) : rows };
}

/* ---------- database functions (rpc) ---------- */
export function rpcCall(fn: string, a: Row): unknown {
  const touched = (...t: string[]) => persist(...t, 'audit_logs');
  switch (fn) {
    case 'public_branding': { const s = settings(); return { company_name: s.company_name, tagline: s.tagline, logo_url: s.logo_url, primary_color: s.primary_color, support_email: s.support_email, legal_footer: s.legal_footer }; }
    case 'admin_investor_ranking': requireAdmin(); return ranking(a.p_branch || null, a.p_period || null);
    case 'my_rank': {
      // an investor only learns their own position, never anyone else's name or amounts
      const u = currentUid; if (!u) return null; const r = ranking(null); const me2 = r.rows.find(x => x.id === u);
      return me2 ? { rank: me2.rank, total: r.total, multiple: me2.multiple, branch: me2.branch, branch_rank: me2.branch_rank, branch_total: me2.branch_total } : null;
    }
    case 'admin_dashboard': runAllAccruals(); return dashboard(a.p_branch || null, a.p_from || null, a.p_to || null);
    case 'admin_save_settings': {
      requireAdmin(); const p = a.p || {}; const s = settings(); const before = { ...s };
      if (!blank(p.property_site_url) && !/^https:\/\//i.test(p.property_site_url)) fail('The property website link must start with https://');
      ['company_name', 'tagline', 'primary_color', 'currency', 'locale', 'timezone', 'default_terms', 'default_risk_disclosure', 'support_email', 'support_phone', 'legal_footer', 'show_properties_to'].forEach(k => { if (p[k] != null) s[k] = p[k]; });
      ['approaching_days', 'request_window_days', 'default_payout_lag_days'].forEach(k => { if (!blank(p[k])) s[k] = Number(p[k]); });
      ['four_eyes', 'allow_custom_lockin'].forEach(k => { if (p[k] != null) s[k] = !!p[k]; });
      if ('logo_url' in p) s.logo_url = blank(p.logo_url) ? null : p.logo_url;
      if (Array.isArray(p.lockin_options)) s.lockin_options = p.lockin_options.map(Number).sort((x: number, y: number) => x - y);
      if (!blank(p.property_site_url)) s.property_site_url = String(p.property_site_url).trim();
      s.updated_at = nowIso(); s.updated_by = currentUid;
      audit('settings.update', 'settings', null, 'settings', a.p_reason || 'Settings updated', before, { ...s }); touched('settings'); return null;
    }
    case 'admin_update_investor': {
      requireAdmin(); if (blank(a.p_reason)) fail('A reason is required.');
      const p = T('profiles').find(x => x.id === a.p_id) || fail('Investor not found.'); const before = { ...p };
      ['full_name', 'phone', 'address', 'city', 'id_number_masked', 'bank_name', 'bank_account_masked', 'bank_ifsc'].forEach(k => { if (a.p?.[k] != null) p[k] = a.p[k]; });
      if (a.p && 'introduced_by' in a.p) {
        const by = blank(a.p.introduced_by) ? null : String(a.p.introduced_by);
        if (by && !T('profiles').some(x => x.id === by && x.role === 'super_admin')) fail('Choose a valid admin for "Introduced by".');
        p.introduced_by = by;
        // unpaid bonuses follow the admin who introduced the investor
        T('admin_bonuses').forEach(b => { if (b.investor_id === p.id && b.status === 'accrued') { b.admin_id = by; b.updated_at = nowIso(); } });
      }
      p.updated_at = nowIso(); audit('investor.update', 'profile', p.id, p.code, a.p_reason, before, { ...p }); touched('profiles', 'admin_bonuses'); return null;
    }
    case 'admin_set_investor_status': {
      requireAdmin(); if (blank(a.p_reason)) fail('A reason is required.'); if (a.p_id === currentUid) fail('You cannot change your own account status.');
      const p = T('profiles').find(x => x.id === a.p_id) || fail('Investor not found.'); const old = p.account_status;
      p.account_status = a.p_status; p.updated_at = nowIso(); audit('investor.status', 'profile', p.id, p.code, a.p_reason, { account_status: old }, { account_status: a.p_status }); touched('profiles'); return null;
    }
    case 'admin_set_kyc': {
      requireAdmin(); const p = T('profiles').find(x => x.id === a.p_id) || fail('Investor not found.'); const old = p.kyc_status;
      p.kyc_status = a.p_status; p.updated_at = nowIso();
      notify(p.id, 'kyc_' + a.p_status, a.p_status === 'verified' ? 'Your account is verified' : a.p_status === 'rejected' ? 'Verification needs attention' : 'Verification pending', a.p_reason || '', '/portal/profile', 'profiles_kyc', uuid());
      audit('investor.kyc', 'profile', p.id, p.code, a.p_reason, { kyc_status: old }, { kyc_status: a.p_status }); touched('profiles', 'notifications'); return null;
    }
    case 'admin_set_role': {
      requireAdmin(); if (a.p_id === currentUid) fail('You cannot change your own role.');
      const p = T('profiles').find(x => x.id === a.p_id) || fail('User not found.'); const old = p.role;
      if (a.p_role === 'super_admin' && old !== 'super_admin') p.code = 'ADM-' + nextSeq('admin', 1);
      p.role = a.p_role; if (a.p_role === 'super_admin') p.kyc_status = 'verified'; p.updated_at = nowIso();
      audit('user.role', 'profile', p.id, p.code, a.p_reason, { role: old }, { role: a.p_role }); touched('profiles'); return null;
    }
    case 'update_my_profile': {
      const p = me() || fail('Not signed in.');
      if (a.p_phone != null) p.phone = a.p_phone; if (a.p_address != null) p.address = a.p_address; if (a.p_city != null) p.city = a.p_city; if (a.p_notify_email != null) p.notify_email = !!a.p_notify_email;
      p.updated_at = nowIso(); persist('profiles'); return null;
    }
    case 'admin_create_plan': { const id = createPlan(a.p_code, a.p_name, a.p_description, a.p_version || {}); touched('plans', 'plan_versions'); return id; }
    case 'admin_update_plan': {
      requireAdmin(); if (blank(a.p_reason)) fail('A reason for the change is required.');
      const p = T('plans').find(x => x.id === a.p_plan) || fail('Plan not found.'); if (p.status === 'archived') fail('Archived plans cannot be edited.');
      const prev = T('plan_versions').find(v => v.plan_id === p.id && v.version === p.current_version); const nv = p.current_version + 1;
      insertPlanVersion(p.id, nv, a.p_version || {}, a.p_reason);
      if (!blank(a.p_name)) p.name = a.p_name.trim(); if (a.p_description != null) p.description = a.p_description;
      p.current_version = nv; p.updated_by = currentUid; p.updated_at = nowIso();
      audit('plan.version.create', 'plan', p.id, p.code + ' v' + nv, a.p_reason, prev, a.p_version); touched('plans', 'plan_versions'); return nv;
    }
    case 'admin_set_plan_status': setPlanStatus(a.p_plan, a.p_status, a.p_reason); touched('plans'); return null;
    case 'admin_create_standard_plans': {
      requireAdmin(); let n = 0;
      ([['P2', '2% Monthly Plan', 2], ['P33', '3.3% Monthly Plan', 3.3], ['P6', '6% Monthly Plan', 6]] as [string, string, number][]).forEach(([code, name, rate]) => {
        const exists = T('plans').some(p => p.code === code) || T('plans').some(p => p.status !== 'archived' && T('plan_versions').some(v => v.plan_id === p.id && v.version === p.current_version && Number(v.monthly_rate) === rate));
        if (exists) return;
        const id = createPlan(code, name, `Simple monthly return of ${rate}% on the original principal, paid monthly.`, { monthly_rate: rate, min_amount: 1, max_amount: 999999999999, lockin_options: [6, 12], eligible_from: today(), effective_from: today() });
        if (a.p_activate) setPlanStatus(id, 'active', 'Standard plan published'); n++;
      });
      touched('plans', 'plan_versions'); return n;
    }
    case 'admin_record_investment': { const id = recordInvestment(a); touched('investments', 'ledger_entries'); return id; }
    case 'admin_activate_investment': activateInvestment(a.p_id, a.p_start_date, a.p_deposit_ref, a.p_reason || ''); touched('investments', 'ledger_entries', 'accruals', 'payouts', 'notifications', 'admin_bonuses'); return null;
    case 'admin_cancel_investment': {
      requireAdmin(); if (blank(a.p_reason)) fail('A reason is required.');
      const v = T('investments').find(i => i.id === a.p_id) || fail('Investment not found.'); if (v.status !== 'pending_funding') fail('Only investments awaiting funding can be cancelled.');
      v.status = 'cancelled'; v.cancelled_reason = a.p_reason; v.updated_at = nowIso();
      ledgerFor('investments', v.id, 'deposit').forEach(l => Object.assign(l, { status: 'reversed', note: 'Cancelled: ' + a.p_reason }));
      audit('investment.cancel', 'investment', v.id, v.code, a.p_reason, { status: 'pending_funding' }, { status: 'cancelled' }); touched('investments', 'ledger_entries'); return null;
    }
    case 'admin_record_amendment': {
      requireAdmin(); if (blank(a.p_description)) fail('Describe the amendment.');
      const v = T('investments').find(i => i.id === a.p_id) || fail('Investment not found.'); const id = uuid();
      T('contract_amendments').push({ id, investment_id: v.id, description: a.p_description, effective_date: a.p_effective, document_path: a.p_document_path || null, requested_by: currentUid, approved_by: null, approved_at: null, created_at: nowIso() });
      audit('investment.amendment.request', 'investment', v.id, v.code, a.p_description, null, { effective_date: a.p_effective }); touched('contract_amendments'); return id;
    }
    case 'admin_approve_amendment': {
      requireAdmin(); const am = T('contract_amendments').find(x => x.id === a.p_amendment) || fail('Amendment not found.');
      if (am.approved_at) fail('Already approved.'); fourEyes(am.requested_by, 'approve this amendment');
      am.approved_by = currentUid; am.approved_at = nowIso();
      audit('investment.amendment.approve', 'investment', am.investment_id, T('investments').find(i => i.id === am.investment_id)?.code || '', am.description, null, null); touched('contract_amendments'); return null;
    }
    case 'admin_run_accruals': {
      requireAdmin(); const created = runAllAccruals(); const v = { as_of: today(), created };
      audit('job.accrual.run', 'job', null, 'accruals ' + v.as_of, 'Manual run', null, v); touched('accruals'); return v;
    }
    case 'admin_reverse_accrual': {
      requireAdmin(); if (blank(a.p_reason)) fail('A reason is required.');
      const ac = T('accruals').find(x => x.id === a.p_accrual); if (!ac || ac.kind === 'reversal') fail('Accrual not found.');
      if (T('accruals').some(x => x.reverses_id === ac!.id)) fail('This accrual is already reversed.');
      const p = T('payouts').find(x => x.accrual_id === ac!.id);
      if (p && (p.status === 'paid' || p.status === 'processing')) fail(`This return is ${p.status}. Record an adjustment instead of reversing it.`);
      const rev = { ...ac!, id: uuid(), kind: 'reversal', accrual_date: today(), amount: -ac!.amount, reverses_id: ac!.id, reason: a.p_reason, created_by: currentUid, created_at: nowIso() };
      T('accruals').push(rev);
      if (p) Object.assign(p, { status: 'cancelled', failure_reason: 'Accrual reversed: ' + a.p_reason, updated_at: nowIso() });
      T('admin_bonuses').forEach(b => { if (b.accrual_id === ac!.id && b.status === 'accrued') Object.assign(b, { status: 'cancelled', updated_at: nowIso() }); });
      const code = T('investments').find(i => i.id === ac!.investment_id)?.code || '';
      ledger({ investment_id: ac!.investment_id, investor_id: p?.investor_id ?? null, type: 'reversal', amount: -ac!.amount, status: 'posted', occurred_on: today(), reference: code + ' · period ' + ac!.period_no, note: a.p_reason, source_table: 'accruals', source_id: rev.id });
      audit('accrual.reverse', 'accrual', ac!.id, code + ' period ' + ac!.period_no, a.p_reason, { amount: ac!.amount }, { reversal: -ac!.amount }); touched('accruals', 'payouts', 'ledger_entries', 'admin_bonuses'); return null;
    }
    case 'admin_pay_bonuses': {
      requireAdmin(); const r = str(a.p_ref).trim(); if (!r) fail('Enter the bank reference for this payment.');
      const rows = T('admin_bonuses').filter(b => (a.p_ids || []).includes(b.id));
      if (!rows.length) fail('Select at least one bonus.');
      if (rows.some(b => b.status !== 'accrued')) fail('Only unpaid bonuses can be marked as paid. Refresh and try again.');
      if (rows.some(b => !b.admin_id)) fail('Some selected bonuses have no admin. Set "Introduced by" on the investor first.');
      rows.forEach(b => Object.assign(b, { status: 'paid', payment_ref: r, paid_on: today(), paid_by: currentUid, updated_at: nowIso() }));
      audit('bonus.paid', 'admin_bonus', null, rows.length + ' admin bonuses', r, { ids: a.p_ids }, { status: 'paid', reference: r, total: round2(rows.reduce((x, b) => x + Number(b.amount), 0)) });
      touched('admin_bonuses'); return rows.length;
    }
    case 'admin_payouts_transition': { const n = payoutsTransition(a.p_ids, a.p_to, a.p_ref ?? null, a.p_reason ?? null); touched('payouts', 'ledger_entries', 'notifications'); return n; }
    case 'admin_save_announcement': {
      requireAdmin(); const p = a.p || {}; if (blank(p.title)) fail('Enter a title.');
      const fields = { title: p.title, body: str(p.body), category: str(p.category, 'General notice'), audience: str(p.audience, 'all'), audience_plan_id: blank(p.audience_plan_id) ? null : p.audience_plan_id,
        audience_days: blank(p.audience_days) ? null : Number(p.audience_days), audience_investor_ids: p.audience_investor_ids || [], attachment_path: blank(p.attachment_path) ? null : p.attachment_path, send_email: !!p.send_email, updated_at: nowIso() };
      if (!a.p_id) { const id = uuid(); T('announcements').push({ id, code: 'ANN-' + pad(nextSeq('announcement', 1), 4), status: 'draft', recipients: 0, published_at: null, created_by: currentUid, created_at: nowIso(), ...fields }); touched('announcements'); return id; }
      const row = T('announcements').find(x => x.id === a.p_id && x.status === 'draft') || fail('Only drafts can be edited.');
      Object.assign(row, fields); touched('announcements'); return row.id;
    }
    case 'admin_audience_count': { requireAdmin(); return audienceOf({ ...a.p, audience: a.p?.audience || 'all', audience_days: blank(a.p?.audience_days) ? null : Number(a.p.audience_days) }).length; }
    case 'admin_publish_announcement': {
      requireAdmin(); const an = T('announcements').find(x => x.id === a.p_id) || fail('Announcement not found.'); if (an.status === 'published') fail('Already published.');
      let n = 0; audienceOf(an).forEach(u => { if (notify(u, 'announcement', an.title, an.category, '/portal/announcements', 'announcements', an.id)) n++; });
      Object.assign(an, { status: 'published', published_at: nowIso(), recipients: n, updated_at: nowIso() });
      audit('announcement.publish', 'announcement', an.id, an.code, an.title, null, { audience: an.audience, recipients: n }); touched('announcements', 'notifications'); return n;
    }
    case 'mark_notifications_read': {
      let n = 0; T('notifications').forEach(x => { if (x.user_id === currentUid && !x.read_at && (!a.p_ids || a.p_ids.includes(x.id))) { x.read_at = nowIso(); n++; } });
      persist('notifications'); return n;
    }
    case 'admin_save_branch': {
      requireAdmin(); if (blank(a.p_name) || blank(a.p_code)) fail('Branch code and name are required.');
      const code = a.p_code.trim().toUpperCase(), name = a.p_name.trim();
      if (T('branches').some(b => b.id !== a.p_id && (b.code === code || b.name.toLowerCase() === name.toLowerCase()))) fail('Another branch already uses this code or name.');
      let b: Row, before: Row | null = null;
      if (!a.p_id) { b = { id: uuid(), code, name, city: str(a.p_city).trim(), status: a.p_status || 'active', created_by: currentUid, created_at: nowIso(), updated_at: nowIso() }; T('branches').push(b); }
      else { b = T('branches').find(x => x.id === a.p_id) || fail('Branch not found.'); before = { ...b }; Object.assign(b, { code, name, city: str(a.p_city).trim(), status: a.p_status || b.status, updated_at: nowIso() }); }
      audit(a.p_id ? 'branch.update' : 'branch.create', 'branch', b.id, name, a.p_reason || 'Branch saved', before, { ...b }); touched('branches'); return b.id;
    }
    case 'admin_set_investor_branch': {
      requireAdmin(); if (blank(a.p_reason)) fail('A reason is required.');
      const nb = a.p_branch ? (T('branches').find(b => b.id === a.p_branch) || fail('Branch not found.')) : null; let n = 0;
      T('profiles').filter(p => (a.p_ids || []).includes(p.id) && p.role === 'investor').forEach(p => {
        if ((p.branch_id || null) === (a.p_branch || null)) return;
        const old = T('branches').find(b => b.id === p.branch_id)?.name ?? null;
        p.branch_id = a.p_branch || null; p.updated_at = nowIso(); n++;
        audit('investor.branch', 'profile', p.id, p.code || p.email, a.p_reason, { branch: old }, { branch: nb?.name ?? null });
      });
      touched('profiles'); return n;
    }
    case 'admin_review_flags': {
      requireAdmin();
      return T('investments').filter(i => !['cancelled', 'redeemed'].includes(i.status)).map(i => {
        const p = T('profiles').find(x => x.id === i.investor_id) || {} as Row;
        const r = [![2, 3.3, 6].includes(Number(i.monthly_rate)) ? `Rate ${Number(i.monthly_rate)}% is not one of 2%, 3.3%, 6%` : '', ![6, 12].includes(i.lockin_months) ? `Lock-in of ${i.lockin_months} months` : '',
          !p.branch_id ? 'Investor has no branch' : '', ['active', 'matured'].includes(i.status) && !i.start_date ? 'Missing start date' : ''].filter(Boolean);
        return r.length ? { investment_id: i.id, code: i.code, investor: p.full_name || p.email, reason: r.join('; ') } : null;
      }).filter(Boolean).sort((x: any, y: any) => x.code.localeCompare(y.code));
    }
    case 'admin_save_brochure': {
      requireAdmin(); const p = a.p || {};
      if (blank(p.title)) fail('Enter a brochure title.');
      if (!blank(p.mime) && !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(p.mime)) fail('Brochures must be PDF, PNG, JPG or WebP files.');
      if (Number(p.size_bytes || 0) > 15 * 1024 * 1024) fail('Brochures must be 15 MB or smaller.');
      const common = { title: p.title.trim(), description: str(p.description), plan_id: blank(p.plan_id) ? null : p.plan_id, branch_id: blank(p.branch_id) ? null : p.branch_id, starts_on: blank(p.starts_on) ? null : p.starts_on, ends_on: blank(p.ends_on) ? null : p.ends_on, updated_at: nowIso() };
      if (common.starts_on && common.ends_on && common.ends_on < common.starts_on) fail('The end date must be after the start date.');
      if (!a.p_id) {
        const id = uuid(), code = 'BRO-' + pad(nextSeq('brochure', 1), 4);
        T('brochures').push({ id, code, ...common, storage_path: blank(p.storage_path) ? null : p.storage_path, file_name: str(p.file_name), mime: str(p.mime), size_bytes: Number(p.size_bytes || 0), publish_on: str(p.publish_on, today()), status: 'draft', published_at: null, created_by: currentUid, created_at: nowIso() });
        audit('brochure.create', 'brochure', id, code, p.title, null, p); touched('brochures'); return id;
      }
      const b = T('brochures').find(x => x.id === a.p_id) || fail('Brochure not found.'); const before = { ...b };
      Object.assign(b, common); if (!blank(p.publish_on)) b.publish_on = p.publish_on;
      if (!blank(p.storage_path) && p.storage_path !== b.storage_path) {
        Object.assign(b, { storage_path: p.storage_path, file_name: str(p.file_name), mime: str(p.mime), size_bytes: Number(p.size_bytes || 0) });
        S.tables.brochure_views = T('brochure_views').filter(v => v.brochure_id !== b.id);
      }
      audit('brochure.update', 'brochure', b.id, b.code, p.title, before, p); touched('brochures', 'brochure_views'); return b.id;
    }
    case 'admin_set_brochure_status': {
      requireAdmin(); if (!['draft', 'published', 'archived'].includes(a.p_status)) fail('Unknown status ' + a.p_status + '.');
      const b = T('brochures').find(x => x.id === a.p_id) || fail('Brochure not found.');
      if (a.p_status === 'published' && !b.storage_path) fail('Upload the brochure file before publishing.');
      const old = b.status; b.status = a.p_status; b.updated_at = nowIso(); if (a.p_status === 'published' && !b.published_at) b.published_at = nowIso();
      let n = 0;
      if (a.p_status === 'published') T('profiles').filter(p => p.role === 'investor' && brochureVisible(b.id, p.id)).forEach(p => { if (notify(p.id, 'brochure', b.title, 'New investment update', '/portal?brochure=' + b.id, 'brochures', b.id)) n++; });
      audit('brochure.' + a.p_status, 'brochure', b.id, b.code, a.p_reason || b.title, { status: old }, { status: a.p_status, notified: n }); touched('brochures', 'notifications'); return n;
    }
    case 'my_brochures': {
      const u = currentUid; if (!u) return [];
      return T('brochures').filter(b => brochureVisible(b.id, u)).map(b => {
        const v = T('brochure_views').find(x => x.brochure_id === b.id && x.user_id === u);
        return { id: b.id, code: b.code, title: b.title, description: b.description, storage_path: b.storage_path, file_name: b.file_name, mime: b.mime, plan_id: b.plan_id,
          plan_name: planNameForInvestor(b.plan_id), publish_on: b.publish_on, starts_on: b.starts_on, ends_on: b.ends_on, seen: !!v, acknowledged: !!v?.acknowledged_at };
      }).sort((x, y) => y.publish_on.localeCompare(x.publish_on));
    }
    case 'mark_brochure_seen': {
      const u = currentUid; if (!u || !brochureVisible(a.p_id, u)) fail('Brochure not available.');
      let v = T('brochure_views').find(x => x.brochure_id === a.p_id && x.user_id === u);
      if (!v) { v = { brochure_id: a.p_id, user_id: u, first_seen_at: nowIso(), acknowledged_at: null }; T('brochure_views').push(v); }
      if (a.p_acknowledge && !v.acknowledged_at) v.acknowledged_at = nowIso();
      T('notifications').forEach(n => { if (n.user_id === u && n.kind === 'brochure' && n.source_id === a.p_id && !n.read_at) n.read_at = nowIso(); });
      persist('brochure_views', 'notifications'); return null;
    }
    case 'admin_save_property': {
      requireAdmin(); const p = a.p || {};
      if (blank(p.title)) fail('Enter the property name.');
      if (!/^https:\/\//i.test(str(p.url))) fail("Enter the property's https:// link on the official website.");
      if (!blank(p.image_url) && !/^(https:\/\/|data:image\/)/i.test(p.image_url)) fail('Image links must start with https://');
      const fields = { title: p.title.trim(), location: str(p.location), property_type: str(p.property_type), price_text: str(p.price_text), description: str(p.description), image_url: blank(p.image_url) ? null : p.image_url, url: p.url.trim(), updated_at: nowIso() };
      if (!a.p_id) { const id = uuid(); T('properties').push({ id, ...fields, status: str(p.status, 'draft'), sort_order: Number(p.sort_order || 0), created_by: currentUid, created_at: nowIso() }); audit('property.create', 'property', id, fields.title, '', null, p); touched('properties'); return id; }
      const row = T('properties').find(x => x.id === a.p_id) || fail('Property not found.'); const before = { ...row };
      Object.assign(row, fields); if (!blank(p.status)) row.status = p.status; if (!blank(p.sort_order)) row.sort_order = Number(p.sort_order);
      audit('property.update', 'property', row.id, fields.title, '', before, p); touched('properties'); return row.id;
    }
  }
  return fail(`This action (${fn}) is not available.`);
}

function planNameForInvestor(planId: string | null): string | null {
  const p = T('plans').find(x => x.id === planId); if (!p) return null;
  const v = T('plan_versions').find(x => x.plan_id === p.id && x.version === p.current_version);
  return v ? investorPlanName(p.name, v.monthly_rate) : p.name;
}

/* ---------- accounts ---------- */
export async function createAccount(u: Row): Promise<{ id: string; code: string }> {
  requireAdmin();
  const email = String(u.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Enter a valid email address.');
  if (blank(u.full_name)) fail('Enter the full name.');
  if (String(u.password || '').length < 10) fail('Temporary password must be at least 10 characters.');
  if (S.users.some(x => x.email === email)) fail('A user with this email already exists.');
  const id = uuid(); const admin = u.role === 'super_admin';
  S.users.push({ id, email, pw: await hash(u.password) });
  const by = admin ? null : blank(u.introduced_by) ? currentUid : String(u.introduced_by);
  if (by && !T('profiles').some(x => x.id === by && x.role === 'super_admin')) fail('Choose a valid admin for "Introduced by".');
  const code = admin ? 'ADM-' + nextSeq('admin', 1) : 'INVR-' + nextSeq('investor', 1001);
  T('profiles').push(profileRow(id, email, String(u.full_name).trim(), code, admin ? 'super_admin' : 'investor', admin ? 'verified' : 'pending', { ...u, introduced_by: by }));
  audit(admin ? 'admin.create' : 'investor.create', 'profile', id, code, 'Created with temporary password', null, { email, full_name: u.full_name, role: admin ? 'super_admin' : 'investor' });
  persist('profiles', 'audit_logs');
  return { id, code };
}
export async function setPassword(userId: string, pw: string) {
  if (pw.length < 10) fail('Use at least 10 characters.');
  const u = S.users.find(x => x.id === userId) || fail('User not found.');
  u.pw = await hash(pw); persist();
}
export async function adminResetPassword(userId: string, pw: string) {
  requireAdmin(); await setPassword(userId, pw);
  const p = T('profiles').find(x => x.id === userId); audit('user.password_reset', 'profile', userId, p?.code || p?.email || '', 'Temporary password set by administrator', null, null); persist('audit_logs');
}
export async function checkLogin(email: string, pw: string): Promise<string | null> {
  const u = S.users.find(x => x.email === email.trim().toLowerCase());
  return u && u.pw === await hash(pw) ? u.id : null;
}
export const userEmail = (id: string) => S.users.find(u => u.id === id)?.email || '';

function profileRow(id: string, email: string, name: string, code: string, role: string, kyc: string, x: Row = {}): Row {
  return { id, role, code, full_name: name, email, phone: str(x.phone), address: str(x.address), city: str(x.city), id_number_masked: str(x.id_number_masked), bank_name: str(x.bank_name),
    bank_account_masked: str(x.bank_account_masked), bank_ifsc: str(x.bank_ifsc), kyc_status: kyc, account_status: 'active', notify_email: true, branch_id: x.branch_id ?? null, introduced_by: role === 'investor' ? (x.introduced_by ?? null) : null,
    created_at: x.created_at || nowIso(), updated_at: nowIso() };
}

/* ---------- sample introducers: admins who brought in the sample investors and receive their bonus ---------- */
const SAMPLE_INTRODUCERS: [string, string, string][] = [
  ['Ravi Kumar', 'ravi.kumar@example.com', 'Bangalore'], ['Priya Sharma', 'priya.sharma@example.com', 'Bangalore'], ['Suresh Gowda', 'suresh.gowda@example.com', 'Tumkur']
];
/** Who introduced each sample investor: 0 = the main admin, 1-3 = the sample introducers above. */
const SAMPLE_INTRODUCED_BY: Record<string, number> = {
  [INVESTOR_EMAIL]: 0, 'rahul.menon@example.com': 1, 'fatima.shaikh@example.com': 2, 'vikram.iyer@example.com': 1,
  'meera.kapoor@example.com': 3, 'arjun.nair@example.com': 2, 'sana.qureshi@example.com': 3, 'kavya.reddy@example.com': 1
};
async function addSampleIntroducers(): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, [name, email, city]] of SAMPLE_INTRODUCERS.entries()) {
    const id = uuid();
    S.users.push({ id, email, pw: await hash(INTRODUCER_PASSWORD) });
    T('profiles').push(profileRow(id, email, name, 'ADM-' + nextSeq('admin', 1), 'super_admin', 'verified',
      { city, phone: '+91 99860 ' + String(20000 + i * 4111).slice(-5), created_at: addMonths(today(), -13) + 'T09:30:00Z' }));
    ids.push(id);
  }
  return ids;
}

/* ---------- first run: Parva Realty setup plus a small set of sample investors ---------- */
async function seed(): Promise<Store> {
  S = { v: 4, tables: Object.fromEntries(TABLES.map(t => [t, []])), seq: {}, users: [] };
  T('settings').push({ id: 1, company_name: 'Parva Realty', tagline: 'Every investment, return and maturity in one place.', logo_url: null, primary_color: '#0F2147', currency: 'INR', locale: 'en-IN',
    timezone: 'Asia/Kolkata', approaching_days: 60, request_window_days: 30, default_payout_lag_days: 3, four_eyes: true, allow_custom_lockin: false, lockin_options: [6, 12],
    default_terms: 'Returns are simple interest on the original principal at the monthly rate in this agreement. Unpaid returns are not added to principal.',
    default_risk_disclosure: 'Investments carry risk, including loss of principal. Contractual rates are not a guarantee of payment.',
    support_email: ADMIN_EMAIL, support_phone: '', legal_footer: 'Parva Realty · Dubai & India', property_site_url: 'https://parvarealty.ae/', show_properties_to: 'all', updated_at: nowIso(), updated_by: null });
  const adminId = uuid();
  S.users.push({ id: adminId, email: ADMIN_EMAIL, pw: await hash(ADMIN_PASSWORD) });
  T('profiles').push(profileRow(adminId, ADMIN_EMAIL, 'Chaitra', 'ADM-' + nextSeq('admin', 1), 'super_admin', 'verified', { created_at: addMonths(today(), -13) + 'T09:00:00Z' }));
  currentUid = adminId;
  const introducers = [adminId, ...await addSampleIntroducers()];
  const br = ([['TMK', 'Tumkur'], ['BLR', 'Bangalore']] as [string, string][]).map(([code, name]) => { const id = uuid(); T('branches').push({ id, code, name, city: name, status: 'active', created_by: adminId, created_at: nowIso(), updated_at: nowIso() }); return id; });
  const start = addMonths(today(), -12);
  const plans = ([['P2', '2% Monthly Plan', 2], ['P33', '3.3% Monthly Plan', 3.3], ['P6', '6% Monthly Plan', 6]] as [string, string, number][]).map(([code, name, rate]) => {
    const id = createPlan(code, name, `Simple monthly return of ${rate}% on the original principal, paid monthly.`, { monthly_rate: rate, min_amount: 100000, max_amount: 50000000, lockin_options: [6, 12], eligible_from: start, effective_from: start });
    setPlanStatus(id, 'active', 'Standard plan published'); return id;
  });

  // Sample investors (the first one has a login so the investor portal can be tried).
  const people: [string, string, string, number][] = [
    ['Ananya Rao', INVESTOR_EMAIL, 'Bangalore', 1], ['Rahul Menon', 'rahul.menon@example.com', 'Bangalore', 1], ['Fatima Shaikh', 'fatima.shaikh@example.com', 'Tumkur', 0],
    ['Vikram Iyer', 'vikram.iyer@example.com', 'Tumkur', 0], ['Meera Kapoor', 'meera.kapoor@example.com', 'Bangalore', 1], ['Arjun Nair', 'arjun.nair@example.com', 'Tumkur', 0],
    ['Sana Qureshi', 'sana.qureshi@example.com', 'Bangalore', 1], ['Kavya Reddy', 'kavya.reddy@example.com', 'Tumkur', 0]
  ];
  const ids = await Promise.all(people.map(async ([name, email, city, b], i) => {
    const id = uuid();
    S.users.push({ id, email, pw: await hash(i === 0 ? INVESTOR_PASSWORD : uuid()) });
    T('profiles').push(profileRow(id, email, name, 'INVR-' + nextSeq('investor', 1001), 'investor', i === 7 ? 'pending' : 'verified',
      { city, phone: '+91 98450 ' + String(10000 + i * 1373).slice(-5), branch_id: br[b], bank_name: ['HDFC', 'ICICI', 'SBI', 'Axis'][i % 4], bank_account_masked: '••••' + (4021 + i * 37), bank_ifsc: ['HDFC0001234', 'ICIC0004567', 'SBIN0007890', 'UTIB0001122'][i % 4], introduced_by: introducers[SAMPLE_INTRODUCED_BY[email] ?? 0], created_at: addMonths(today(), -12 + i) + 'T10:00:00Z' }));
    return id;
  }));
  // [investor, plan, lock-in, principal, months ago it started]
  const book: [number, number, number, number, number][] = [
    [0, 1, 12, 500000, 7], [0, 0, 6, 200000, 4], [1, 2, 12, 1000000, 11], [1, 1, 12, 500000, 3], [2, 0, 12, 500000, 10], [3, 1, 6, 300000, 8],
    [4, 1, 6, 750000, 5], [4, 2, 12, 1500000, 2], [5, 1, 12, 1500000, 9], [6, 2, 12, 2500000, 6], [6, 0, 6, 300000, 1]
  ];
  book.forEach(([who, plan, lock, amt, ago], k) => {
    const id = recordInvestment({ p_investor: ids[who], p_plan: plans[plan], p_lockin_months: lock, p_principal: amt, p_agreement_ref: 'AGR-' + (2001 + k), p_deposit_ref: '' });
    activateInvestment(id, addDays(addMonths(today(), -ago), -((k * 3) % 9)), 'UTR ' + (58120000 + k * 7919), 'Deposit confirmed');
  });
  recordInvestment({ p_investor: ids[5], p_plan: plans[0], p_lockin_months: 6, p_principal: 250000, p_agreement_ref: 'AGR-2099', p_deposit_ref: '' });
  // Older returns have been paid out; the latest ones are still with the team.
  const t = today();
  T('payouts').forEach(p => {
    const age = diffDays(p.due_date, t);
    if (age > 20) { Object.assign(p, { status: 'paid', approved_by: adminId, approved_at: nowIso(), sent_by: adminId, sent_at: nowIso(), batch_ref: 'BATCH-' + p.due_date.replace(/-/g, ''), payment_ref: 'UTR ' + (59000000 + T('payouts').indexOf(p) * 131), confirmed_by: adminId, confirmed_at: nowIso(), paid_on: addDays(p.due_date, 1) });
      ledger({ investment_id: p.investment_id, investor_id: p.investor_id, type: 'return_payout', amount: p.amount, status: 'confirmed', occurred_on: p.paid_on, reference: p.payment_ref, note: p.code, source_table: 'payouts', source_id: p.id }); }
    else if (age > 5) Object.assign(p, { status: 'approved', approved_by: adminId, approved_at: nowIso() });
  });
  T('admin_bonuses').forEach(b => { const p = T('payouts').find(x => x.accrual_id === b.accrual_id); if (p?.status === 'paid') Object.assign(b, { status: 'paid', payment_ref: p.payment_ref, paid_on: p.paid_on, paid_by: adminId }); });
  T('notifications').forEach(n => { if (n.created_at && diffDays(n.created_at.slice(0, 10), t) >= 0) n.read_at = T('payouts').find(p => p.accrual_id === n.source_id)?.status === 'paid' ? nowIso() : null; });
  T('properties').push(...parvaProperties(adminId));
  T('audit_logs').forEach(l => { l.actor_name = 'Chaitra'; });
  currentUid = null;
  return S;
}


/* ---------- the property catalogue published on parvarealty.ae (October 2026) ---------- */
const PARVA_URL = 'https://www.parvarealty.ae/#properties';
// photos as shown in each property's details on parvarealty.ae
const PARVA_IMG: Record<string, string> = {
  'Mercedes-Benz Places': 'https://www.parvarealty.ae/assets/image-1-CXaW41xx.png',
  'Portofino Felicita': 'https://www.parvarealty.ae/assets/image-43-B4Mm8xRT.png',
  'SAMANA South Haven': 'https://www.parvarealty.ae/assets/image-7-BUDqZRZd.png',
  'Sunset Bay Grand': 'https://www.parvarealty.ae/assets/image-16-B8QVYKbA.png',
  'The Symphony': 'https://www.parvarealty.ae/assets/image-20-BZPMbuKe.png',
  'Auresta Tower': 'https://www.parvarealty.ae/assets/image-11-Diy888YD.png',
  'Tiger Sky Tower': 'https://www.parvarealty.ae/assets/image-28-DU1kaeTK.png',
  'Serenz': 'https://www.parvarealty.ae/assets/image-31-B0ydBebC.png',
  'Bianca': 'https://www.parvarealty.ae/assets/image-37-Dcl805qL.png',
  'Enre Residence': 'https://www.parvarealty.ae/assets/image-47-YM830T3P.png',
  'TIMEZ': 'https://www.parvarealty.ae/assets/image-54-BruEDsDt.png',
  'Greenz': 'https://www.parvarealty.ae/assets/image-59-C68cVji4.png',
};
// [title, location, developer, type, size, handover, price, rental yield, capital growth, summary]
const PARVA: [string, string, string, string, string, string, string, string, string, string][] = [
  ['Mercedes-Benz Places', 'Downtown Dubai', 'Binghatti Developers', 'Branded Luxury Residences', '1,500 – 4,000 sq ft', 'Q4 2027', '₹13.03 Cr+ (AED 5M+)', '6.8%', '14.2%', 'The only Mercedes-Benz co-branded residential tower in the world, with Burj Khalifa views.'],
  ['Portofino Felicita', 'Europe Island, The World Islands', 'The Heart of Europe', 'Sea-View Resort Units', '1,200 – 2,000 sq ft', 'Q2 2027', '₹13.6 – 14.3 Cr (AED 5.22M – 5.49M)', '7.2%', '13.5%', 'A resort-style sea-view residence on a man-made island.'],
  ['SAMANA South Haven', 'Dubai South', 'SAMANA Developers', 'Studio / 1BR', '450 – 680 sq ft', 'Q3 2027', '₹1.56 Cr (from AED 599K)', '8.4%', '7.8%', 'Private-pool studios in the Al Maktoum Airport growth corridor, with a 1% monthly payment plan.'],
  ['Sunset Bay Grand', 'Dubai Islands', 'Imtiaz Developments', '1BR / 2BR / 3BR Duplex', '900 – 2,800 sq ft', 'Q3 2027', '₹6.10 Cr (~AED 2.34M)', '8.1%', '11.2%', 'Waterfront address with direct sea access and a 3BR duplex format.'],
  ['The Symphony', 'Meydan Horizon', 'Imtiaz Developments', '4BR / 5BR Residences', '3,200 – 6,500 sq ft', 'Q1 2028', '₹18.95 Cr (~AED 7.27M)', '6.5%', '15.1%', 'Design-led ultra-luxury residences in Meydan with racecourse views.'],
  ['Auresta Tower', 'Jumeirah Village Circle', 'Tiger Properties', 'Studio / 1BR', '480 – 750 sq ft', 'Q2 2027', '₹2.22 Cr (~AED 850K)', '9.1%', '7.2%', 'JVC studios, an area known for some of Dubai’s highest studio rental yields.'],
  ['Tiger Sky Tower', 'Business Bay', 'Tiger Properties', '1BR / 2BR / 3BR+', '780 – 2,400 sq ft', 'Q4 2027', '₹8.26 Cr (~AED 3.17M)', '7.8%', '10.5%', 'Iconic architecture in central Business Bay.'],
  ['Serenz', 'Jumeirah Village Circle', 'Danube Properties', 'Studio / 1BR / 2BR', '500 – 1,100 sq ft', 'Q4 2027', '₹2.87 Cr (~AED 1.10M)', '8.8%', '7.5%', 'Danube project in JVC with a flexible 1% payment plan.'],
  ['Bianca', 'Dubailand', 'Reportage Properties', '2BR Townhouse', '1,450 – 1,800 sq ft', 'Q1 2028', '₹3.47 Cr (~AED 1.33M)', '7.9%', '9.4%', 'Townhouses at mid-range pricing with strong family rental demand.'],
  ['Enre Residence', 'Dubai South', 'Imtiaz Developments', '2BR', '1,200 – 1,550 sq ft', 'Q2 2027', '₹4.92 Cr (~AED 1.89M)', '8.5%', '9.8%', 'Premium-design 2BR homes in the Dubai South growth corridor.'],
  ['TIMEZ', 'Dubai Silicon Oasis', 'Danube Properties', '1BR / 2BR', '900 – 1,350 sq ft', 'Q3 2027', '₹4.30 Cr (~AED 1.65M)', '8.2%', '8.6%', 'Tech-hub location with steady rental demand and a 1% payment plan.'],
  ['Greenz', 'Academic City', 'Danube Properties', '3BR Family', '1,800 – 2,400 sq ft', 'Q1 2028', '₹9.56 Cr (~AED 3.67M)', '7.5%', '9.9%', 'Large family apartments next to Academic City’s 50,000-student catchment.']
];
function parvaProperties(by: string | null): Row[] {
  return PARVA.map(([title, location, dev, type, size, handover, price, yld, cap, about], k) => ({
    id: uuid(), title, location, property_type: type, price_text: price,
    description: `${about} By ${dev} · ${size} · handover ${handover} · ${yld} rental yield, ${cap} capital growth (as listed by Parva Realty).`,
    image_url: PARVA_IMG[title] || null, url: PARVA_URL, status: 'published', sort_order: k + 1, created_by: by, created_at: nowIso(), updated_at: nowIso()
  }));
}

/* ---------- start-up ---------- */
let readyP: Promise<void> | null = null;
export function ready(): Promise<void> {
  return readyP ||= (async () => {
    let saved: Store | undefined;
    saved = load();
    if (saved) {
      S = saved; TABLES.forEach(t => { S.tables[t] ||= []; });
      // move browsers that still have the old blue brand colour onto the current blue theme
      // replace the two old placeholder properties with the real Parva Realty catalogue
      const props = T('properties');
      if (props.length <= 2 && props.every(x => ['Parva Residences, Business Bay', 'Parva Villas, Tumkur Road'].includes(x.title))) { S.tables.properties = parvaProperties(null); save(); }
      T('properties').forEach(x => { if (!x.image_url && PARVA_IMG[x.title] && x.url === PARVA_URL) { x.image_url = PARVA_IMG[x.title]; save(); } });
      // the branches are Bangalore and Tumkur (the Dubai branch of earlier versions becomes Tumkur, investors and history stay with it)
      T('branches').forEach(b => { if (b.code === 'DXB' || b.name === 'Dubai') { Object.assign(b, { code: 'TMK', name: 'Tumkur', city: 'Tumkur', updated_at: nowIso() }); save(); } });
      T('profiles').forEach(x => { if (x.city === 'Dubai') { x.city = 'Tumkur'; save(); } });
      const st = settings(); if (st && ['#1C2B4A', '#0B1F3F', '#121212'].includes(st.primary_color)) { st.primary_color = '#0F2147'; save(); }
      // v2: admin bonus split. Investors get "introduced by" (the admin who created them) and every investment gets its split;
      // returns already accrued stay as they were, the new split applies from the next month.
      if ((S.v || 1) < 2) {
        const admins = new Set(T('profiles').filter(p => p.role === 'super_admin').map(p => p.id));
        T('profiles').forEach(x => {
          if (x.role !== 'investor' || x.introduced_by !== undefined) return;
          const by = T('audit_logs').find(l => l.action === 'investor.create' && l.entity_id === x.id)?.actor_id || T('investments').find(i => i.investor_id === x.id && i.created_by)?.created_by || null;
          x.introduced_by = by && admins.has(by) ? by : null;
        });
        T('investments').forEach(i => { if (i.investor_rate === undefined) applySplit(i); });
        S.v = 2; save();
      }
      // v3: the 2% and 3.3% plans are split too (2% = 1.5% + 0.5%, 3.3% = 2.3% + 1%). Returns already accrued stay as they were;
      // the new split applies from the next monthly accrual.
      if ((S.v || 1) < 3) { T('investments').forEach(i => applySplit(i)); S.v = 3; save(); }
      // v4: sample introducers. The sample investors are spread across a few admins so the bonus shows going to each of them.
      if ((S.v || 1) < 4) {
        const sample = T('profiles').filter(p => p.role === 'investor' && p.email in SAMPLE_INTRODUCED_BY);
        if (sample.length && !T('profiles').some(p => p.email === SAMPLE_INTRODUCERS[0][1])) {
          const main = T('profiles').find(p => p.role === 'super_admin' && p.email === ADMIN_EMAIL)?.id ?? null;
          const introducers = [main, ...await addSampleIntroducers()];
          sample.forEach(p => {
            const by = introducers[SAMPLE_INTRODUCED_BY[p.email]] ?? main;
            p.introduced_by = by;
            T('admin_bonuses').forEach(b => { if (b.investor_id === p.id) b.admin_id = by; });
          });
        }
        S.v = 4; save();
      }
    }
    else { S = await seed(); save(); }
    runAllAccruals();
    setInterval(() => runAllAccruals(), 60 * 60 * 1000);
  })();
}
/** Wipes this browser's data and starts again from the Parva Realty setup. */
export async function resetAll(sample = true) {
  S = await seed();
  if (!sample) {
    const keepUsers = new Set(T('profiles').filter(p => p.role === 'super_admin').map(p => p.id));
    ['investments', 'contract_amendments', 'accruals', 'payouts', 'ledger_entries', 'notifications', 'documents', 'audit_logs', 'brochures', 'brochure_views'].forEach(t => { S.tables[t] = []; });
    S.tables.profiles = T('profiles').filter(p => keepUsers.has(p.id));
    S.users = S.users.filter(u => keepUsers.has(u.id));
  }
  save();
}
