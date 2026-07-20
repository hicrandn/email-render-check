import type { ClientProfile } from '../types';

export const outlookCom: ClientProfile = {
  id: 'outlook-com',
  name: 'Outlook.com',
  engine: 'Webmail (Blink) with Microsoft CSS sanitization',
  vendorDocs: 'https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/aa338201(v=office.12)',
  uaStylesheet: "body{font-family:'Segoe UI',Arial,sans-serif;}\ntable{border-collapse:collapse;}",
  quirks: {
    partialMediaQueries: true,
  },
  darkMode: {
    strategy: 'partial',
    respectsColorSchemeMeta: true,
    respectsPrefersColorScheme: true,
    invertsUndeclaredColors: false,
    supportsOgscHack: false,
    note:
      'Outlook.com honors @media (prefers-color-scheme: dark) and color-scheme ' +
      'meta, but rewrites some colors on its own; it does not blanket-invert.',
  },
};
