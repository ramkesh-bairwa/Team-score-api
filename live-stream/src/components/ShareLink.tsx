'use client';

import { useEffect, useState } from 'react';
import { withBase } from '@/lib/paths';

export default function ShareLink({ roomId, title }: { roomId: string; title: string }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  // Browser-only values are read after mount so server and client render the same HTML.
  // Uses the address the broadcaster actually opened, so LAN/tunnel URLs work too.
  useEffect(() => {
    setUrl(`${window.location.origin}${withBase(`/live/${roomId}`)}`);
    setCanShare(typeof navigator.share === 'function');
  }, [roomId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = () => navigator.share?.({ title, url }).catch(() => {});

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900 p-4">
      <p className="text-sm font-medium text-zinc-300">Viewer link</p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300"
        />
        <button onClick={copy} className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-200">
          {copied ? 'Copied!' : 'Copy'}
        </button>
        {canShare && (
          <button onClick={share} className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20">
            Share
          </button>
        )}
      </div>
    </div>
  );
}
