import type { ClientProfile } from '../types';

export const yahoo: ClientProfile = {
  id: 'yahoo',
  name: 'Yahoo! Mail (Desktop Webmail)',
  engine: 'Webmail (Blink) with Yahoo CSS sanitization',
  vendorDocs: 'https://www.caniemail.com/',
  uaStylesheet: "body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;}",
  quirks: {
    partialMediaQueries: true,
  },
  darkMode: {
    strategy: 'auto-invert',
    respectsColorSchemeMeta: false,
    respectsPrefersColorScheme: false, // limited/unreliable
    invertsUndeclaredColors: true,
    supportsOgscHack: false,
    note:
      'Yahoo! Mail auto-inverts undeclared colors and has limited, unreliable ' +
      '@media (prefers-color-scheme: dark) support, so author dark styles may not apply.',
  },
};
