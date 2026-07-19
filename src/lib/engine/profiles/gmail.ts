import type { ClientProfile } from '../types';

export const gmail: ClientProfile = {
  id: 'gmail',
  name: 'Gmail (Desktop Webmail)',
  engine: 'Blink (Chromium) with server-side sanitization',
  vendorDocs: 'https://developers.google.com/gmail/design/reference/supported_css',
  uaStylesheet: 'body{font-family:Arial,Helvetica,sans-serif;}',
  quirks: {
    maxSizeKB: 102, // Gmail clips messages larger than ~102 KB.
    partialMediaQueries: true,
  },
};
