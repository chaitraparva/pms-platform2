import { Route, Routes, useNavigate } from 'react-router-dom';
import { Shell, NavItem } from '../shell/Shell';
import { api } from '../lib/api';
import { useQuery } from '../lib/useQuery';
import { ProfileSecurity } from '../pages/ProfileSecurity';
import { Notifications } from '../pages/Notifications';
import { Overview } from './Overview';
import { Investors, InvestorDetail } from './Investors';
import { Plans, PlanDetail } from './Plans';
import { Investments, InvestmentDetail } from './Investments';
import { Accruals } from './Accruals';
import { Payouts } from './Payouts';
import { Branches, BranchDetail } from './Branches';
import { Brochures } from './Brochures';
import { Properties } from './Properties';
import { Transactions } from './Transactions';
import { Announcements } from './Announcements';
import { Reports } from './Reports';
import { Audit } from './Audit';
import { Settings } from './Settings';
import { Search } from './Search';
import { Ranking } from './Ranking';

export default function AdminApp() {
  const nav = useNavigate();
  const counts = useQuery(async () => {
    const p = await api.from('payouts').select('id', { count: 'exact', head: true }).in('status', ['approved', 'processing', 'failed']);
    return { payouts: p.count || 0 };
  }, []);
  const items: NavItem[] = [
    { group: 'Dashboard' }, { to: '/admin', label: 'Overview', icon: 'home' },
    { to: '/admin/branches', label: 'Branches', icon: 'branch' }, { to: '/admin/ranking', label: 'Investor Ranking', icon: 'rank' },
    { group: 'Manage' }, { to: '/admin/investors', label: 'Investors', icon: 'users' }, { to: '/admin/plans', label: 'Investment Plans', icon: 'plans' },
    { to: '/admin/investments', label: 'Investments', icon: 'invest' },
    { to: '/admin/payouts', label: 'Payouts', icon: 'payout', count: counts.data?.payouts },
    { group: 'Communicate & control' }, { to: '/admin/announcements', label: 'Announcements', icon: 'announce' },
    { to: '/admin/brochures', label: 'Brochures', icon: 'brochure' }, { to: '/admin/properties', label: 'Parva Properties', icon: 'building' }, 
    { to: '/admin/settings', label: 'Settings', icon: 'settings' }
  ];
  return (
    <Routes>
      <Route element={<Shell base="/admin" roleLabel="Super Admin" nav={items} searchPh="Search investors, investments, transactions" onSearch={q => nav('/admin/search?q=' + encodeURIComponent(q))} />}>
        <Route index element={<Overview />} />
        <Route path="investors" element={<Investors />} />
        <Route path="investors/:code" element={<InvestorDetail />} />
        <Route path="plans" element={<Plans />} />
        <Route path="plans/:code" element={<PlanDetail />} />
        <Route path="investments" element={<Investments />} />
        <Route path="investments/:code" element={<InvestmentDetail />} />
        <Route path="accruals" element={<Accruals />} />
        <Route path="payouts" element={<Payouts />} />
        <Route path="branches" element={<Branches />} />
        <Route path="ranking" element={<Ranking />} />
        <Route path="branches/:code" element={<BranchDetail />} />
        <Route path="brochures" element={<Brochures />} />
        <Route path="properties" element={<Properties />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="reports" element={<Reports />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<Settings />} />
        <Route path="search" element={<Search />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<ProfileSecurity />} />
        <Route path="*" element={<Overview />} />
      </Route>
    </Routes>
  );
}
