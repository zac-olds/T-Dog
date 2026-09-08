import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { RecorderAuthGuard } from './recorder-auth.guard.js';

function contextWithAuthHeader(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

describe('RecorderAuthGuard', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });
  const guard = new RecorderAuthGuard(jwtService);

  it('allows a valid recorder token', () => {
    const token = jwtService.sign({ role: 'recorder' });
    expect(guard.canActivate(contextWithAuthHeader(`Bearer ${token}`))).toBe(
      true,
    );
  });

  it('rejects a token with the wrong role', () => {
    const token = jwtService.sign({ role: 'rails' });
    expect(() =>
      guard.canActivate(contextWithAuthHeader(`Bearer ${token}`)),
    ).toThrow('Unauthorized');
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = new JwtService({ secret: 'wrong-secret' }).sign({
      role: 'recorder',
    });
    expect(() =>
      guard.canActivate(contextWithAuthHeader(`Bearer ${token}`)),
    ).toThrow('Unauthorized');
  });

  it('rejects a missing Authorization header', () => {
    expect(() => guard.canActivate(contextWithAuthHeader(undefined))).toThrow(
      'Unauthorized',
    );
  });
});
