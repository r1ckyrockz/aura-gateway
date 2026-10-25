import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BlockList } from 'node:net';
import { testEnv } from '../testing/fixtures';
import { addCidr, ApiKeyGuard, keyFingerprint } from './api-key.guard';

const context = (headers: Record<string, string>, ip = '203.0.113.9') => {
  const request: Record<string, unknown> = { headers, ip };
  return {
    request,
    ctx: {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
};

describe('ApiKeyGuard', () => {
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
  const guard = new ApiKeyGuard(
    reflector,
    testEnv({ AURA_API_KEYS: 'secret-1,secret-2', AURA_AUTH_EXEMPT_CIDRS: '192.168.1.0/24' }),
  );

  it('accepts a valid bearer key and records the client fingerprint', () => {
    const { ctx, request } = context({ authorization: 'Bearer secret-2' });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.auraClient).toBe(keyFingerprint('secret-2'));
  });

  it('accepts x-api-key', () => {
    expect(guard.canActivate(context({ 'x-api-key': 'secret-1' }).ctx)).toBe(true);
  });

  it('rejects missing or wrong keys', () => {
    expect(() => guard.canActivate(context({}).ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context({ authorization: 'Bearer nope' }).ctx)).toThrow(
      UnauthorizedException,
    );
  });

  it('lets exempt networks through (incl. IPv4-mapped IPv6)', () => {
    expect(guard.canActivate(context({}, '::ffff:192.168.1.103').ctx)).toBe(true);
  });

  it('is open when no keys are configured', () => {
    const open = new ApiKeyGuard(reflector, testEnv());
    expect(open.canActivate(context({}).ctx)).toBe(true);
  });

  it('validates CIDRs', () => {
    expect(() => addCidr(new BlockList(), 'nonsense/8')).toThrow();
    expect(() => addCidr(new BlockList(), '10.0.0.0/40')).toThrow();
  });
});
