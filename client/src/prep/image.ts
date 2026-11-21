import { PREP_LIMITS } from '@dnd/shared';
import { t, tx } from '../i18n.tsx';

const MAX_SIDE = 1600;

/**
 * Phone photos are huge. Shrink to at most 1600px and re-encode as JPEG so
 * handouts upload fast and load fast on everyone's phone.
 */
async function shrink(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file; // keep animations
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 400_000 && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ?? file;
  } catch {
    return file; // a format the browser can't decode: let the server decide
  }
}

/** Uploads a picture for a handout and returns its URL. Throws an Error with a message for the user. */
export async function uploadImage(campaignId: string, token: string, file: File): Promise<string> {
  const blob = await shrink(file);
  if (blob.size > PREP_LIMITS.imageMaxBytes) throw new Error(t('That picture is too big.'));
  const res = await fetch(`/api/campaigns/${campaignId}/images`, {
    method: 'POST',
    headers: { 'content-type': blob.type, authorization: `Bearer ${token}` },
    body: blob,
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ? tx(data.error) : t('Could not upload the picture.'));
  return data.url;
}
