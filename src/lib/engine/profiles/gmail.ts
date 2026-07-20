import type { ClientProfile } from '../types';

export const gmail: ClientProfile = {
  id: 'gmail',
  name: 'Gmail (Desktop Webmail)',
  engine: 'Blink (Chromium) with server-side sanitization',
  vendorDocs: 'https://developers.google.com/gmail/design/reference/supported_css',
  uaStylesheet: 'body{font-family:Arial,Helvetica,sans-serif;}',
  quirks: {
    maxSizeKB: 102, // Gmail clips messages larger than ~102 KB.
    partialMediaQueries: true,
  },
  darkMode: {
    strategy: 'auto-invert',
    respectsColorSchemeMeta: false,
    respectsPrefersColorScheme: true, // inconsistent across builds
    invertsUndeclaredColors: true,
    supportsOgscHack: true, // [data-ogsc]/[data-ogsb] works in many builds
    note:
      'Gmail applies partial, inconsistent dark-mode handling: it honors some ' +
      '@media (prefers-color-scheme: dark) rules but auto-inverts undeclared ' +
      'colors on many surfaces. [data-ogsc]/[data-ogsb] targeting works in most builds.',
  },
};
