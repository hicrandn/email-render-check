import type { ClientProfile } from '../types';

export const yahoo: ClientProfile = {
  id: 'yahoo',
  device: 'desktop',
  name: 'Yahoo! Mail (Desktop Webmail)',
  engine: 'Webmail (Blink) with Yahoo CSS sanitization',
  vendorDocs: 'https://www.caniemail.com/',
  uaStylesheet: "body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;}",
  quirks: {},
  darkMode: {
    strategy: 'auto-invert',
    supportsOgscHack: false,
    note:
      'Yahoo! Mail ignores @media (prefers-color-scheme: dark) and auto-inverts ' +
      'undeclared colors.',
  },
};
