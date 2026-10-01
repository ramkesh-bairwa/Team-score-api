import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ user: session ? { id: session.userId, name: session.name } : null });
}
