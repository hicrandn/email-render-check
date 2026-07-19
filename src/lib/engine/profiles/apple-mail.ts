import type { ClientProfile } from '../types';

export const appleMail: ClientProfile = {
  id: 'apple-mail',
  name: 'Apple Mail (macOS)',
  engine: 'WebKit',
  vendorDocs: 'https://www.caniemail.com/',
  uaStylesheet: "body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;}",
  quirks: {},
};
