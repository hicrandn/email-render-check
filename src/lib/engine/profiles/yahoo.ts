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
    strategy: 'none',
    supportsOgscHack: false,
    note:
      'Yahoo! Mail on the web only darkens its own interface; email keeps its colors.',
  },
};
