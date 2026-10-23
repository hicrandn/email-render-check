import type { ClientProfile } from '../types';

export const outlookWin: ClientProfile = {
  id: 'outlook-win',
  device: 'desktop',
  name: 'Outlook (Windows)',
  engine: 'Microsoft Word (`mso`) rendering engine',
  vendorDocs: 'https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2007/aa338201(v=office.12)',
  // Word renders unstyled text in a serif face and collapses table spacing.
  uaStylesheet: [
    "body,table,td,p,div,span,a,h1,h2,h3,h4,h5,h6{font-family:'Times New Roman',Times,serif;}",
    'table{border-collapse:collapse;}',
    'img{-ms-interpolation-mode:bicubic;}',
  ].join('\n'),
  quirks: {
    conditionalComments: true,
    unreliablePercentWidth: true,
  },
  darkMode: {
    strategy: 'unsupported',
    supportsOgscHack: false,
    note:
      'Outlook on Windows (Word engine) always renders the light design ' +
      'regardless of the OS dark-mode setting.',
  },
};
