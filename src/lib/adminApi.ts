import { friendly } from './api';
import { adminResetPassword, adminRecordInvestment, createAccount, createIB, ready } from './localdb';

export interface NewUser {
  email: string;
  full_name: string;
  role: 'investor' | 'super_admin';
  /** password: the administrator sets a temporary password now and shares it with the person. */
  mode: 'invite' | 'password';
  password?: string;
  phone?: string;
  city?: string;
  address?: string;
  id_number_masked?: string;
  bank_name?: string;
  bank_account_masked?: string;
  bank_ifsc?: string;
  /** Investors: the admin who brought them in (gets the admin bonus). Defaults to the admin creating the account. */
  introduced_by?: string | null;
}

/** Creates a login with a temporary password (stored on this device, never shown again). */
export async function createUser(u: NewUser): Promise<{ id: string; code: string }> {
  await ready();
  try { return await createAccount({ ...u }); } catch (e) { throw new Error(friendly((e as Error).message)); }
}

/** Sets a new temporary password for an existing user. */
export async function resetUserPassword(userId: string, password: string): Promise<boolean> {
  await ready();
  try { await adminResetPassword(userId, password); return true; } catch (e) { throw new Error(friendly((e as Error).message)); }
}

export interface NewIB { full_name?: string; phone: string; password: string; email?: string; city?: string; branch_id?: string | null; person_id?: string }
/** Creates an IB login (phone number + password), or gives an existing person an IB login. */
export async function createIbLogin(u: NewIB): Promise<{ id: string; code: string }> {
  await ready();
  try { return await createIB({ ...u }); } catch (e) { throw new Error(friendly((e as Error).message)); }
}

/** Record investment: finds the person by phone (or adds them with a login) and records the investment. */
export async function recordInvestmentFull(a: Record<string, unknown>): Promise<{ id: string; code: string; investor: string }> {
  await ready();
  try { return await adminRecordInvestment({ ...a }); } catch (e) { throw new Error(friendly((e as Error).message)); }
}
