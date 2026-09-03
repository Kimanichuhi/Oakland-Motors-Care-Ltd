import { ImageResponse } from 'next/server';
import { BrandIconMark } from '@/lib/brand-icon';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOS applies its own corner mask to home-screen icons, so this is left unrounded
// and edge-to-edge (no rounding, no transparency) per Apple's touch-icon guidance.
export default function AppleIcon() {
  return new ImageResponse(<BrandIconMark size={180} rounded={false} />, size);
}
