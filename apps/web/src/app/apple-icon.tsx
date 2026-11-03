import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Home-screen icon for iOS; same mark as icon.svg, full-bleed because iOS rounds the corners itself. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}>
        <svg width="180" height="180" viewBox="0 0 64 64">
          <path d="M23 46V19h19M23 32.5h13" fill="none" stroke="#fff" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="43" cy="44" r="4.75" fill="#fff" />
        </svg>
      </div>
    ),
    size,
  );
}
