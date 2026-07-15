import { Body, Controller, Post } from '@nestjs/common';
import { EmailService } from './email.service';
import { responseMessage } from '@/utils';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('send-code')
  async sendCode(@Body('email') email: string) {
    const code = Math.random().toString().slice(2, 8);
    await this.emailService.sendVerificationCode(email, code);
    return responseMessage({ code }, '验证码已发送');
  }
}
