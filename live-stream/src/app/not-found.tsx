import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-zinc-400">This stream doesn’t exist or the link is wrong.</p>
      <Link href="/" className="mt-6 inline-block rounded-lg bg-white/10 px-4 py-2 font-semibold hover:bg-white/20">
        Go home
      </Link>
    </div>
  );
}
