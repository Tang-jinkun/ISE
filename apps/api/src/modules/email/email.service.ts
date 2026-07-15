import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class EmailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendVerificationCode(email: string, code: string) {
    const date = new Date().toLocaleString();
    await this.mailerService.sendMail({
      to: email,
      subject: '聚合场景编辑器 - 邮箱验证',
      template: 'validate.code.ejs',
      context: {
        code,
        date,
        sign: '聚合场景编辑器团队',
      },
    });
    return { success: true };
  }
}
