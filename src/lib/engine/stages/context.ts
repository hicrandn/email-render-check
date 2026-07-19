import type { ClientId, ClientProfile, Mutation } from '../types';
import type { ParsedHtml } from '../parse/html';
import type { StyleSheet } from '../parse/css';

/** Shared, mutable state threaded through every pipeline stage. */
export interface StageContext {
  clientId: ClientId;
  profile: ClientProfile;
  parsed: ParsedHtml;
  /** Parsed stylesheets; populated after the sanitize stage runs. */
  sheets: StyleSheet[];
  /** The single source of truth: every stage appends to this log. */
  mutations: Mutation[];
}
