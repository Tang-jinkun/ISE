import { NextFunction, Request, Response } from 'express';

function parseValue(value: any): any {
  if (typeof value !== 'string') return value;

  if (value === 'true') return true;
  if (value === 'false') return false;

  if (!isNaN(value as any) && value.trim() !== '') return Number(value);

  // 强制把空字符串转为数组
  if (value === '') return [];

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null) return deepParseObject(parsed);
  } catch {}

  return value;
}

export function deepParseObject(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => deepParseObject(item));
  } else if (obj && typeof obj === 'object') {
    const parsedObj: any = {};

    for (const key in obj) {
      parsedObj[key] = deepParseObject(obj[key]);
    }

    return parsedObj;
  } else {
    return parseValue(obj);
  }
}

export function requestMiddleware(req: Request, res: Response, next: NextFunction) {
  req.query = deepParseObject(req.query);
  req.body = deepParseObject(req.body);
  next();
}
