import { ImageResponse } from 'next/server';
import { BrandIconMark } from '@/lib/brand-icon';

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(<BrandIconMark size={32} />, size);
}
