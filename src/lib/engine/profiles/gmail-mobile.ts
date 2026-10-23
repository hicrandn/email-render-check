import type { ClientProfile } from '../types';

export const gmailMobile: ClientProfile = {
  id: 'gmail-mobile',
  device: 'mobile',
  name: 'Gmail (iOS/Android app)',
  engine: 'WebKit (iOS) / Android WebView with server-side sanitization',
  vendorDocs: 'https://developers.google.com/gmail/design/reference/supported_css',
  uaStylesheet: 'body{font-family:Arial,Helvetica,sans-serif;}',
  quirks: {
    maxSizeKB: 102, // the apps clip at the same size as webmail
  },
  darkMode: {
    strategy: 'auto-invert',
    supportsOgscHack: false,
    note:
      'The Gmail apps ignore @media (prefers-color-scheme: dark) and invert ' +
      'colors on their own.',
  },
};
