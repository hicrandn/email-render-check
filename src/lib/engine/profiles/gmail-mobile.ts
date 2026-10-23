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
    strategy: 'full-invert',
    supportsOgscHack: false,
    note:
      'The Gmail apps recolor email in dark mode and ignore @media ' +
      '(prefers-color-scheme: dark): fully on iOS, partially on Android. The ' +
      'stronger iOS inversion is simulated.',
  },
};
