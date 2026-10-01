'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { withBase } from '@/lib/paths';

export default function CreateLiveForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch(withBase('/api/rooms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create the room');
      router.push(`/live/${data.roomId}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-zinc-300">Stream title</span>
        <input
          name="title"
          required
          minLength={3}
          maxLength={150}
          placeholder="Friday night Q&A"
          className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2.5 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-zinc-300">
          Description <span className="text-zinc-500">(optional)</span>
        </span>
        <textarea
          name="description"
          rows={3}
          maxLength={1000}
          placeholder="What's this stream about?"
          className="w-full resize-none rounded-lg border border-white/10 bg-zinc-900 px-3 py-2.5 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
        />
      </label>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-red-600 py-2.5 font-semibold hover:bg-red-500 disabled:opacity-60 sm:w-auto sm:px-6"
      >
        {pending ? 'Creating…' : 'Create room & open studio'}
      </button>
    </form>
  );
}
