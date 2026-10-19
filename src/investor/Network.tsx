import { Fragment, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useQuery, refreshAll } from '../lib/useQuery';
import { money, date, rateShort, today } from '../lib/format';
import { addMyInvestor, loadNetwork, type Network, type NetInvestment, type NetInvestor } from '../lib/networkApi';
import { Badge, Drawer, Empty, ErrorNote, Field, Kpi, Loading, PageHead, useAction } from '../ui/kit';
import { Icon } from '../ui/Icon';

/* Investors who bring in investors.
   The introducer sees, below their own investments: the investors they brought in, those investors' investments
   and the bonus they earn from them. The investors they brought in never see any of this. */

const LIVE = ['active', 'matured', 'redemption_requested', 'redemption_processing'];
const r2 = (x: number) => Math.round(x * 100) / 100;

const INV_STATUS: Record<string, [string, string]> = {
  pending_funding: ['Awaiting deposit', 'b-amber'], active: ['Active', 'b-green'], matured: ['Matured', 'b-blue'],
  redemption_requested: ['Closing', 'b-grey'], redemption_processing: ['Closing', 'b-grey'], redeemed: ['Closed', 'b-grey']
};
const InvStatus = ({ s }: { s: string }) => { const [l, c] = INV_STATUS[s] || [s, 'b-grey']; return <Badge cls={c}>{l}</Badge>; };
const PersonStatus = ({ p }: { p: NetInvestor }) => p.account_status !== 'active' ? <Badge cls="b-red">Suspended</Badge>
  : p.kyc_status === 'verified' ? <Badge cls="b-green">Verified</Badge> : p.kyc_status === 'rejected' ? <Badge cls="b-red">Not verified</Badge> : <Badge cls="b-amber">Awaiting verification</Badge>;

const livePrincipal = (p: NetInvestor) => p.investments.filter(i => LIVE.includes(i.status)).reduce((s, i) => s + i.principal, 0);
const monthlyBonus = (invs: NetInvestment[]) => r2(invs.filter(i => i.status === 'active').reduce((s, i) => s + i.bonus_monthly, 0));
const earned = (invs: NetInvestment[]) => r2(invs.reduce((s, i) => s + i.bonus_earned, 0));
const earnedPaid = (invs: NetInvestment[]) => r2(invs.reduce((s, i) => s + i.bonus_paid, 0));

/** "My investors" section. On the Overview it sits below the investor's own investments; `page` renders it as its own page. */
export function MyNetwork({ page = false }: { page?: boolean }) {
  const { profile } = useAuth();
  const q = useQuery(loadNetwork, [profile?.id]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [allBonus, setAllBonus] = useState(false);

  const head = page ? <PageHead crumbs={['My investors']} title="My investors" sub="The investors you brought in, their investments and the bonus you earn from them." /> : null;
  if (q.error) return page ? <>{head}<ErrorNote msg={q.error} retry={q.reload} /></> : null;
  if (!q.data) return page ? <>{head}<Loading /></> : null;
  const d: Network = q.data;
  if (!d.can_introduce && !d.investors.length) {
    return page ? <>{head}<div className="card"><div className="card-b"><Empty title="Adding investors is not turned on for you">Ask the company if you would like to bring in investors. You earn a bonus on every investment they make.</Empty></div></div></> : null;
  }

  const allInv = d.investors.flatMap(p => p.investments);
  const unpaid = r2(d.bonuses.filter(b => b.status === 'accrued').reduce((s, b) => s + b.amount, 0));
  const paid = r2(d.bonuses.filter(b => b.status === 'paid').reduce((s, b) => s + b.amount, 0));
  const waiting = d.investors.filter(p => p.kyc_status !== 'verified').length + allInv.filter(i => i.status === 'pending_funding').length;
  const bonusRows = allBonus ? d.bonuses : d.bonuses.slice(0, 8);
  const addBtn = d.can_introduce ? <button className="btn accent" onClick={() => setAdding(true)}><Icon name="plus" />Add investor</button> : null;

  return (
    <>
      {page ? <PageHead crumbs={['My investors']} title="My investors" sub="The investors you brought in, their investments and the bonus you earn from them." actions={addBtn} /> : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <div style={{ flex: 1, minWidth: 220 }}><h2 style={{ margin: 0, fontSize: 20 }}>Investors you brought in</h2>
            <p className="hint" style={{ marginTop: 4 }}>Their investments and the bonus you earn from them. They only see their own investment and returns.</p></div>
          {addBtn}
        </div>
      )}

      <div className="kpis k4">
        <Kpi label="My investors" value={d.investors.length} sub={waiting ? `${waiting} waiting for the company` : 'all confirmed'} subCls={waiting ? 'warn' : ''} />
        <Kpi label="Their investment" value={money(d.investors.reduce((s, p) => s + livePrincipal(p), 0))} sub={`${allInv.filter(i => LIVE.includes(i.status)).length} live investments`} />
        <Kpi label="My bonus per month" value={money(monthlyBonus(allInv))} sub="from active investments" />
        <Kpi label="Bonus received" cls="pos" value={money(paid)} sub={unpaid ? `${money(unpaid)} still to be paid` : 'nothing pending'} />
      </div>

      <div className="card">
        <div className="card-h"><h3>My investors</h3><div className="r">click a row to see their investments</div></div>
        {d.investors.length ? (
          <div className="tbl"><table>
            <thead><tr><th>Investor</th><th>Status</th><th className="n">Investment</th><th className="n">My bonus / month</th><th className="n">Bonus earned</th><th /></tr></thead>
            <tbody>{d.investors.map(p => (
              <Fragment key={p.id}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <td><b>{p.name}</b><span className="sub">{p.code} · {p.phone || p.email}</span></td>
                  <td><PersonStatus p={p} /></td>
                  <td className="n">{money(livePrincipal(p))}<span className="sub">{p.investments.length} investment{p.investments.length === 1 ? '' : 's'}</span></td>
                  <td className="n">{money(monthlyBonus(p.investments))}</td>
                  <td className="n">{money(earned(p.investments))}<span className="sub">{money(earnedPaid(p.investments))} received</span></td>
                  <td className="n"><span className="muted">{open === p.id ? 'Hide ▴' : 'View ▾'}</span></td>
                </tr>
                {open === p.id && (
                  <tr><td colSpan={6} style={{ background: 'var(--surface-2, transparent)' }}>
                    {p.investments.length ? (
                      <div className="tbl"><table>
                        <thead><tr><th>Investment</th><th>Plan</th><th className="n">Amount</th><th>Their return / your bonus</th><th>Started</th><th className="n">My bonus / month</th><th className="n">Earned</th><th>Status</th></tr></thead>
                        <tbody>{p.investments.map(i => (
                          <tr key={i.id}>
                            <td className="mono">{i.code}</td>
                            <td>{i.plan_name}<span className="sub">{i.lockin_months} months lock-in</span></td>
                            <td className="n">{money(i.principal)}</td>
                            <td>{rateShort(i.investor_rate)} to them · <b>{rateShort(i.bonus_rate)} to you</b></td>
                            <td>{i.start_date ? date(i.start_date) : <span className="muted">Not started</span>}{i.maturity_date && <span className="sub">matures {date(i.maturity_date)}</span>}</td>
                            <td className="n">{money(i.bonus_monthly)}</td>
                            <td className="n">{money(i.bonus_earned)}</td>
                            <td><InvStatus s={i.status} /></td>
                          </tr>
                        ))}</tbody>
                      </table></div>
                    ) : <p className="hint" style={{ padding: 8 }}>No investments yet.</p>}
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody>
          </table></div>
        ) : <div className="card-b"><Empty title="No investors yet">Use “Add investor” to bring someone in. Once the company verifies them and confirms their deposit, you earn a bonus every month on their investment.</Empty></div>}
      </div>

      <div className="card">
        <div className="card-h"><h3>Bonus from my investors</h3><div className="r">{d.bonuses.length > 8 && <a style={{ cursor: 'pointer' }} onClick={() => setAllBonus(!allBonus)}>{allBonus ? 'Show latest' : `Show all ${d.bonuses.length}`}</a>}</div></div>
        {d.bonuses.length ? (
          <div className="tbl"><table>
            <thead><tr><th>Month</th><th>From</th><th>Investment</th><th>Rate</th><th className="n">Amount</th><th>Status</th></tr></thead>
            <tbody>{bonusRows.map(b => (
              <tr key={b.id}>
                <td>{date(b.accrual_date)}<span className="sub">month {b.period_no}</span></td>
                <td>{b.investor_name}<span className="sub">{b.investor_code}</span></td>
                <td className="mono">{b.investment_code}</td>
                <td>{rateShort(b.rate)}</td>
                <td className="n">{money(b.amount)}</td>
                <td>{b.status === 'paid' ? <Badge cls="b-green">Received{b.paid_on ? ' ' + date(b.paid_on) : ''}</Badge> : <Badge cls="b-amber">To be paid</Badge>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="card-b"><Empty title="No bonus yet">Your bonus starts one month after an investor’s deposit is confirmed.</Empty></div>}
      </div>

      {adding && <AddMyInvestor d={d} onClose={() => setAdding(false)} />}
    </>
  );
}

const tempPassword = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return 'Parva@' + s;
};

/** Form an introducing investor uses to add a new investor and their investment. */
function AddMyInvestor({ d, onClose }: { d: Network; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ full_name: '', email: '', phone: '', city: '', password: tempPassword(), plan: d.plans.length === 1 ? d.plans[0].id : '', lock: '', amount: '', start: today() });
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<null | { code: string; investment: string; email: string; password: string }>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const plan = d.plans.find(p => p.id === f.plan);
  const lock = f.lock || (plan ? String([...plan.lockin_options].sort((a, b) => a - b)[0] ?? '') : '');
  const amt = Number(f.amount);
  const errs: Record<string, string | null> = {
    full_name: !f.full_name.trim() ? 'Enter their full name.' : null,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()) ? 'Enter a valid email address.' : null,
    phone: !f.phone.trim() ? 'Enter a phone number.' : null,
    password: f.password.length < 10 ? 'At least 10 characters.' : null,
    plan: !plan ? 'Choose a plan.' : null,
    amount: !(amt > 0) ? 'Enter the amount.' : !/^\d+(\.\d{1,2})?$/.test(f.amount.trim()) ? 'At most 2 decimals.' : plan && (amt < plan.min_amount || amt > plan.max_amount) ? `This plan accepts ${money(plan.min_amount)} to ${money(plan.max_amount)}.` : null
  };
  const e = (k: string) => (tried ? errs[k] : null);
  const save = async () => {
    setTried(true);
    if (Object.values(errs).some(Boolean)) return;
    const r = await act.run(() => addMyInvestor({ full_name: f.full_name.trim(), email: f.email.trim().toLowerCase(), phone: f.phone.trim(), city: f.city.trim(), password: f.password,
      plan: f.plan, lockin_months: Number(lock), principal: amt, start_date: f.start || today() }), ['Investor added', 'The company will verify them and confirm the deposit.']);
    if (r) { setDone({ ...r, email: f.email.trim().toLowerCase(), password: f.password }); refreshAll(); }
  };

  if (done) return (
    <Drawer title="Investor added" sub="Share these sign-in details with them. They should change the password after signing in." onClose={onClose}
      foot={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="form">
        <dl className="kv">
          <dt>Name</dt><dd>{f.full_name}</dd>
          <dt>Investor ID</dt><dd className="mono">{done.code}</dd>
          <dt>Investment</dt><dd className="mono">{done.investment} · {money(amt)}</dd>
          <dt>Email (sign-in)</dt><dd>{done.email}</dd>
          <dt>Temporary password</dt><dd className="mono">{done.password}</dd>
        </dl>
        <div className="note info"><b>What happens next.</b> The company verifies their KYC and confirms their deposit. Their returns and your bonus start one month after the deposit is confirmed.</div>
      </div>
    </Drawer>
  );

  return (
    <Drawer title="Add investor" sub="Add someone you are bringing in, with the amount they are investing." onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={act.busy}>{act.busy ? 'Adding…' : 'Add investor'}</button></>}>
      <div className="form">
        <Field label="Full name *" err={e('full_name')}><input className={'input ' + (e('full_name') ? 'bad' : '')} value={f.full_name} onChange={set('full_name')} /></Field>
        <div className="f-row">
          <Field label="Email *" err={e('email')} hint="They sign in with this."><input className={'input ' + (e('email') ? 'bad' : '')} type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Phone *" err={e('phone')}><input className={'input ' + (e('phone') ? 'bad' : '')} value={f.phone} onChange={set('phone')} /></Field>
        </div>
        <div className="f-row">
          <Field label="City"><input className="input" value={f.city} onChange={set('city')} /></Field>
          <Field label="Temporary password *" err={e('password')} hint="Share it with them."><input className={'input mono ' + (e('password') ? 'bad' : '')} value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        </div>
        <Field label="Plan *" err={e('plan')}>
          <select className={'input ' + (e('plan') ? 'bad' : '')} value={f.plan} onChange={ev => setF({ ...f, plan: ev.target.value, lock: '' })}>
            <option value="">Choose a plan…</option>
            {d.plans.map(p => <option key={p.id} value={p.id}>{p.name}: {rateShort(p.investor_rate)} a month to them, {rateShort(p.bonus_rate)} to you</option>)}
          </select>
        </Field>
        <div className="f-row">
          <Field label="Lock-in *">
            <select className="input" value={lock} onChange={set('lock')} disabled={!plan}>
              {(plan?.lockin_options || []).slice().sort((a, b) => a - b).map(m => <option key={m} value={m}>{m === 12 ? '1 year (12 months)' : `${m} months`}</option>)}
            </select>
          </Field>
          <Field label="Amount *" err={e('amount')} hint={plan ? `${money(plan.min_amount)} to ${money(plan.max_amount)}` : undefined}>
            <input className={'input num ' + (e('amount') ? 'bad' : '')} inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="e.g. 500000" />
          </Field>
        </div>
        <Field label="Expected start date" hint="The date they will transfer the money. The company sets the final date when the deposit arrives.">
          <input className="input" type="date" value={f.start} onChange={set('start')} />
        </Field>
        {plan && amt > 0 && (
          <dl className="kv">
            <dt>Their monthly return</dt><dd>{money(r2(amt * plan.investor_rate / 100))} <span className="muted">({rateShort(plan.investor_rate)} a month)</span></dd>
            <dt>Your monthly bonus</dt><dd><b>{money(r2(amt * plan.bonus_rate / 100))}</b> <span className="muted">({rateShort(plan.bonus_rate)} a month)</span></dd>
          </dl>
        )}
        <div className="note">They see only their own investment and returns, never your bonus. The company verifies them and confirms the deposit before anything starts.</div>
      </div>
    </Drawer>
  );
}
