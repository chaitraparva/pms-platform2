import { FormEvent, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, friendly } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Logo } from '../shell/Shell';

export function Login() {
  const { session, profile, branding, needsMfa, ready } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<'signin' | 'reset' | 'mfa'>('signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [as, setAs] = useState<'super_admin' | 'investor'>('super_admin');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null);

  useEffect(() => { if (session && needsMfa) setMode('mfa'); }, [session, needsMfa]);

  if (ready && session && profile && !needsMfa) return <Navigate to={profile.role === 'super_admin' ? '/admin' : '/portal'} replace />;

  const signIn = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { data, error } = await api.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (!error && data.session) {
      // the chosen role must match the account, so an investor cannot land on the admin sign-in by mistake
      const { data: p } = await api.from('profiles').select('role').eq('id', data.session.user.id).maybeSingle();
      if (p && p.role !== as) {
        await api.auth.signOut(); setBusy(false);
        setMsg({ t: `This is ${p.role === 'super_admin' ? 'a Super Admin' : 'an Investor'} account. Choose “${p.role === 'super_admin' ? 'Super Admin' : 'Investor'}” above and sign in again.` });
        return;
      }
    }
    setBusy(false);
    if (error) setMsg({ t: /invalid/i.test(error.message) ? 'Email or password is incorrect.' : friendly(error.message) });
  };
  const sendReset = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    const who = branding?.support_email || 'your administrator';
    setMsg({ t: `Passwords are reset by the administrator. Email ${who} from your registered address and they will set a new temporary password for you.`, ok: true });
  };
  const verifyMfa = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const { data: f, error: fe } = await api.auth.mfa.listFactors();
      if (fe) throw fe;
      const factor = f.totp.find(x => x.status === 'verified');
      if (!factor) throw new Error('No authenticator is set up on this account.');
      const { error } = await api.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
      if (error) throw error;
      nav('/', { replace: true });
    } catch (err) {
      setMsg({ t: err instanceof Error ? (/invalid/i.test(err.message) ? 'That code is not valid. Try the current code.' : friendly(err.message)) : 'Could not verify.' });
    } finally { setBusy(false); }
  };

  const company = branding?.company_name || 'Investor Portal';
  return (
    <div className="login">
      <section className="login-l">
        <div className="brand" style={{ padding: 0 }}><Logo name={company} url={branding?.logo_url} /><div className="brand-txt"><b>{company}</b><small>Portfolio Management System</small></div></div>
        <div style={{ display: 'grid', gap: 14, marginTop: 40, position: 'relative', zIndex: 1 }}>
          <h1>{branding?.tagline || 'Every investment, return and maturity in one place.'}</h1>
          <p>Monthly simple-interest plans with contractual lock-ins, transparent accruals and confirmed payouts.</p>
        </div>
        <div className="hint" style={{ color: 'var(--on-navy-2)', position: 'relative', zIndex: 1 }}>{branding?.legal_footer}</div>
      </section>
      <section className="login-r">
        {mode === 'signin' && (
          <form className="login-box" onSubmit={signIn}>
            <div><h2>Sign in</h2><p className="hint" style={{ fontSize: 13.5, marginTop: 4 }}>Choose who you are, then use the email your administrator registered for you.</p></div>
            <div className="role-pick" role="radiogroup" aria-label="I am a">
              {(['super_admin', 'investor'] as const).map(r => (
                <button key={r} type="button" role="radio" aria-checked={as === r} className={'role ' + (as === r ? 'on' : '')} onClick={() => { setAs(r); setMsg(null); }}>
                  <b>{r === 'super_admin' ? 'Super Admin' : 'Investor'}</b><span>{r === 'super_admin' ? 'Plans, investors, payouts and settings' : 'Your investments, returns and statements'}</span>
                </button>
              ))}
            </div>
            <div className="field"><label htmlFor="em">Email</label><input className="input" id="em" type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div className="field"><label htmlFor="pw">Password</label><input className="input" id="pw" type="password" required autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><a style={{ cursor: 'pointer' }} onClick={() => { setMode('reset'); setMsg(null); }}>Forgot password?</a></div>
            {msg && <p className="hint" role="alert" style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
            <button className="btn primary" style={{ padding: 13 }} type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <div className="divider">Security</div>
            <p className="hint">Accounts are created by the administrator. You can change your password from Profile & Security.{branding?.support_email ? ` Need help? ${branding.support_email}` : ''}</p>
          </form>
        )}
        {mode === 'reset' && (
          <form className="login-box" onSubmit={sendReset}>
            <div><h2>Reset password</h2><p className="hint" style={{ fontSize: 13.5, marginTop: 4 }}>Your administrator sets a new temporary password for you.</p></div>
            <div className="field"><label htmlFor="em2">Email</label><input className="input" id="em2" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
            {msg && <p className="hint" role="status" style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.t}</p>}
            <button className="btn primary" style={{ padding: 13 }} type="submit" disabled={busy}>How do I reset it?</button>
            <a style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => { setMode('signin'); setMsg(null); }}>Back to sign in</a>
          </form>
        )}
        {mode === 'mfa' && (
          <form className="login-box" onSubmit={verifyMfa}>
            <div><h2>Two-factor check</h2><p className="hint" style={{ fontSize: 13.5, marginTop: 4 }}>Enter the 6-digit code from your authenticator app.</p></div>
            <div className="field"><label htmlFor="otp">Code</label><input className="input mono" id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            {msg && <p className="hint" role="alert" style={{ color: 'var(--red)' }}>{msg.t}</p>}
            <button className="btn primary" style={{ padding: 13 }} type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify'}</button>
            <a style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => api.auth.signOut()}>Use a different account</a>
          </form>
        )}
      </section>
    </div>
  );
}
