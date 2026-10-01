import Link from 'next/link';
import { getAccountSession } from '@/lib/session';
import LogoutButton from './LogoutButton';

export default async function Navbar() {
  const session = await getAccountSession();
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> LiveStream
        </Link>
        <div className="flex items-center gap-2 text-sm">
          {session ? (
            <>
              <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-zinc-300 hover:bg-white/10 hover:text-white">
                Dashboard
              </Link>
              <Link href="/create-live" className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold hover:bg-red-500">
                Go live
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-lg px-3 py-1.5 text-zinc-300 hover:bg-white/10 hover:text-white">
                Log in
              </Link>
              <Link href="/register" className="rounded-lg bg-white px-3 py-1.5 font-semibold text-zinc-900 hover:bg-zinc-200">
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
