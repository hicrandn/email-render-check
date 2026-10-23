import type { ClientProfile } from '../types';

export const appleMailIos: ClientProfile = {
  id: 'apple-mail-ios',
  device: 'mobile',
  name: 'Apple Mail (iOS)',
  engine: 'WebKit',
  vendorDocs: 'https://www.caniemail.com/',
  uaStylesheet: "body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;}",
  quirks: {},
  darkMode: {
    strategy: 'native',
    supportsOgscHack: false,
    note:
      'Mail on iOS supports @media (prefers-color-scheme: dark) and never ' +
      'force-inverts author colors.',
  },
};
