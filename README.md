# PMS Platform (browser-only)

A Super Admin dashboard and an IB portal for monthly simple-interest investments (any monthly ROI, with or without a lock-in), Bangalore and Tumkur branches, brochures and Parva Realty properties.

This version needs no backend, database service or keys. Everything runs in the browser:

- All records (plans, investors, investments, returns, payouts, announcements, branches, settings) are saved in the browser's localStorage.
- Uploaded files (brochures, documents, photos, logo) are saved in the same browser's IndexedDB, because localStorage is too small for files.
- Each browser keeps its own copy of the data. Clearing site data starts again from the initial setup.

## Sign in

There are two logins. Choose **Super Admin** or **Investor** on the sign-in page. Investors sign in with their phone number.

| Role | Signs in with | Password |
|------|---------------|----------|
| Super Admin | chaitra@parvarealty.ae | Parva@2026 |
| Investor (sample) | 98450 10000 (Ananya Rao, has people under her) | Investor@2026 |
| Investor (sample) | 98450 11373 (Rahul Menon, under Ananya) | Investor@2026 |

Every sample investor uses the password Investor@2026 with their own phone number.

## How it works

- **Super Admin enters everything.** **Record investment**: phone number, name, **Individual** or **Under an investor** (any investor can be chosen), monthly ROI % (any rate), bonus % for the investor they are under (taken out of the ROI: 6% with a 2% bonus = 4% to the investor + 2% bonus), lock-in (none, 6, 12 or custom months), principal and start date. A new person gets their login (phone number + the password shown in the form).
- **Investor login**: their own investments and returns, the people under them with each person's investment and the bonus they earn (shown as soon as the person is recorded), withdrawals, queries, announcements.
- **Withdraw**: the investor applies for an amount (cash or bank transfer). It is taken automatically from their highest monthly ROI first, whatever the lock-in. From the request date, returns are calculated on the lower amount (the month in which it happens is split by days). It shows **Pending** until the Super Admin pays and clicks **Mark completed** under Withdrawals.
- **Ask a query**: the investor writes, the Super Admin answers under Queries, the investor sees the answer and gets a notification.
- **Announcements** pop up once on the investor's home page after sign-in and stay under Notifications and Announcements.

## Run and deploy

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # output in dist/
```

On Vercel, import the repository with the Vite preset. No environment variables are needed.
