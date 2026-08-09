import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Oakland Motors Operations',
    short_name: 'Oakland Motors',
    description: 'Workshop operations management for Oakland Motors.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f8fa',
    theme_color: '#10263f',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
