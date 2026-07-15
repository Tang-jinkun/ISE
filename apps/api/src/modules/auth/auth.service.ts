import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { RegisterParamsDto } from './dto/params-auth.dto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { EmailService } from '@/modules/email/email.service';
import { RedisService } from '@/redis/redis.service';
import { requiredEnv } from '@/config/required-env';
import { AuthTokenPayload } from './jwt-payload';

@Injectable()
export class AuthService {
  private readonly secretKey: string;
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private emailService: EmailService,
    private redisService: RedisService,
  ) {
    this.secretKey = requiredEnv('JWT_SECRET');
  }

  async sendRegisterCode(email: string) {
    const code = Math.random().toString().slice(2, 8);
    const ttlSeconds = 10 * 60;
    const key = `verify:register:${email}`;
    await this.redisService.set(key, code, ttlSeconds);
    await this.emailService.sendVerificationCode(email, code);
    return { ok: true };
  }

  async register(body: RegisterParamsDto) {
    const key = `verify:register:${body.email}`;
    const storedCode = await this.redisService.get(key);
    if (!storedCode) throw new BadRequestException('验证码已过期或不存在');
    if (storedCode !== body.code) throw new BadRequestException('验证码错误');

    const exists = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (exists) throw new BadRequestException('邮箱已注册');

    const hash = await bcrypt.hash(body.password, 10);
    const user = await this.prisma.user.create({
      data: { email: body.email, username: body.username, password: hash, role: 'USER' },
    });
    await this.redisService.del(key);

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

  async getUserInfo(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user && { id: user.id, email: user.email, username: user.username, role: user.role };
  }
}
