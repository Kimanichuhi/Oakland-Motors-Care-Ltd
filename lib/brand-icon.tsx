/** Renders the "OM" brand mark used across the app (loading screen, sidebar) as a
 * Satori-compatible element tree, so every generated PWA icon size stays visually
 * identical to public/icon.svg. Proportions are lifted directly from that SVG
 * (64px canvas, rx 16 outer / 9px inset, 46px rx 12 inner, 17px text). */
export function BrandIconMark({ size, rounded = true }: { size: number; rounded?: boolean }) {
  const innerSize = size * (46 / 64);
  const innerRadius = size * (12 / 64);
  const outerRadius = rounded ? size * (16 / 64) : 0;
  const fontSize = size * (17 / 64);
  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#10263f', borderRadius: outerRadius }}>
      <div style={{ width: innerSize, height: innerSize, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#b98a3d', borderRadius: innerRadius, color: 'white', fontSize, fontWeight: 700, fontFamily: 'Arial, sans-serif' }}>OM</div>
    </div>
  );
}
