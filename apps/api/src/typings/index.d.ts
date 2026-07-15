declare namespace Api {
  namespace Common {
    /**
     * @description: 全局响应体
     */
    type Response<T = any> = {
      code: number; // 状态码
      data?: T; // 业务数据
      msg: string; // 响应信息
      timestamp: number; // 时间戳
    };
    /**
     * @description: 分页数据
     */
    type PageResponse<T = any> = {
      current?: number; // 页码
      size?: number; // 当前页条数
      total?: number; // 总条数
      records: T[]; // 业务数据
    };
    // Session 存储信息
    type SessionInfo = {
      captchaCode: string; // 验证码
      userInfo: import('@prisma/client').User;
    };
    // token 生成信息
    type TokenPayload = {
      sub: string;
    } & Pick<import('@prisma/client').User, 'username'>;
  }
}
