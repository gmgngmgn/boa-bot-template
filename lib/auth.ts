import { cookies } from 'next/headers';

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('auth-session');
  return authCookie?.value === 'authenticated';
}

export async function requireAuth() {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return false;
  }
  return true;
}

