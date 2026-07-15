import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import { requiredEnv } from '@/config/required-env';
import { AuthTokenPayload } from './jwt-payload';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requiredEnv('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: AuthTokenPayload) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (!token) throw new UnauthorizedException('未登录');

    if (payload.tokenType !== 'access') throw new UnauthorizedException('Invalid token');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('token令牌非法，请重新登录');

    return payload;
  }
}
