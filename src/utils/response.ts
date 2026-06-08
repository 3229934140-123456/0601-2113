import { Response } from 'express';
import { ApiResponse } from '../types';

export function success<T>(res: Response, data?: T, message: string = 'success'): void {
  const result: ApiResponse<T> = {
    code: 0,
    message,
    data,
    timestamp: Date.now(),
  };
  res.json(result);
}

export function error(res: Response, code: number, message: string): void {
  const result: ApiResponse = {
    code,
    message,
    timestamp: Date.now(),
  };
  res.status(code >= 500 ? 500 : code >= 400 ? 400 : 200).json(result);
}

export function notFound(res: Response, message: string = '资源不存在'): void {
  error(res, 404, message);
}

export function badRequest(res: Response, message: string = '请求参数错误'): void {
  error(res, 400, message);
}

export function serverError(res: Response, message: string = '服务器内部错误'): void {
  error(res, 500, message);
}
