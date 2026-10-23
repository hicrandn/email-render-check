import type { ClientProfile } from '../types';

export const outlookMobile: ClientProfile = {
  id: 'outlook-mobile',
  device: 'mobile',
  name: 'Outlook (iOS/Android app)',
  engine: 'WebKit (iOS) / Android WebView with Microsoft CSS sanitization',
  vendorDocs: 'https://www.caniemail.com/',
  uaStylesheet: "body{font-family:-apple-system,Roboto,'Segoe UI',Arial,sans-serif;}",
  quirks: {},
  darkMode: {
    strategy: 'partial-invert',
    supportsOgscHack: true,
    note:
      'The Outlook apps darken light backgrounds and lighten dark text, marking what ' +
      'they changed with [data-ogsc]/[data-ogsb].',
  },
};
