import type { ClientProfile } from '../types';

export const outlookCom: ClientProfile = {
  id: 'outlook-com',
  device: 'desktop',
  name: 'Outlook.com',
  engine: 'Webmail (Blink) with Microsoft CSS sanitization',
  vendorDocs: 'https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/aa338201(v=office.12)',
  uaStylesheet: "body{font-family:'Segoe UI',Arial,sans-serif;}\ntable{border-collapse:collapse;}",
  quirks: {},
  darkMode: {
    strategy: 'partial-invert',
    supportsOgscHack: true,
    note:
      'Outlook.com darkens light backgrounds and lightens dark text, marking what it ' +
      'changed with [data-ogsc]/[data-ogsb]. It also applies @media ' +
      '(prefers-color-scheme: dark).',
  },
};
