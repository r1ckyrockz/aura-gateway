import type { Profile } from '../config/aura-config.schema';

/** Who is asking — resolved once per request. */
export interface Principal {
  profileName: string;
  profile: Profile;
  /** Identified speaker id (e.g. from a voice profile), if any. */
  speaker?: string;
  /** Room/area the request comes from (e.g. the satellite's area), if any. */
  room?: string;
  /** Fingerprint of the API key used, if any. */
  client?: string;
  /** How the profile was chosen. */
  resolvedBy: 'speaker' | 'client' | 'room' | 'default';
}

export interface PrincipalInput {
  speaker?: string;
  room?: string;
  client?: string;
}

export type Decision =
  { allowed: true; requiresConfirmation: boolean } | { allowed: false; reason: string };
