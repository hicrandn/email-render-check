import type { ClientProfile } from '../types';

export const appleMail: ClientProfile = {
  id: 'apple-mail',
  name: 'Apple Mail (macOS)',
  engine: 'WebKit',
  vendorDocs: 'https://www.caniemail.com/',
  uaStylesheet: "body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;}",
  quirks: {},
  darkMode: {
    strategy: 'native',
    respectsColorSchemeMeta: true,
    respectsPrefersColorScheme: true,
    invertsUndeclaredColors: false,
    supportsOgscHack: false,
    note:
      'Apple Mail fully supports color-scheme meta and ' +
      '@media (prefers-color-scheme: dark); it never force-inverts author colors.',
  },
};
