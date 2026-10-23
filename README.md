# PMS Platform (browser-only)

A Super Admin dashboard and an IB portal for monthly simple-interest investments (any monthly ROI, with or without a lock-in), Bangalore and Tumkur branches, brochures and Parva Realty properties.

This version needs no backend, database service or keys. Everything runs in the browser:

- All records (plans, investors, investments, returns, payouts, announcements, branches, settings) are saved in the browser's localStorage.
- Uploaded files (brochures, documents, photos, logo) are saved in the same browser's IndexedDB, because localStorage is too small for files.
- Each browser keeps its own copy of the data. Clearing site data starts again from the initial setup.

## Sign in

There are two logins. Choose **Super Admin** or **IB** on the sign-in page.

| Role | Signs in with | Password |
|------|---------------|----------|
| Super Admin | chaitra@parvarealty.ae | Parva@2026 |
| IB (sample) | 98450 10000 (Ananya Rao) | IB@Parva2026 |
| IB (sample) | 99860 20000 (Ravi Kumar) | IB@Parva2026 |
| IB (sample) | 99860 24111 (Priya Sharma) | IB@Parva2026 |

## How it works

- **Super Admin enters everything.** There is no investor login.
- **IBs** page → **Create IB**: name, phone number (the IB's login) and password. A person already on file can also be given an IB login from their page.
- **Record investment**: phone number, name, **Under IB** (or no IB), **monthly ROI %** (any rate, e.g. 0.25, 2.3, 4.3, 6), **IB bonus %** (taken out of the ROI: 6% with a 2% bonus = 4% to the investor + 2% to the IB), lock-in (no lock-in, 6, 12 or custom months), principal (INR) and start date. The person is found by phone number or added if new. Recording with an IB's own phone number records the IB's own investment.
- **IB login** (view only): their own investments and returns, the people under them with each person's investment, and the IB bonus they earn from each. An IB cannot add or change anything.
- The Super Admin pays the IB bonus from **IB Bonus** and investors' returns from **Payouts**.

## Run and deploy

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # output in dist/
```

On Vercel, import the repository with the Vite preset. No environment variables are needed.
