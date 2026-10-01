import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';
import { getAccountSession } from '@/lib/session';

export default async function RegisterPage() {
  if (await getAccountSession()) redirect('/dashboard');
  return (
    <Suspense>
      <AuthForm mode="register" />
    </Suspense>
  );
}
