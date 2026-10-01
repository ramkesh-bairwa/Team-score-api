import { redirect } from 'next/navigation';
import CreateLiveForm from '@/components/CreateLiveForm';
import { getAccountSession } from '@/lib/session';

export default async function CreateLivePage() {
  if (!(await getAccountSession())) redirect('/login?next=/create-live');
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold">Create a live stream</h1>
      <p className="mt-1 text-sm text-zinc-400">
        You’ll get a private studio with a camera preview and a link to share. Nothing is broadcast until you press
        Go live.
      </p>
      <div className="mt-8">
        <CreateLiveForm />
      </div>
    </div>
  );
}
