import type { ClientId, ClientProfile } from '../types';
import { gmail } from './gmail';
import { outlookWin } from './outlook-win';
import { outlookCom } from './outlook-com';
import { appleMail } from './apple-mail';
import { yahoo } from './yahoo';

export const PROFILES: Record<ClientId, ClientProfile> = {
  gmail,
  'outlook-win': outlookWin,
  'outlook-com': outlookCom,
  'apple-mail': appleMail,
  yahoo,
};

export function getProfile(clientId: ClientId): ClientProfile {
  return PROFILES[clientId];
}
