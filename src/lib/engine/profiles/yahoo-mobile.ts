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
    strategy: 'none',
    supportsOgscHack: false,
    note:
      'The Yahoo! Mail apps are reported to leave email colors alone in dark mode ' +
      '(sources disagree; test on a device).',
  },
};
