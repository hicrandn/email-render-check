import {
  DESKTOP_CLIENT_IDS,
  MOBILE_CLIENT_IDS,
  type ClientId,
  type ClientProfile,
  type Device,
} from '../types';
import { gmail } from './gmail';
import { outlookWin } from './outlook-win';
import { outlookCom } from './outlook-com';
import { appleMail } from './apple-mail';
import { yahoo } from './yahoo';
import { gmailMobile } from './gmail-mobile';
import { outlookMobile } from './outlook-mobile';
import { appleMailIos } from './apple-mail-ios';
import { yahooMobile } from './yahoo-mobile';

export const PROFILES: Record<ClientId, ClientProfile> = {
  gmail,
  'outlook-win': outlookWin,
  'outlook-com': outlookCom,
  'apple-mail': appleMail,
  yahoo,
  'gmail-mobile': gmailMobile,
  'outlook-mobile': outlookMobile,
  'apple-mail-ios': appleMailIos,
  'yahoo-mobile': yahooMobile,
};

export function getProfile(clientId: ClientId): ClientProfile {
  return PROFILES[clientId];
}

export const CLIENTS_BY_DEVICE: Record<Device, readonly ClientId[]> = {
  desktop: DESKTOP_CLIENT_IDS,
  mobile: MOBILE_CLIENT_IDS,
};

// The same client on the other device. Both desktop Outlooks become the
// Outlook app; the app maps back to Outlook on Windows.
const COUNTERPART: Record<ClientId, ClientId> = {
  gmail: 'gmail-mobile',
  'outlook-win': 'outlook-mobile',
  'outlook-com': 'outlook-mobile',
  'apple-mail': 'apple-mail-ios',
  yahoo: 'yahoo-mobile',
  'gmail-mobile': 'gmail',
  'outlook-mobile': 'outlook-win',
  'apple-mail-ios': 'apple-mail',
  'yahoo-mobile': 'yahoo',
};

/** The client to show on `device` for one the user picked on either device. */
export function clientOn(device: Device, clientId: ClientId): ClientId {
  return PROFILES[clientId].device === device ? clientId : COUNTERPART[clientId];
}
