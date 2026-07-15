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

  it('accepts an access token and preserves its subject and username', async () => {
    const payload = { ...identity, tokenType: 'access' as const };

    await expect(strategy.validate(requestFor(payload), payload)).resolves.toEqual(payload);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: identity.sub } });
  });

  it('rejects a refresh token used to authenticate an API request', async () => {
    const payload = { ...identity, tokenType: 'refresh' as const };

    await expect(strategy.validate(requestFor(payload), payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', { ...identity }],
    ['unknown', { ...identity, tokenType: 'other' }],
  ])('rejects an API token with a %s purpose', async (_label, payload) => {
    await expect(strategy.validate(requestFor(payload), payload as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  function requestFor(payload: object): Request {
    const token = new JwtService().sign(payload, { secret, expiresIn: '3d' });
    return { headers: { authorization: `Bearer ${token}` } } as Request;
  }
});
