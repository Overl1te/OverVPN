import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ApiException } from './api-error';
import {
  IS_PUBLIC_KEY,
  READONLY_MUTATION_KEY,
  ROLES_KEY,
  RolesGuard,
  type AuthenticatedRequest,
} from './authorization';

function context(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function reflector(metadata: {
  roles?: Array<'OWNER' | 'ADMIN' | 'READONLY'>;
  readonlyMutation?: boolean;
}): Reflector {
  return {
    getAllAndOverride: (key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return metadata.roles;
      if (key === READONLY_MUTATION_KEY) return metadata.readonlyMutation;
      return undefined;
    },
  } as unknown as Reflector;
}

const readonlyAdmin = {
  id: 'a0f6395d-0739-473d-b0e5-3f9bdc69a173',
  username: 'reader',
  role: 'READONLY' as const,
  locale: 'en' as const,
  active: true,
  totpEnabled: false,
  lastLoginAt: null,
};

function expectApiException(operation: () => unknown): ApiException {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof ApiException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected ApiException');
}

describe('RolesGuard', () => {
  it('allows READONLY administrators to read domain routes', () => {
    const guard = new RolesGuard(reflector({}));
    expect(
      guard.canActivate(context({ method: 'GET', admin: readonlyAdmin })),
    ).toBe(true);
  });

  it('denies READONLY writes unless the self-service route opts in', () => {
    const denied = new RolesGuard(reflector({}));
    expect(
      expectApiException(() =>
        denied.canActivate(context({ method: 'PATCH', admin: readonlyAdmin })),
      ).code,
    ).toBe('FORBIDDEN');

    const selfService = new RolesGuard(reflector({ readonlyMutation: true }));
    expect(
      selfService.canActivate(
        context({ method: 'POST', admin: readonlyAdmin }),
      ),
    ).toBe(true);
  });

  it('enforces explicit OWNER-only routes', () => {
    const guard = new RolesGuard(reflector({ roles: ['OWNER'] }));
    expect(
      expectApiException(() =>
        guard.canActivate(
          context({
            method: 'DELETE',
            admin: { ...readonlyAdmin, role: 'ADMIN' },
          }),
        ),
      ).code,
    ).toBe('FORBIDDEN');
  });
});
