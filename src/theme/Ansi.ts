/** Width-safe helpers for strings that carry ANSI escapes. */
export class Ansi {
	// eslint-disable-next-line no-control-regex
	static readonly SGR = /\x1B\[[0-9;]*m/g;

	// eslint-disable-next-line no-control-regex
	static readonly CSI = /\x1B\[[0-9;?]*[A-Za-z]/g;

	/** Removes colour codes. */
	static stripAnsi(value: string): string {
		return value.replace(Ansi.SGR, '');
	}

	/** Removes every control sequence, leaving only text that moves the cursor. */
	static stripControl(value: string): string {
		return value.replace(Ansi.CSI, '');
	}

	/** Cuts to `width` visible columns with an ellipsis, never splitting an escape. */
	static truncate(line: string, width: number): string {
		if (Ansi.stripAnsi(line).length <= width) return line;

		let visible = 0;
		let out = '';

		for (let i = 0; i < line.length; i++) {
			if (line[i] === '\x1B') {
				const end = line.indexOf('m', i);

				if (end !== -1) {
					out += line.slice(i, end + 1);
					i = end;
					continue;
				}
			}

			if (visible >= width - 1) break;

			out += line[i];
			visible++;
		}

		return `${out}…\x1B[0m`;
	}

	/** NO_COLOR wins, FORCE_COLOR overrides, then TERM=dumb and non-TTY streams disable colour. */
	static detectColor(stream: NodeJS.WritableStream = process.stdout): boolean {
		if (process.env.NO_COLOR !== undefined) return false;
		if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== '0';
		if (process.env.TERM === 'dumb') return false;

		return Boolean((stream as NodeJS.WriteStream).isTTY);
	}
}
