import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'aura:isPublic';
/** Marks a route as reachable without an API key (e.g. health probes). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
