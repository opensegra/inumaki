import { getLoggerConfig } from '../logger/config';
import { Ansi } from './Ansi';
import { type Theme, type Tone } from './Theme';

/** ANSI coloring with the configured theme; color support is re-checked on every call. */
export class Style {
	public readonly theme: Theme;

	constructor(private readonly stream: NodeJS.WritableStream = process.stdout) {
		this.theme = getLoggerConfig().theme;
	}

	private wrap(code: string, value: string): string {
		return Ansi.detectColor(this.stream) ? `\x1B[${code}m${value}\x1B[0m` : value;
	}

	public paint(tone: Tone, value: string): string {
		return this.wrap(this.theme.palette[tone], value);
	}

	public bold(value: string): string {
		return this.wrap('1', value);
	}

	public dim(value: string): string {
		return this.wrap('2', value);
	}

	public accent(value: string): string {
		return this.paint('accent', value);
	}

	public success(value: string): string {
		return this.paint('success', value);
	}

	public warn(value: string): string {
		return this.paint('warn', value);
	}

	public danger(value: string): string {
		return this.paint('danger', value);
	}

	public muted(value: string): string {
		return this.paint('muted', value);
	}

	/** `icon NAME · tagline` on one line. */
	public wordmark(): string {
		const { icon, name, tagline } = this.theme;

		return [icon && this.accent(icon), this.bold(this.accent(name)), tagline && this.dim(`· ${tagline}`)].filter(Boolean).join(' ');
	}

	/** The theme banner, or the wordmark when there is none or it would wrap. */
	public banner(width = (this.stream as NodeJS.WriteStream).columns || 80): string[] {
		const { banner } = this.theme;

		if (!banner.length || width < Math.max(...banner.map((line) => line.length)) + 2) return [this.wordmark()];

		return banner.map((line) => this.accent(line));
	}
}
