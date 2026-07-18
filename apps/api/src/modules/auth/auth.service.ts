import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { RegisterParamsDto } from './dto/params-auth.dto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { requiredEnv } from '@/config/required-env';
import { AuthTokenPayload } from './jwt-payload';
import { randomBytes, createHash } from 'node:crypto';

@Injectable()
export class AuthService {
  private readonly secretKey: string;
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {
    this.secretKey = requiredEnv('JWT_SECRET');
  }

  async register(body: RegisterParamsDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (exists) throw new BadRequestException('邮箱已注册');

    const hash = await bcrypt.hash(body.password, 10);
    const user = await this.prisma.user.create({
      data: { email: body.email, username: body.username, password: hash, role: 'USER' },
    });
    return this.generateToken(user);
  }

  generateToken(user: { id: string; email: string; username: string }) {
    const payload = { sub: user.id, username: user.username };
    return {
      access_token: this.jwtService.sign(
        { ...payload, tokenType: 'access' } satisfies AuthTokenPayload,
        { expiresIn: '3d', secret: this.secretKey },
      ),
      refresh_token: this.jwtService.sign(
        { ...payload, tokenType: 'refresh' } satisfies AuthTokenPayload,
        { expiresIn: '5d', secret: this.secretKey },
      ),
    };
  }

  refreshToken(refresh_token: string) {
    try {
      const decoded = jwt.verify(refresh_token, this.secretKey) as AuthTokenPayload;
      if (decoded.tokenType !== 'refresh') throw new Error('Invalid token purpose');
      const payload = { sub: decoded.sub, username: decoded.username };
      return {
        access_token: this.jwtService.sign(
          { ...payload, tokenType: 'access' } satisfies AuthTokenPayload,
          { expiresIn: '3d', secret: this.secretKey },
        ),
        refresh_token: this.jwtService.sign(
          { ...payload, tokenType: 'refresh' } satisfies AuthTokenPayload,
          { expiresIn: '5d', secret: this.secretKey },
        ),
      };
    } catch {
      throw new BadRequestException('刷新令牌失效');
    }
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('用户不存在');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new BadRequestException('密码错误');
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    return this.generateToken(user);
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = randomBytes(32).toString('hex');
      const resetTokenHash = createHash('sha256').update(token).digest('hex');
      const resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await this.prisma.user.update({ where: { id: user.id }, data: { resetTokenHash, resetTokenExpiresAt } });
      const baseUrl = process.env.VITE_WEB_URL?.trim() || 'http://127.0.0.1:9999';
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;
      return { accepted: true, resetUrl };
    }
    return { accepted: true };
  }

  async resetPassword(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('邮箱不存在');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(password, 10), resetTokenHash: null, resetTokenExpiresAt: null },
    });
    return { accepted: true };
  }

  async getUserInfo(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user && { id: user.id, email: user.email, username: user.username, role: user.role };
  }
}
