// Web replacement for React Native's Share.share: the system share sheet where the browser has one
// (phones), otherwise the text is copied to the clipboard.
import { popup } from '@/components/Popup';

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
};

export const shareText = async (message: string, url?: string, title = 'CricScore') => {
  if (typeof navigator !== 'undefined' && navigator.share && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
    try {
      await navigator.share(url ? { title, text: message, url } : { title, text: message });
      return;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }
  const ok = await copyText(message);
  popup.show({
    type: ok ? 'success' : 'info',
    title: ok ? 'Copied to clipboard' : 'Copy this',
    message: ok ? 'Paste it in WhatsApp or anywhere to share.' : message,
  });
};

// Opens a link in a new tab (Linking.openURL)
export const openUrl = (url: string) => {
  window.open(url, '_blank', 'noopener');
};
