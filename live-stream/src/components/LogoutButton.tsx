'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { withBase } from '@/lib/paths';

export default function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch(withBase('/api/auth/logout'), { method: 'POST' });
        router.push('/');
        router.refresh();
      }}
      className="rounded-lg px-3 py-1.5 text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
    >
      Log out
    </button>
  );
}
