import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';

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

describe('AuthService token purpose', () => {
  const secret = 'test-jwt-secret';
  const user = {
    id: 'user-1',
    email: 'user@example.com',
    username: 'test-user',
  };
  const originalEnv = process.env;

  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };
  let service: AuthService;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: secret };
    prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };
    service = new AuthService(new JwtService(), prisma as any);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function verifyToken(token: string) {
    return jwt.verify(token, secret) as jwt.JwtPayload & {
      sub: string;
      username: string;
      tokenType: 'access' | 'refresh';
    };
  }

  it('issues access and refresh tokens with distinct purposes and unchanged identity and expiry', () => {
    const tokens = service.generateToken(user);

    const access = verifyToken(tokens.access_token);
    const refresh = verifyToken(tokens.refresh_token);

    expect(access).toMatchObject({
      sub: user.id,
      username: user.username,
      tokenType: 'access',
    });
    expect(refresh).toMatchObject({
      sub: user.id,
      username: user.username,
      tokenType: 'refresh',
    });
    expect(access.exp! - access.iat!).toBe(3 * 24 * 60 * 60);
    expect(refresh.exp! - refresh.iat!).toBe(5 * 24 * 60 * 60);
  });

  it('keeps valid login and refresh flows working with purpose-specific replacement tokens', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      password: await bcrypt.hash('password-123', 4),
    });

    const loginTokens = await service.login(user.email, 'password-123');
    const refreshedTokens = service.refreshToken(loginTokens.refresh_token);
    const refreshedAccess = verifyToken(refreshedTokens.access_token);
    const refreshedRefresh = verifyToken(refreshedTokens.refresh_token);

    expect(verifyToken(loginTokens.access_token)).toMatchObject({
      sub: user.id,
      username: user.username,
      tokenType: 'access',
    });
    expect(verifyToken(loginTokens.refresh_token).tokenType).toBe('refresh');
    expect(refreshedAccess).toMatchObject({
      sub: user.id,
      username: user.username,
      tokenType: 'access',
    });
    expect(refreshedRefresh).toMatchObject({
      sub: user.id,
      username: user.username,
      tokenType: 'refresh',
    });
    expect(refreshedAccess.exp! - refreshedAccess.iat!).toBe(3 * 24 * 60 * 60);
    expect(refreshedRefresh.exp! - refreshedRefresh.iat!).toBe(5 * 24 * 60 * 60);
  });

  it('registers without email or Redis dependencies and returns purpose-specific tokens', async () => {
    const body = {
      email: 'new-user@example.com',
      username: 'new-user',
      password: 'password-123',
    };
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => ({
      id: 'user-2',
      ...data,
    }));

    const tokens = await service.register(body);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: body.email } });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: body.email,
        username: body.username,
        password: expect.any(String),
        role: 'USER',
      },
    });
    const passwordHash = prisma.user.create.mock.calls[0][0].data.password;
    expect(passwordHash).not.toBe(body.password);
    await expect(bcrypt.compare(body.password, passwordHash)).resolves.toBe(true);
    expect(verifyToken(tokens.access_token)).toMatchObject({
      sub: 'user-2',
      username: body.username,
      tokenType: 'access',
    });
    expect(verifyToken(tokens.refresh_token)).toMatchObject({
      sub: 'user-2',
      username: body.username,
      tokenType: 'refresh',
    });
  });

  it('rejects an access token used as a refresh token without exposing it', () => {
    const accessToken = service.generateToken(user).access_token;

    expectRefreshRejection(accessToken);
  });

  it.each([
    ['missing', undefined],
    ['unknown', 'other'],
  ])('rejects a refresh token with a %s purpose without exposing it', (_label, tokenType) => {
    const token = new JwtService().sign(
      { sub: user.id, username: user.username, ...(tokenType && { tokenType }) },
      { secret, expiresIn: '5d' },
    );

    expectRefreshRejection(token);
  });

  function expectRefreshRejection(token: string) {
    try {
      service.refreshToken(token);
      throw new Error('Expected refresh token rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).not.toContain(token);
    }
  }
});
