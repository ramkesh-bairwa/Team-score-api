import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';
import { getAccountSession } from '@/lib/session';

export default async function LoginPage() {
  if (await getAccountSession()) redirect('/dashboard');
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
