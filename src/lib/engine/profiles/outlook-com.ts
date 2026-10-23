import type { ClientProfile } from '../types';

export const outlookCom: ClientProfile = {
  id: 'outlook-com',
  name: 'Outlook.com',
  engine: 'Webmail (Blink) with Microsoft CSS sanitization',
  vendorDocs: 'https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/aa338201(v=office.12)',
  uaStylesheet: "body{font-family:'Segoe UI',Arial,sans-serif;}\ntable{border-collapse:collapse;}",
  quirks: {},
  darkMode: {
    strategy: 'partial',
    supportsOgscHack: true,
    note:
      'Outlook.com honors @media (prefers-color-scheme: dark) but not the ' +
      'color-scheme meta. It rewrites some colors on its own and marks them with ' +
      '[data-ogsc]/[data-ogsb]; it does not blanket-invert.',
  },
};
