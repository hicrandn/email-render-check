import type { ClientProfile } from '../types';

export const yahooMobile: ClientProfile = {
  id: 'yahoo-mobile',
  device: 'mobile',
  name: 'Yahoo! Mail (iOS/Android app)',
  engine: 'WebKit (iOS) / Android WebView with Yahoo CSS sanitization',
  vendorDocs: 'https://www.caniemail.com/',
  uaStylesheet: "body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;}",
  quirks: {},
  darkMode: {
    strategy: 'auto-invert',
    supportsOgscHack: false,
    note:
      'The Yahoo! Mail apps ignore @media (prefers-color-scheme: dark) and ' +
      'auto-invert undeclared colors.',
  },
};
