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
};
