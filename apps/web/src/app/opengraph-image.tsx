import { ImageResponse } from 'next/og';

export const alt = 'FG One — the Futurist Global workspace';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Link-preview card shown when an FG One URL is shared (Google Chat, Slack, WhatsApp...). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 80, color: '#fff', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <svg width="120" height="120" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="15" fill="#fff" fillOpacity="0.16" />
            <path d="M23 46V19h19M23 32.5h13" fill="none" stroke="#fff" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="43" cy="44" r="4.75" fill="#fff" />
          </svg>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>FG One</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>Chat, people and HR in one place.</div>
          <div style={{ fontSize: 34, opacity: 0.85 }}>The Futurist Global employee workspace</div>
        </div>
      </div>
    ),
    size,
  );
}
