import { Request } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { RESPONSE_CODE, RESPONSE_MSG } from '@/enums';

/**
 * @description: 统一返回体
 */
export const responseMessage = <T = any>(
  data,
  msg: string = RESPONSE_MSG.SUCCESS,
  code: number = RESPONSE_CODE.SUCCESS,
): Api.Common.Response<T> => ({ data, msg, code, timestamp: new Date().getTime() });

/**
 * @description: 获取客户端真实 IP
 * @param {Request} req
 */
export const getRealIp = (req: Request): string => {
  const result =
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    req.ip;

  return Array.isArray(result) ? result[0] : result;
};

/**
 * 从对象中排除指定的键，并返回一个新的对象。
 * @param obj - 原始对象。
 * @param keys - 需要排除的键的数组。
 * @returns 新的对象，不包含指定的键。
 */
export const omit = <T, TKeys extends keyof T>(obj: T, keys: TKeys[]): Omit<T, TKeys> => {
  if (!obj) return {} as Omit<T, TKeys>;
  if (!keys || keys.length === 0) return obj as Omit<T, TKeys>;

  return keys.reduce(
    (acc, key) => {
      delete acc[key];

      return acc;
    },
    { ...obj },
  );
};
