import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginParamsDto, RegisterParamsDto } from './dto/params-auth.dto';
import { responseMessage } from '@/utils';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LoginResponseDto, UserInfoResponseDto } from './dto/response-auth.dto';

@ApiTags('身份鉴权')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: '用户注册' })
  @ApiOkResponse({ type: LoginResponseDto })
  async register(@Body() body: RegisterParamsDto) {
    const tokens = await this.authService.register(body);
    return responseMessage(tokens, '注册成功');
  }

  @Post('login')
  @ApiOperation({ summary: '用户登录' })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(@Body() body: LoginParamsDto) {
    const tokens = await this.authService.login(body.email, body.password);
    return responseMessage(tokens, '登录成功');
  }

  @Post('refresh')
  @ApiOperation({ summary: '刷新令牌' })
  @ApiBody({
    schema: {
      properties: {
        refresh_token: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: LoginResponseDto })
  async refresh(@Body('refresh_token') refreshToken: string) {
    const tokens = await this.authService.refreshToken(refreshToken);
    return responseMessage(tokens, '刷新成功');
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiHeader({
    name: 'Authorization',
    required: true,
    description: 'Bearer access_token',
  })
  @Get('getUserInfo')
  @ApiOperation({ summary: '获取用户信息' })
  @ApiOkResponse({ type: UserInfoResponseDto })
  async getUserInfo(@Req() req: Request & { user?: any }) {
    const payload = req.user;
    const info = await this.authService.getUserInfo(payload.sub);
    return responseMessage(info);
  }
}
