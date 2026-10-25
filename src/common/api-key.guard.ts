import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';
import { AURA_ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { IS_PUBLIC } from './public.decorator';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Short, non-reversible label for a key — used to map API clients to profiles. */
export const keyFingerprint = (key: string) => digest(key).toString('hex').slice(0, 12);

export interface AuthenticatedRequest extends Request {
  auraClient?: string;
}

/**
 * Bearer-token authentication.
 * - No keys configured → open (development), logged once as a warning.
 * - Requests from AURA_AUTH_EXEMPT_CIDRS skip the check (e.g. Home Assistant's Ollama integration,
 *   which cannot send headers).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly keys: Buffer[];
  private readonly exempt = new BlockList();
  private readonly hasExemptions: boolean;

  constructor(
    private readonly reflector: Reflector,
    @Inject(AURA_ENV) env: Env,
  ) {
    this.keys = env.AURA_API_KEYS.map(digest);
    this.hasExemptions = env.AURA_AUTH_EXEMPT_CIDRS.length > 0;
    for (const cidr of env.AURA_AUTH_EXEMPT_CIDRS) addCidr(this.exempt, cidr);
    if (this.keys.length === 0) {
      this.logger.warn('AURA_API_KEYS is empty — the API is open to anyone who can reach it.');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || this.keys.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (this.hasExemptions && this.isExempt(request.ip)) return true;

    const token = extractToken(request);
    if (token) {
      const hashed = digest(token);
      if (this.keys.some((key) => timingSafeEqual(key, hashed))) {
        request.auraClient = keyFingerprint(token);
        return true;
      }
    }
    throw new UnauthorizedException('Missing or invalid API key');
  }

  private isExempt(ip: string | undefined): boolean {
    if (!ip) return false;
    const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const family = isIP(normalized);
    if (family === 0) return false;
    return this.exempt.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
  }
}

function extractToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const apiKey = request.headers['x-api-key'];
  return typeof apiKey === 'string' ? apiKey : undefined;
}

export function addCidr(list: BlockList, cidr: string): void {
  const [address, prefixRaw] = cidr.split('/');
  const family = isIP(address);
  if (family === 0) throw new Error(`Invalid CIDR in AURA_AUTH_EXEMPT_CIDRS: ${cidr}`);
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (prefixRaw === undefined) {
    list.addAddress(address, type);
    return;
  }
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) {
    throw new Error(`Invalid CIDR prefix in AURA_AUTH_EXEMPT_CIDRS: ${cidr}`);
  }
  list.addSubnet(address, prefix, type);
}
