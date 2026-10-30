import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

interface ErrorBody {
  readonly statusCode?: number;
  readonly message?: string | string[];
  readonly error?: string;
  readonly code?: string;
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const body: ErrorBody =
        typeof exceptionResponse === "string"
          ? { message: exceptionResponse }
          : (exceptionResponse as ErrorBody);

      response.status(status).json({
        statusCode: status,
        code: body.code ?? this.defaultCode(status),
        message: body.message ?? exception.message,
        path: request.url,
        timestamp: new Date().toISOString(),
      });

      return;
    }

    this.logger.error(
      "Unhandled HTTP exception",
      exception instanceof Error
        ? exception.stack
        : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private defaultCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return "BAD_REQUEST";
      case HttpStatus.UNAUTHORIZED:
        return "UNAUTHORIZED";
      case HttpStatus.FORBIDDEN:
        return "FORBIDDEN";
      case HttpStatus.NOT_FOUND:
        return "NOT_FOUND";
      case HttpStatus.CONFLICT:
        return "CONFLICT";
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return "UNPROCESSABLE_ENTITY";
      case HttpStatus.SERVICE_UNAVAILABLE:
        return "SERVICE_UNAVAILABLE";
      default:
        return "HTTP_ERROR";
    }
  }
}