import { appendFileSync } from 'node:fs';
import { format } from 'node:util';
import { TerminalSurface } from '../terminal/TerminalSurface';
import { Ansi } from '../theme/Ansi';
import { Style } from '../theme/Style';
import { type Tone } from '../theme/Theme';
import { getLoggerConfig, type LogMode, type InumakiOptions, setLoggerConfig } from './config';
import { LogLevel, type Severity } from './levels';

const TONES: Record<Severity, Tone> = { DEBUG: 'muted', INFO: 'success', WARN: 'warn', ERROR: 'danger' };

/** Local time with numeric offset, e.g. `2026-10-27T10:20:30+0530`. */
function timestamp(time = new Date()): string {
	const pad = (value: number) => String(Math.abs(value)).padStart(2, '0');
	const offset = -time.getTimezoneOffset();

	return (
		`${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}` +
		`T${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}` +
		`${offset >= 0 ? '+' : '-'}${pad(Math.trunc(offset / 60))}${pad(offset % 60)}`
	);
}

/** NestJS-style branded logger: configure once with `create()`, then log from anywhere in either mode. */
export class Inumaki {
	private static shared: Inumaki | null = null;

	/** This logger's slot in the live region. */
	private readonly owner: symbol;

	/** Sets branding and options for the whole process and returns a logger. */
	public static create(options: InumakiOptions = {}): Inumaki {
		setLoggerConfig(options);

		return new Inumaki();
	}

	private static get default(): Inumaki {
		return (Inumaki.shared ??= new Inumaki());
	}

	public static debug(message: unknown, ...args: unknown[]): void {
		Inumaki.default.debug(message, ...args);
	}

	public static log(message: unknown, ...args: unknown[]): void {
		Inumaki.default.log(message, ...args);
	}

	public static info(message: unknown, ...args: unknown[]): void {
		Inumaki.default.info(message, ...args);
	}

	public static warn(message: unknown, ...args: unknown[]): void {
		Inumaki.default.warn(message, ...args);
	}

	public static error(message: unknown, ...args: unknown[]): void {
		Inumaki.default.error(message, ...args);
	}

	/**
	 * @param context Label shown in brackets, usually the class name.
	 * @param options.mode Overrides the configured mode for this logger only.
	 * @param options.captureConsole In live mode, move foreign stdout/stderr writes above the region; defaults to true.
	 */
	constructor(
		public readonly context?: string,
		private readonly options: { mode?: LogMode; captureConsole?: boolean } = {}
	) {
		this.owner = Symbol(context ?? 'segra');
	}

	/** This logger's mode: its own option, else the configured one. */
	public get mode(): LogMode {
		return this.options.mode ?? getLoggerConfig().mode;
	}

	public debug(message: unknown, ...args: unknown[]): void {
		this.write('DEBUG', message, args);
	}

	/** NestJS name for an info-level line. */
	public log(message: unknown, ...args: unknown[]): void {
		this.write('INFO', message, args);
	}

	public info(message: unknown, ...args: unknown[]): void {
		this.write('INFO', message, args);
	}

	public warn(message: unknown, ...args: unknown[]): void {
		this.write('WARN', message, args);
	}

	public error(message: unknown, ...args: unknown[]): void {
		this.write('ERROR', message, args);
	}

	/** Ends this logger's live line, leaving its last text on screen. */
	public end(): void {
		TerminalSurface.instance.end(this.owner);
	}

	/** Formats `[BRAND] pid  - time   LEVEL [Context] message` and appends it or rewrites this logger's live line. */
	private write(level: Severity, message: unknown, args: unknown[]): void {
		const config = getLoggerConfig();

		if (config.level === 'SILENT' || LogLevel[level] < LogLevel[config.level]) return;

		// a theme banner, when given, heads the first line in either mode
		TerminalSurface.instance.printBanner();

		const style = new Style(process.stderr);
		const tone = TONES[level];
		const text = format(message, ...args);

		const line = [
			style.bold(style.accent(`[${config.theme.name}]`)),
			style.muted(`${process.pid}  -`),
			style.dim(timestamp()),
			style.paint(tone, level.padStart(5)),
			this.context ? style.warn(`[${this.context}]`) : '',
			level === 'WARN' || level === 'ERROR' ? style.paint(tone, text) : text
		]
			.filter(Boolean)
			.join(' ');

		// warnings and errors stay on screen even in live mode
		const live = this.mode === 'live' && (level === 'DEBUG' || level === 'INFO');

		if (live) TerminalSurface.instance.setLine(this.owner, line, this.options.captureConsole ?? true);
		else TerminalSurface.instance.persist(line);

		if (config.file) appendFileSync(config.file, `${Ansi.stripAnsi(line)}\n`);
	}
}
