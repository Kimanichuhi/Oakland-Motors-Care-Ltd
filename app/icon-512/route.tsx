import { ImageResponse } from 'next/server';
import { BrandIconMark } from '@/lib/brand-icon';

export const runtime = 'edge';

// See app/icon-192/route.tsx — same reasoning, 512x512 for the manifest.
export async function GET() {
  return new ImageResponse(<BrandIconMark size={512} />, { width: 512, height: 512 });
}
