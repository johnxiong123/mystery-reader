export class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function notFound(message = '资源不存在') {
  return new ApiError(404, 'NOT_FOUND', message);
}

export function badRequest(message = '请求参数无效') {
  return new ApiError(400, 'BAD_REQUEST', message);
}

export function installErrorHandler(app) {
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const code = error.code && typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR';
    const message = statusCode >= 500 ? '服务器内部错误' : error.message;
    request.log.error({ err: error, code }, 'request failed');
    reply.status(statusCode).send({ error: { code, message } });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith('/api/')) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
      return;
    }
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });
}
