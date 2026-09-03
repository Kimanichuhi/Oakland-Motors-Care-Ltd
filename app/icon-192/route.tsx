import { ImageResponse } from 'next/server';
import { BrandIconMark } from '@/lib/brand-icon';

export const runtime = 'edge';

// Served at a stable /icon-192 URL (not the icon.tsx/apple-icon.tsx conventions,
// which are meant for a single favicon/touch-icon) so app/manifest.ts can list an
// exact 192x192 PNG for Android/desktop install prompts and splash screens.
export async function GET() {
  return new ImageResponse(<BrandIconMark size={192} />, { width: 192, height: 192 });
}
