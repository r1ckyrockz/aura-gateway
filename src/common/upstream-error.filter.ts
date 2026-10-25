import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { UpstreamError } from './errors';

/** Maps failures of the LLM server / Home Assistant to 502/504 instead of a generic 500. */
@Catch(UpstreamError)
export class UpstreamErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Upstream');

  catch(error: UpstreamError, host: ArgumentsHost) {
    this.logger.error(error.message);
    const timeout = /timeout|aborted/i.test(error.message);
    const status = timeout ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY;
    host.switchToHttp().getResponse<Response>().status(status).json({
      statusCode: status,
      error: 'Upstream error',
      upstream: error.upstream,
      message: error.message,
    });
  }
}
