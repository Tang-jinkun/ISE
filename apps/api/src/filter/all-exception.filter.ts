import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  LoggerService,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { responseMessage } from '@/utils';

// @Catch() 装饰器绑定所需的元数据到异常过滤器上。它告诉 Nest这个特定的过滤器正在寻找
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    // 获取上下文
    const ctx = host.switchToHttp();
    // 获取响应体
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // 获取状态码，判断是HTTP异常还是服务器异常
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const isHttp = exception instanceof HttpException;
    const message = isHttp
      ? (() => {
          const res = (exception as HttpException).getResponse();
          return typeof res === 'string' ? res : ((res as any)?.message ?? '请求处理失败');
        })()
      : exception instanceof Error
        ? exception.message
        : '服务器内部错误';

    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(
      `[Exception] ${statusCode} ${request.method} ${request.url} ${message}`,
      stack,
    );

    response
      .status(statusCode)
      .json(responseMessage(null, isHttp ? message : '服务器内部错误!', statusCode));
  }
}
