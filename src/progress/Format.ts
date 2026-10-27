import { type Style } from '../theme/Style';

/** Byte, rate, duration and bar formatting for progress output. */
export class Format {
	static readonly BAR_WIDTH = 28;

	/** Partial block glyphs, so the bar advances below one cell. */
	private static readonly PARTIALS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

	/** `9.54 MB`. */
	static bytes(bytes: number): string {
		if (!bytes || bytes < 0) return '0 B';

		const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
		const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);

		return `${parseFloat((bytes / 1024 ** i).toFixed(i === 0 ? 0 : 2))} ${sizes[i]}`;
	}

	/** `4.21 MB/s`, or `--` when idle. */
	static speed(bytesPerSecond: number): string {
		return bytesPerSecond > 0 ? `${Format.bytes(bytesPerSecond)}/s` : '--';
	}

	/** `mm:ss`, `h:mm:ss` past an hour, or `--:--` when unknown. */
	static duration(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';

		const total = Math.round(seconds);
		const pad = (value: number) => String(value).padStart(2, '0');
		const [hours, minutes, secs] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];

		return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
	}

	private static ratio(done: number, total: number): number {
		return total > 0 ? Math.min(Math.max(done / total, 0), 1) : 0;
	}

	/** `42.5%` padded to a fixed width; `--` when the total is unknown rather than a fake 0%. */
	static percent(done: number, total: number): string {
		return total > 0 ? `${(Format.ratio(done, total) * 100).toFixed(1).padStart(5)}%` : '   --';
	}

	/** A block bar; an unknown total draws an indeterminate track. */
	static bar(style: Style, done: number, total: number, width = Format.BAR_WIDTH): string {
		if (total <= 0) return style.dim('─'.repeat(width));

		const exact = Format.ratio(done, total) * width;
		const filled = Math.floor(exact);
		const head = '█'.repeat(filled) + Format.PARTIALS[Math.floor((exact - filled) * Format.PARTIALS.length)];

		return `${style.accent(head)}${style.dim('░'.repeat(Math.max(0, width - head.length)))}`;
	}

	/** Bar, percent and `done/total`. */
	static countTrack(style: Style, done: number, total: number): string {
		return [Format.bar(style, done, total), Format.percent(done, total), style.bold(`${done}/${total}`)].join('  ');
	}

	/** Bar, percent, transferred/total, rate and ETA. */
	static byteTrack(style: Style, bytes: number, totalBytes: number, speed: number, eta: number): string {
		const transferred = totalBytes ? `${Format.bytes(bytes)} / ${Format.bytes(totalBytes)}` : Format.bytes(bytes);

		return [
			Format.bar(style, bytes, totalBytes),
			Format.percent(bytes, totalBytes),
			style.bold(transferred),
			style.muted(Format.speed(speed)),
			style.muted(`ETA ${Format.duration(eta)}`)
		].join('  ');
	}

	/** Word-wraps prose, hard-breaking tokens longer than `width`. */
	static wrap(text: string, width: number): string[] {
		const lines: string[] = [];
		let current = '';

		for (const word of text.split(/\s+/).filter(Boolean)) {
			if (!current) current = word;
			else if (current.length + 1 + word.length <= width) current += ` ${word}`;
			else {
				lines.push(current);
				current = word;
			}

			while (current.length > width) {
				lines.push(current.slice(0, width));
				current = current.slice(width);
			}
		}

		if (current) lines.push(current);

		return lines;
	}

	/** Long URLs become `host/…/last-segment`; anything else is returned as is. */
	static shortUrl(value: string): string {
		if (!/^https?:\/\//.test(value)) return value;

		try {
			const url = new URL(value);
			const tail = url.pathname.split('/').filter(Boolean).pop() ?? '';

			return `${url.hostname}${tail ? `/…/${tail}` : ''}`;
		} catch {
			return value;
		}
	}
}
