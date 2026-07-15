import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtStrategy } from './jwt.strategy';

jest.mock('@/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }), {
  virtual: true,
});
jest.mock(
  '@/config/required-env',
  () => ({
    requiredEnv: (name: string) => {
      const value = process.env[name]?.trim();
      if (!value) throw new Error(`Missing required environment variable: ${name}`);
      return value;
    },
  }),
  { virtual: true },
);

describe('JwtStrategy token purpose', () => {
  const secret = 'test-jwt-secret';
  const originalEnv = process.env;
  const identity = { sub: 'user-1', username: 'test-user' };

  let prisma: { user: { findUnique: jest.Mock } };
  let strategy: JwtStrategy;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: secret };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: identity.sub }),
      },
    };
    strategy = new JwtStrategy(prisma as any);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('authenticates a signed access token and returns the claims bound to that token', async () => {
    const tokenIdentity = { sub: 'bound-user', username: 'bound-username' };
    const token = signToken({ ...tokenIdentity, tokenType: 'access' });

    await expect(authenticate(token)).resolves.toMatchObject({
      outcome: 'success',
      user: { ...tokenIdentity, tokenType: 'access' },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: tokenIdentity.sub },
    });
  });

  it.each([
    ['refresh', { ...identity, tokenType: 'refresh' }],
    ['purpose-less legacy', { ...identity }],
    ['unknown-purpose', { ...identity, tokenType: 'other' }],
  ])('rejects a correctly signed %s token', async (_label, payload) => {
    const result = await authenticate(signToken(payload));

    expect(result).toMatchObject({
      outcome: 'error',
      error: expect.any(UnauthorizedException),
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an access token with an invalid signature before validation', async () => {
    const token = signToken({ ...identity, tokenType: 'access' }, 'different-secret');

    await expect(authenticate(token)).resolves.toMatchObject({
      outcome: 'fail',
      challenge: expect.any(Error),
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an expired access token before validation', async () => {
    const token = signToken({ ...identity, tokenType: 'access' }, secret, -1);

    await expect(authenticate(token)).resolves.toMatchObject({
      outcome: 'fail',
      challenge: expect.any(Error),
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  function signToken(payload: object, signingSecret = secret, expiresIn = 3 * 24 * 60 * 60) {
    return new JwtService().sign(payload, { secret: signingSecret, expiresIn });
  }

  function authenticate(token: string) {
    return new Promise<
      | { outcome: 'success'; user: unknown }
      | { outcome: 'fail'; challenge: unknown }
      | { outcome: 'error'; error: unknown }
    >((resolve) => {
      const passportStrategy = strategy as JwtStrategy & {
        success(user: unknown): void;
        fail(challenge: unknown): void;
        error(error: unknown): void;
        authenticate(request: Request): void;
      };

      passportStrategy.success = (user) => resolve({ outcome: 'success', user });
      passportStrategy.fail = (challenge) => resolve({ outcome: 'fail', challenge });
      passportStrategy.error = (error) => resolve({ outcome: 'error', error });
      passportStrategy.authenticate({
        headers: { authorization: `Bearer ${token}` },
      } as Request);
    });
  }
});
