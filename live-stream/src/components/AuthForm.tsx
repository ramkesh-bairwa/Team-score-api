'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { withBase } from '@/lib/paths';

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Only allow redirects back into this app
  const next = params.get('next');
  const redirectTo = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch(withBase(`/api/auth/${mode}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  const isRegister = mode === 'register';
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">{isRegister ? 'Create your account' : 'Welcome back'}</h1>
      <p className="mt-1 text-sm text-zinc-400">
        {isRegister ? 'Start broadcasting in under a minute.' : 'Log in to manage your streams.'}
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {isRegister && <Field label="Name" name="name" autoComplete="name" minLength={2} maxLength={100} />}
        <Field label="Email" name="email" type="email" autoComplete="email" maxLength={255} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          minLength={isRegister ? 8 : 1}
          maxLength={128}
        />
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-red-600 py-2.5 font-semibold hover:bg-red-500 disabled:opacity-60"
        >
          {pending ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-400">
        {isRegister ? 'Already have an account? ' : 'New here? '}
        <Link href={isRegister ? '/login' : '/register'} className="font-medium text-white underline-offset-4 hover:underline">
          {isRegister ? 'Log in' : 'Create an account'}
        </Link>
      </p>
    </div>
  );
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-300">{label}</span>
      <input
        required
        {...props}
        className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2.5 text-white outline-none placeholder:text-zinc-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
      />
    </label>
  );
}
