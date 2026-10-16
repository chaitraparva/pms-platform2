import { Route, Routes, useNavigate } from 'react-router-dom';
import { Shell, NavItem } from '../shell/Shell';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useQuery } from '../lib/useQuery';
import { ProfileSecurity } from '../pages/ProfileSecurity';
import { Notifications } from '../pages/Notifications';
import { Overview } from './Overview';
import { Investments, InvestmentDetail } from './Investments';
import { Returns } from './Returns';
import { LockIn } from './LockIn';
import { Transactions } from './Transactions';
import { Properties } from './Properties';
import { BrochureGate } from './Brochures';
import { Documents } from './Documents';
import { Statement } from './Statement';
import { Announcements } from './Announcements';

export default function PortalApp() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const counts = useQuery(async () => {
    const base = () => api.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', profile!.id).is('read_at', null);
    const [all, ann] = await Promise.all([base(), base().in('kind', ['announcement', 'brochure'])]);
    return { notifications: all.count || 0, announcements: ann.count || 0 };
  }, [profile?.id]);
  const items: NavItem[] = [
    { group: 'Portfolio' }, { to: '/portal', label: 'Overview', icon: 'home' }, { to: '/portal/investments', label: 'My Investments', icon: 'invest' },
    { to: '/portal/returns', label: 'Monthly Returns', icon: 'roi' }, { to: '/portal/lock-in', label: 'Lock-in & Maturity', icon: 'lock' },
    { to: '/portal/properties', label: 'Explore Properties', icon: 'building' },
    { group: 'Money' }, { to: '/portal/transactions', label: 'Transactions', icon: 'txn' },
    { to: '/portal/documents', label: 'Statements & Documents', icon: 'doc' },
    { group: 'Updates' }, { to: '/portal/announcements', label: 'Announcements', icon: 'announce', count: counts.data?.announcements },
    { to: '/portal/notifications', label: 'Notifications', icon: 'bell', count: counts.data?.notifications },
    { group: 'Account' }, { to: '/portal/profile', label: 'Profile & Security', icon: 'user' }
  ];
  return (
    <>
    <Routes>
      <Route element={<Shell base="/portal" roleLabel="Investor portal" nav={items} searchPh="Search my investments and transactions" onSearch={q => nav('/portal/transactions?q=' + encodeURIComponent(q))} />}>
        <Route index element={<Overview />} />
        <Route path="investments" element={<Investments />} />
        <Route path="investments/:code" element={<InvestmentDetail />} />
        <Route path="returns" element={<Returns />} />
        <Route path="lock-in" element={<LockIn />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="properties" element={<Properties />} />
        <Route path="documents" element={<Documents />} />
        <Route path="statement" element={<Statement />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<ProfileSecurity />} />
        <Route path="*" element={<Overview />} />
      </Route>
    </Routes>
    <BrochureGate />
    </>
  );
}
