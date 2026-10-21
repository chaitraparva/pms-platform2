# PMS Platform (browser-only)

A Super Admin dashboard and an Investor portal for monthly simple-interest plans (2%, 3.3%, 4%, 5% and 6%) with 6- and 12-month lock-ins, Bangalore and Tumkur branches, brochures and Parva Realty properties.

This version needs no backend, database service or keys. Everything runs in the browser:

- All records (plans, investors, investments, returns, payouts, announcements, branches, settings) are saved in the browser's localStorage.
- Uploaded files (brochures, documents, photos, logo) are saved in the same browser's IndexedDB, because localStorage is too small for files.
- Each browser keeps its own copy of the data. Clearing site data starts again from the initial setup.

## Sign in

Choose **Super Admin** or **Investor** on the sign-in page, then enter the email and password.

| Role | Email | Password |
|------|-------|----------|
| Super Admin | chaitra@parvarealty.ae | Parva@2026 |
| Investor who can add investors | ananya.rao@example.com | Investor@2026 |
| Investor brought in by Ananya | rahul.menon@example.com | Investor@2026 |
| Super Admin (introducer) | ravi.kumar@example.com | Admin@2026 |
| Super Admin (introducer) | priya.sharma@example.com | Admin@2026 |
| Super Admin (introducer) | suresh.gowda@example.com | Admin@2026 |

The introducers are the admins who brought in the sample investors, so the admin bonus on those investments goes to them:
Chaitra → Ananya Rao · Ravi → Rahul Menon, Vikram Iyer, Kavya Reddy · Priya → Fatima Shaikh, Arjun Nair · Suresh → Meera Kapoor, Sana Qureshi.

The Super Admin can add investors and other admins with a temporary password, and reset passwords from the investor's page.

## Run and deploy

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # output in dist/
```

On Vercel, import the repository with the Vite preset. No environment variables are needed.

## Investors who bring in investors

The Super Admin can allow any investor to add investors (investor page → **Allow adding investors**).
That investor gets an **Add investor** button and a **My investors** section below their own investments:
the investors they brought in, those investors' investments, and the bonus they earn from them
(the bonus % the Super Admin sets on each plan under Investment Plans). People they add wait for the Super Admin to verify KYC
and confirm the deposit. The investors they bring in only ever see their own investment and returns.
The Super Admin sees who brought in whom on every investor and investment, and pays the bonus from **Introducer Bonus**.

