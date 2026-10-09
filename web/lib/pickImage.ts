// Web replacement for react-native-image-picker: opens the file chooser (or the camera on phones).
// Resolves null if the user cancels. `uri` is a data: URL, usable directly in <img src>.
export type PickedImage = { uri: string; base64: string; width: number; height: number };

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('Could not read the photo'));
  r.readAsDataURL(file);
});

// Downscales big photos (like the app's maxWidth/maxHeight + quality options) to keep storage small
const resize = (dataUrl: string, max: number, quality: number) => new Promise<PickedImage>((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * k), h = Math.round(img.height * k);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const uri = canvas.toDataURL('image/jpeg', quality);
    resolve({ uri, base64: uri.split(',')[1], width: w, height: h });
  };
  img.onerror = () => reject(new Error('This file is not an image'));
  img.src = dataUrl;
});

export const pickImage = (opts: { camera?: boolean; front?: boolean; maxSize?: number; quality?: number } = {}) =>
  new Promise<PickedImage | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (opts.camera) input.setAttribute('capture', opts.front ? 'user' : 'environment');
    input.style.display = 'none';
    let done = false;
    input.onchange = async () => {
      done = true;
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      try {
        resolve(await resize(await readAsDataUrl(file), opts.maxSize ?? 900, opts.quality ?? 0.8));
      } catch (e) { reject(e); }
    };
    // Cancelling the chooser fires no change event; treat returning focus to the page as cancel
    window.addEventListener('focus', () => setTimeout(() => { if (!done) { input.remove(); resolve(null); } }, 800), { once: true });
    document.body.appendChild(input);
    input.click();
  });
