import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fetchAll } from '../lib/api';
import { useQuery, refreshAll } from '../lib/useQuery';
import { createIbLogin } from '../lib/adminApi';
import { money } from '../lib/format';
import { downloadCsv } from '../lib/csv';
import type { AdminBonus, Branch, Investment, Profile } from '../lib/types';
import { AcctBadge, Drawer, ErrorNote, Field, Kpi, Loading, PageHead, useAction } from '../ui/kit';
import { DataTable, Col } from '../ui/DataTable';
import { Icon } from '../ui/Icon';

/* IBs: logins that sign in with their phone number and only see the people the Super Admin put under them. */

const LIVE = ['active', 'matured', 'redemption_requested', 'redemption_processing'];
const r2 = (x: number) => Math.round(x * 100) / 100;
interface Row extends Profile { branch: string; people: number; peoplePrincipal: number; own: number; monthly: number; earned: number; paid: number }

async function load() {
  const [people, invs, bon, branches] = await Promise.all([
    fetchAll<Profile>((a, b) => api.from('profiles').select('*').eq('role', 'investor').range(a, b)),
    fetchAll<Investment>((a, b) => api.from('investments').select('*').range(a, b)),
    fetchAll<AdminBonus>((a, b) => api.from('admin_bonuses').select('*').range(a, b)),
    fetchAll<Branch>((a, b) => api.from('branches').select('*').range(a, b))
  ]);
  const bn = new Map(branches.map(b => [b.id, b.name]));
  const live = invs.filter(i => LIVE.includes(i.status));
  const rows: Row[] = people.filter(p => p.can_introduce).map(p => {
    const under = people.filter(x => x.introduced_by === p.id).map(x => x.id);
    const theirs = live.filter(i => under.includes(i.investor_id));
    const mine = bon.filter(b => b.admin_id === p.id && b.status !== 'cancelled');
    return {
      ...p, branch: p.branch_id ? bn.get(p.branch_id) || '' : '', people: under.length,
      peoplePrincipal: theirs.reduce((s, i) => s + Number(i.principal), 0),
      own: live.filter(i => i.investor_id === p.id).reduce((s, i) => s + Number(i.principal), 0),
      monthly: r2(theirs.filter(i => i.status === 'active').reduce((s, i) => s + Number(i.admin_bonus || 0), 0)),
      earned: r2(mine.reduce((s, b) => s + Number(b.amount), 0)), paid: r2(mine.filter(b => b.status === 'paid').reduce((s, b) => s + Number(b.amount), 0))
    };
  }).sort((a, b) => a.full_name.localeCompare(b.full_name));
  return { rows, branches };
}

export function IBs() {
  const nav = useNavigate();
  const q = useQuery(load, []);
  const [adding, setAdding] = useState(false);
  const rows = q.data?.rows || [];
  const cols: Col<Row>[] = useMemo(() => [
    { h: 'IB', v: r => r.full_name, r: r => <><b>{r.full_name}</b><span className="sub">{r.code}{r.branch ? ' · ' + r.branch : ''}</span></> },
    { h: 'Login phone', v: r => r.phone, r: r => <span className="num">{r.phone || '—'}</span> },
    { h: 'People under', n: true, v: r => r.people },
    { h: 'Their principal', n: true, v: r => r.peoplePrincipal, r: r => money(r.peoplePrincipal) },
    { h: 'Own investment', n: true, v: r => r.own, r: r => r.own ? money(r.own) : <span className="muted">—</span> },
    { h: 'IB bonus / month', n: true, v: r => r.monthly, r: r => money(r.monthly) },
    { h: 'Bonus earned', n: true, v: r => r.earned, r: r => <>{money(r.earned)}<span className="sub">{money(r.paid)} paid</span></> },
    { h: 'Login', v: r => r.account_status, r: r => <AcctBadge s={r.account_status} /> }
  ], []);
  const sum = (k: 'people' | 'peoplePrincipal' | 'monthly' | 'earned') => rows.reduce((s, r) => s + r[k], 0);
  return (
    <>
      <PageHead crumbs={['IBs']} title="IBs"
        sub="IBs sign in with their phone number. They only see the people you put under them, their investments and the bonus they earn. They cannot add or change anything."
        actions={<>
          <button className="btn" disabled={!rows.length} onClick={() => downloadCsv('ibs', ['IB ID', 'Name', 'Phone', 'Branch', 'People under', 'Their principal', 'Own investment', 'IB bonus / month', 'Bonus earned', 'Bonus paid'],
            rows.map(r => [r.code, r.full_name, r.phone, r.branch, r.people, r.peoplePrincipal.toFixed(2), r.own.toFixed(2), r.monthly.toFixed(2), r.earned.toFixed(2), r.paid.toFixed(2)]))}><Icon name="download" />Export CSV</button>
          <button className="btn" onClick={() => nav('/admin/investments?new=1')}><Icon name="plus" />Record investment</button>
          <button className="btn accent" onClick={() => setAdding(true)}><Icon name="plus" />Create IB</button>
        </>} />
      {q.error ? <ErrorNote msg={q.error} retry={q.reload} /> : !q.data ? <Loading /> : (
        <>
          <div className="kpis k4">
            <Kpi label="IBs" value={rows.length} sub={`${rows.filter(r => r.account_status === 'active').length} can sign in`} />
            <Kpi label="People under IBs" value={sum('people')} sub={money(sum('peoplePrincipal')) + ' live principal'} />
            <Kpi label="IB bonus per month" value={money(sum('monthly'))} sub="from active investments" />
            <Kpi label="IB bonus earned" value={money(sum('earned'))} sub="pay it under IB Bonus" />
          </div>
          <DataTable rows={rows} cols={cols} rowKey={r => r.id} searchPh="Search IB name, ID, phone" text={r => `${r.code} ${r.phone}`} href={r => '/admin/investors/' + r.code} sort={0} dir={1} per={20}
            emptyTitle="No IBs yet" empty="Use “Create IB” to give someone a login. Then choose them under “Under IB” when you record an investment." />
        </>
      )}
      {adding && <CreateIB branches={q.data?.branches || []} onClose={() => setAdding(false)} onDone={code => { setAdding(false); nav('/admin/investors/' + code); }} />}
    </>
  );
}

const genPw = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return 'IB@' + s; };

function CreateIB({ branches, onClose, onDone }: { branches: Branch[]; onClose: () => void; onDone: (code: string) => void }) {
  const act = useAction();
  const [f, setF] = useState({ full_name: '', phone: '', password: genPw(), email: '', city: '', branch_id: '' });
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const errs = {
    full_name: !f.full_name.trim() ? 'Enter the name.' : null,
    phone: f.phone.replace(/\D/g, '').length < 10 ? 'Enter a 10-digit phone number.' : null,
    password: f.password.length < 8 ? 'At least 8 characters.' : null
  };
  const go = async () => {
    setTried(true); if (Object.values(errs).some(Boolean)) return;
    const r = await act.run(() => createIbLogin({ full_name: f.full_name.trim(), phone: f.phone.trim(), password: f.password, email: f.email.trim(), city: f.city.trim(), branch_id: f.branch_id || null }),
      ['IB created', `${f.full_name.trim()} signs in with ${f.phone.trim()}`]);
    if (r) { refreshAll(); onDone(r.code); }
  };
  const e = (k: keyof typeof errs) => (tried ? errs[k] : null);
  return (
    <Drawer title="Create IB" sub="The IB signs in with this phone number and password. Share them offline." onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={go} disabled={act.busy}>{act.busy ? 'Creating…' : 'Create IB'}</button></>}>
      <div className="form">
        <Field label="Full name *" err={e('full_name')}><input className={'input ' + (e('full_name') ? 'bad' : '')} value={f.full_name} onChange={set('full_name')} /></Field>
        <div className="f-row">
          <Field label="Phone number (login) *" err={e('phone')}><input className={'input num ' + (e('phone') ? 'bad' : '')} inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="e.g. 98450 12345" /></Field>
          <Field label="Password *" err={e('password')} hint="They can change it after signing in."><input className={'input mono ' + (e('password') ? 'bad' : '')} value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        </div>
        <div className="f-row">
          <Field label="City"><input className="input" value={f.city} onChange={set('city')} /></Field>
          <Field label="Branch">
            <select className="input" value={f.branch_id} onChange={set('branch_id')}><option value="">No branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
        </div>
        <Field label="Email" hint="Optional. Only for your records."><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        <div className="note info">After creating the IB, use <b>Record investment</b> and choose this IB under “Under IB” for each person they bring. If the IB invests themselves, record it with the IB’s own phone number.</div>
      </div>
    </Drawer>
  );
}
