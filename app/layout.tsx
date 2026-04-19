// app/layout.tsx — Sharpline root layout (M6)
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sharpline',
  description: 'MLB betting model — single operator',
};

const navStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  background: '#111',
  padding: '0.6rem 1.5rem',
  display: 'flex',
  gap: '1.5rem',
  alignItems: 'center',
  borderBottom: '1px solid #333',
};

const navLinkStyle: React.CSSProperties = {
  color: '#aaa',
  textDecoration: 'none',
  fontSize: '0.85rem',
  letterSpacing: '0.05em',
};

const logoStyle: React.CSSProperties = {
  color: '#fff',
  fontWeight: 'bold',
  fontSize: '1rem',
  textDecoration: 'none',
  marginRight: '1rem',
  letterSpacing: '0.1em',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0d0d0d', color: '#e0e0e0', fontFamily: 'monospace' }}>
        <nav style={navStyle}>
          <a href="/" style={logoStyle}>SHARPLINE</a>
          <a href="/" style={navLinkStyle}>GAMES</a>
          <a href="/bets" style={navLinkStyle}>BETS</a>
          <a href="/performance" style={navLinkStyle}>PERFORMANCE</a>
          <a href="/admin" style={navLinkStyle}>ADMIN</a>
        </nav>
        <main style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
