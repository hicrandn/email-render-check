import type { ClientProfile } from '../types';

export const appleMail: ClientProfile = {
  id: 'apple-mail',
  device: 'desktop',
  name: 'Apple Mail (macOS)',
  engine: 'WebKit',
  vendorDocs: 'https://www.caniemail.com/',
  uaStylesheet: "body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;}",
  quirks: {},
  darkMode: {
    strategy: 'native',
    supportsOgscHack: false,
    note:
      'Apple Mail supports the color-scheme meta and ' +
      '@media (prefers-color-scheme: dark); it never force-inverts author colors.',
  },
};
