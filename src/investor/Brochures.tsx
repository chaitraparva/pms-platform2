// Brochures published by the company: shown once after sign-in until the investor
// closes them (acknowledged in the database), and listed under Latest announcements.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { rpc } from '../lib/api';
import { refreshAll, useQuery } from '../lib/useQuery';
import { brochureUrl, openBrochure } from '../lib/docs';
import { date } from '../lib/format';
import { Modal, useAction } from '../ui/kit';
import { Icon } from '../ui/Icon';
import type { MyBrochure } from '../lib/types';

export const loadMyBrochures = () => rpc<MyBrochure[]>('my_brochures').then(r => r || []);

/** The file itself: PDFs in a frame, images inline, both through a short-lived signed link. */
export function BrochureFile({ b }: { b: Pick<MyBrochure, 'storage_path' | 'mime' | 'title'> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    brochureUrl(b.storage_path).then(u => { if (alive) setUrl(u); }).catch(e => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [b.storage_path]);
  if (err) return <p className="hint" style={{ color: 'var(--red)' }}>{err}</p>;
  if (!url) return <div className="skel" style={{ height: 320 }} />;
  return b.mime === 'application/pdf'
    ? <iframe className="bro-frame" src={url} title={b.title} />
    : <img className="bro-img" src={url} alt={b.title} />;
}

export function BrochureModal({ b, onClose }: { b: MyBrochure; onClose: () => void }) {
  const act = useAction();
  const close = async () => {
    try { await rpc('mark_brochure_seen', { p_id: b.id, p_acknowledge: true }); refreshAll(); } catch { /* it will simply show again next time */ }
    onClose();
  };
  return (
    <Modal wide title={b.title} onClose={close}
      sub={<>{b.plan_name ? b.plan_name + ' · ' : ''}Published {date(b.publish_on)}{b.ends_on ? ' · valid until ' + date(b.ends_on) : ''}</>}
      foot={<>
        <button className="btn" onClick={() => act.run(() => openBrochure(b.storage_path))} disabled={act.busy}><Icon name="download" />Open full brochure</button>
        <button className="btn primary" onClick={close}>Close</button>
      </>}>
      {b.description && <p style={{ color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>{b.description}</p>}
      <BrochureFile b={b} />
    </Modal>
  );
}

/**
 * Shows the latest published brochure the investor has not closed yet, once per sign-in,
 * or the one named in ?brochure=<id> (links from notifications and the overview).
 */
export function BrochureGate() {
  const [sp, setSp] = useSearchParams();
  const q = useQuery(loadMyBrochures, []);
  const [shown, setShown] = useState<MyBrochure | null>(null);
  const [autoDone, setAutoDone] = useState(false);
  const want = sp.get('brochure');

  useEffect(() => {
    if (!q.data) return;
    if (want) {
      const b = q.data.find(x => x.id === want);
      if (b) setShown(b);
      const next = new URLSearchParams(sp); next.delete('brochure'); setSp(next, { replace: true });
      return;
    }
    if (!autoDone) {
      setAutoDone(true);
      const latest = q.data.find(x => !x.acknowledged);
      if (latest) {
        setShown(latest);
        rpc('mark_brochure_seen', { p_id: latest.id, p_acknowledge: false }).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, want]);

  return shown ? <BrochureModal b={shown} onClose={() => setShown(null)} /> : null;
}
