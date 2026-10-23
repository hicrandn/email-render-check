import type { ClientId, ClientProfile, Mutation, RenderContext } from '../types';
import type { ParsedHtml } from '../parse/html';
import type { StyleSheet } from '../parse/css';

/** Shared, mutable state threaded through every pipeline stage. */
export interface StageContext {
  clientId: ClientId;
  profile: ClientProfile;
  parsed: ParsedHtml;
  /** The conditions being simulated (color scheme, viewport, …). */
  render: RenderContext;
  /** Parsed stylesheets; populated after the sanitize stage runs. */
  sheets: StyleSheet[];
  /** The single source of truth: every stage appends to this log. */
  mutations: Mutation[];
  /** Set by the dark-mode stage when the client recolors: for colors added later (VML). */
  recolor?: (color: string, role: 'text' | 'background') => string;
}
