import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'aura:isPublic';
/** Marks a route as reachable without an API key (e.g. health probes). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_QUERY_TOKEN = 'aura:allowQueryToken';
/** Accept the API key as `?access_token=` (only for clients that cannot set headers, e.g. EventSource). */
export const AllowQueryToken = () => SetMetadata(ALLOW_QUERY_TOKEN, true);
