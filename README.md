# PMS Platform (browser-only)

A Super Admin dashboard and an Investor portal for monthly simple-interest plans (2%, 3.3% and 6%) with 6- and 12-month lock-ins, Tumkur and Bangalore branches, brochures and Parva Realty properties.

This version needs no backend, database service or keys. Everything runs in the browser:

- All records (plans, investors, investments, returns, payouts, announcements, branches, settings) are saved in the browser's localStorage.
- Uploaded files (brochures, documents, photos, logo) are saved in the same browser's IndexedDB, because localStorage is too small for files.
- Each browser keeps its own copy of the data. Clearing site data starts again from the initial setup.

## Sign in

Choose **Super Admin** or **Investor** on the sign-in page, then enter the email and password.

| Role | Email | Password |
|------|-------|----------|
| Super Admin | chaitra@parvarealty.ae | Parva@2026 |
| Investor (sample) | ananya.rao@example.com | Investor@2026 |

The Super Admin can add investors and other admins with a temporary password, and reset passwords from the investor's page.

## Run and deploy

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # output in dist/
```

On Vercel, import the repository with the Vite preset. No environment variables are needed.
