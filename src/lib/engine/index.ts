// Public engine entry point.
export { simulate } from './engine';
export { PROFILES, getProfile } from './profiles';
export { CLIENT_IDS, DEFAULT_CONTEXT } from './types';
export type {
  ClientId,
  ClientProfile,
  ColorScheme,
  RenderContext,
  DarkModeProfile,
  DarkModeStrategy,
  Mutation,
  MutationStage,
  MutationAction,
  Severity,
  SourceLocation,
  SimulationResult,
} from './types';
