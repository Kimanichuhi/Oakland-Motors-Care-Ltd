import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Oakland Motor Care Ltd Operations',
    short_name: 'Oakland Motor Care',
    description: 'Workshop operations management for Oakland Motor Care Ltd.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f6f8fa',
    theme_color: '#10263f',
    icons: [
      { src: '/favicon.png', sizes: '1254x1254', type: 'image/png', purpose: 'any' },
      { src: '/favicon.png', sizes: '1254x1254', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
