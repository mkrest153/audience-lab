// Signing out: tell the server, then drop the token here either way.
import { saveToken } from './store.js';
import { auth } from './http.js';

export async function logout() {
  try { await auth('/api/auth/logout'); } catch (e) { /* the token is dropped here either way */ }
  saveToken(null);
}
