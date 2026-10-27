import { appendFileSync } from 'node:fs';
import { defaultTheme, defineTheme, type Theme, type ThemeOverrides } from '../theme/Theme';
import { type LogLevelName } from './levels';

/** `append` adds a line per call (NestJS); `live` rewrites the logger's line in place (curl). */
export type LogMode = 'append' | 'live';

export interface SegraLoggerOptions {
	/** Minimum level written; defaults to `INFO`. */
	level?: LogLevelName;
	/** Your branding, merged onto the Segra default. */
	theme?: ThemeOverrides;
	/** Also append uncolored records to this file. */
	file?: string;
	/** Print the theme banner once at startup. */
	banner?: boolean;
	/** Default output mode for every logger; defaults to `append`. */
	mode?: LogMode;
}

export interface LoggerConfig {
	level: LogLevelName;
	theme: Theme;
	file?: string;
	banner: boolean;
	mode: LogMode;
}

let current: LoggerConfig = { level: 'INFO', theme: defaultTheme, banner: false, mode: 'append' };

export function getLoggerConfig(): Readonly<LoggerConfig> {
	return current;
}

/** Merges options into the process-wide config; throws early if `file` is not writable. */
export function setLoggerConfig(options: SegraLoggerOptions): Readonly<LoggerConfig> {
	if (options.file) appendFileSync(options.file, '');

	current = {
		level: options.level ?? current.level,
		theme: defineTheme(options.theme ?? {}, current.theme),
		file: options.file ?? current.file,
		banner: options.banner ?? current.banner,
		mode: options.mode ?? current.mode
	};

	return current;
}
