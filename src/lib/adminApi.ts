import { friendly } from './api';
import { adminResetPassword, createAccount, ready } from './localdb';

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
