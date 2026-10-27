/** Severity order; `SILENT` suppresses everything. */
export const LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SILENT: 4 } as const;

export type LogLevelName = keyof typeof LogLevel;

/** Levels a record can carry. */
export type Severity = Exclude<LogLevelName, 'SILENT'>;
