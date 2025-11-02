export type AppErrorSeverity = "info" | "warn" | "error";

export interface AppErrorMetadata {
  code?: string;
  source?: string;
  cause?: unknown;
  severity?: AppErrorSeverity;
  userMessage?: string;
}

export class AppError extends Error {
  readonly code?: string;
  readonly source?: string;
  readonly cause?: unknown;
  readonly severity: AppErrorSeverity;
  readonly userMessage?: string;

  constructor(message: string, metadata: AppErrorMetadata = {}) {
    super(message);
    this.name = "AppError";
    this.code = metadata.code;
    this.source = metadata.source;
    this.cause = metadata.cause;
    this.severity = metadata.severity ?? "error";
    this.userMessage = metadata.userMessage;
  }
}

export function isAppError(input: unknown): input is AppError {
  return input instanceof AppError;
}
