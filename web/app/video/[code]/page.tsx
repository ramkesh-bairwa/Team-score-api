'use client';
import { useParams } from 'next/navigation';
import MatchVideoScreen from '@/screens/MatchVideoScreen';
import { screenPage } from '@/lib/screenPage';

// The match code comes from the URL (/video/ABC123), so the page also works when opened directly.
// A title saved for a different match (e.g. an older link) is dropped.
export default screenPage<{ code: string; title?: string }>('MatchVideo', MatchVideoScreen, (stored) => {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(String(params?.code ?? ''));
  return stored?.code === code ? { code } : { code, title: undefined };
});
