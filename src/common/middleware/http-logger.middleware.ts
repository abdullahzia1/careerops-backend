import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Logs every HTTP request/response in the same style Hono's logger used:
 *   <-- GET /api/v1/me
 *   --> GET /api/v1/me 200  +3ms
 */
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl } = req;
    const start = Date.now();

    this.logger.log(`<-- ${method} ${originalUrl}`);

    res.on('finish', () => {
      const ms = Date.now() - start;
      this.logger.log(
        `--> ${method} ${originalUrl} ${res.statusCode} +${ms}ms`,
      );
    });

    next();
  }
}
