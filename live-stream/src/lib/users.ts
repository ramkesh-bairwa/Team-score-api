import { execute, queryOne } from './db';
import type { UserRole } from './auth';

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
}

export function findUserByEmail(email: string) {
  return queryOne<UserRow>(
    'SELECT id, name, email, password_hash, role FROM users WHERE email = ? LIMIT 1',
    [email],
  );
}

export function findUserById(id: number) {
  return queryOne<Omit<UserRow, 'password_hash'>>(
    'SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1',
    [id],
  );
}

export async function createUser(name: string, email: string, passwordHash: string): Promise<number> {
  const result = await execute('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [
    name,
    email,
    passwordHash,
  ]);
  return result.insertId;
}
