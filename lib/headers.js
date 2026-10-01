// Security headers sent with every response. vercel.json mirrors these for the
// Vercel deployment (a test keeps both in sync).

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    'frame-src https://www.google.com https://maps.google.com',
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};
