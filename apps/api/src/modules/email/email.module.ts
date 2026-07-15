import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { MailerModule } from '@nestjs-modules/mailer';
import { EjsAdapter } from '@nestjs-modules/mailer/dist/adapters/ejs.adapter';
import * as path from 'path';
import { ConfigModule } from '@nestjs/config';
import { requiredEnv } from '@/config/required-env';

@Module({
  imports: [
    MailerModule.forRoot({
      transport: {
        host: 'smtp.qq.com',
        port: 587,
        auth: {
          user: requiredEnv('MAIL_USER'),
          pass: requiredEnv('MAIL_PASS'),
        },
      },
      preview: false,
      defaults: {
        from: requiredEnv('MAIL_FROM'),
      },
      template: {
        dir: path.join(process.cwd(), './src/modules/email/template'),
        adapter: new EjsAdapter(),
        options: {
          strict: true,
        },
      },
    }),
    ConfigModule,
  ],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
