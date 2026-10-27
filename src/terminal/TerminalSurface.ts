import { SignalHandler } from '../lifecycle/SignalHandler';
import { getLoggerConfig } from '../logger/config';
import { Ansi } from '../theme/Ansi';
import { Style } from '../theme/Style';

type Write = typeof process.stdout.write;

/** Sole owner of the cursor: keeps one line per live logger on stderr, redrawn in place. */
export class TerminalSurface {
	private static shared: TerminalSurface | null = null;

	public static get instance(): TerminalSurface {
		return (TerminalSurface.shared ??= new TerminalSurface());
	}

	/** Live lines by owner, in render order. */
	private readonly lines = new Map<symbol, string>();

	/** Visible width of each row in the live region, as drawn. */
	private drawnWidths: number[] = [];
	private bannerShown = false;
	private cursorHidden = false;
	private redrawing = false;
	private redrawQueued = false;

	/** True while the surface writes, so its own output is not intercepted. */
	private internalWrite = false;

	/** Whether the cursor sits at column 0. */
	private atLineStart = true;

	private originalStdout: Write | null = null;
	private originalStderr: Write | null = null;
	private wrapperStdout: Write | null = null;
	private wrapperStderr: Write | null = null;

	/** Set when another library patched over our wrappers; they then pass through untouched. */
	private interceptionInert = false;

	private readonly onExit = (): void => this.release();
	private readonly onResize = (): void => this.queueRedraw();
	private unregisterSignal: (() => void) | null = null;

	private get isTTY(): boolean {
		return Boolean(process.stderr.isTTY);
	}

	private get width(): number {
		return Math.max(20, (process.stderr.columns || 80) - 1);
	}

	private get height(): number {
		return Math.max(4, process.stderr.rows || 24);
	}

	/** Whether a region is on screen, so plain writes would be erased. */
	public get isLive(): boolean {
		return this.isTTY && this.lines.size > 0;
	}

	/** Writes to stderr, bypassing our own interception. */
	private emit(data: string): void {
		this.internalWrite = true;

		try {
			(this.originalStderr ?? process.stderr.write).call(process.stderr, data);

			// only printable text moves the column; erase sequences must not count as output
			const visible = Ansi.stripControl(data);

			if (visible.length) this.atLineStart = visible.endsWith('\n');
		} finally {
			this.internalWrite = false;
		}
	}

	/** Prints the theme banner to stderr once per process; a theme without one prints nothing. */
	public printBanner(): void {
		if (this.bannerShown || !getLoggerConfig().theme.banner.length) return;

		this.bannerShown = true;

		const style = new Style(process.stderr);

		// persisted, so a banner configured after live lines appeared still lands above them
		if (!this.isTTY) this.persist(Ansi.stripAnsi(style.wordmark()));
		else this.persist(`\n${style.banner().join('\n')}\n`);
	}

	/** Moves foreign stdout/stderr writes above the region so the next frame cannot erase them. */
	private interceptConsole(): void {
		if (this.originalStdout || !this.isTTY) return;

		// keep the unbound originals so restoring puts back the exact functions
		const stdout = process.stdout.write;
		const stderr = process.stderr.write;

		this.originalStdout = stdout;
		this.originalStderr = stderr;

		const wrap =
			(original: Write, stream: NodeJS.WriteStream) =>
			(...args: Parameters<Write>): boolean => {
				if (this.internalWrite || this.interceptionInert) return original.apply(stream, args);

				this.erase();

				const result = original.apply(stream, args);
				const chunk = args[0];

				if (typeof chunk === 'string' && chunk.length) this.atLineStart = chunk.endsWith('\n');
				else if (chunk instanceof Uint8Array && chunk.length) this.atLineStart = chunk[chunk.length - 1] === 0x0a;

				this.queueRedraw();

				return result;
			};

		this.wrapperStdout = wrap(stdout, process.stdout) as Write;
		this.wrapperStderr = wrap(stderr, process.stderr) as Write;

		process.stdout.write = this.wrapperStdout;
		process.stderr.write = this.wrapperStderr;
	}

	/** Unpatches stdout/stderr, or goes inert if another library has patched on top of us. */
	private restoreConsole(): void {
		if (!this.wrapperStdout && !this.wrapperStderr) return;

		const ownsStdout = this.wrapperStdout !== null && process.stdout.write === this.wrapperStdout;
		const ownsStderr = this.wrapperStderr !== null && process.stderr.write === this.wrapperStderr;

		if (ownsStdout && this.originalStdout) process.stdout.write = this.originalStdout;
		if (ownsStderr && this.originalStderr) process.stderr.write = this.originalStderr;

		this.interceptionInert = !(ownsStdout && ownsStderr);

		if (!this.interceptionInert) {
			this.wrapperStdout = this.wrapperStderr = this.originalStdout = this.originalStderr = null;
		}
	}

	/** Coalesces a burst of foreign writes into one redraw. */
	private queueRedraw(): void {
		if (this.redrawQueued || !this.lines.size) return;

		this.redrawQueued = true;

		setImmediate(() => {
			this.redrawQueued = false;
			this.redraw();
		});
	}

	private hideCursor(): void {
		if (!this.isTTY || this.cursorHidden) return;

		this.emit('\x1B[?25l');
		this.cursorHidden = true;

		process.once('exit', this.onExit);
		process.stderr.on('resize', this.onResize);
		this.unregisterSignal ??= SignalHandler.register(() => this.release());
	}

	/** Screen rows the region takes now: a narrower terminal rewraps each drawn row onto several. */
	private drawnRows(): number {
		const columns = process.stderr.columns || 80;

		return this.drawnWidths.reduce((rows, width) => rows + Math.max(1, Math.ceil(width / columns)), 0);
	}

	private erase(): void {
		const rows = this.drawnRows();

		if (!rows) return;

		// cursor-up stops at the top row, so a region taller than the screen is cleared from there
		this.emit(`\x1B[${rows}A\x1B[0J`);
		this.drawnWidths = [];
	}

	/** Splits multi-line text into rows cut to the terminal width. */
	private rows(lines: string[]): string[] {
		return lines.flatMap((line) => line.replace(/\r/g, '').split('\n')).map((line) => Ansi.truncate(line, this.width));
	}

	private redraw(): void {
		if (this.redrawing) return;

		this.redrawing = true;

		try {
			// clamp to the viewport: rows scrolled off the top can no longer be erased
			const body = this.rows([...this.lines.values()]).slice(0, this.height - 1);

			this.hideCursor();
			this.erase();

			if (!body.length) return;

			if (!this.atLineStart) this.emit('\n');

			this.emit(`${body.join('\n')}\n`);
			this.drawnWidths = body.map((line) => Ansi.stripAnsi(line).length);
		} finally {
			this.redrawing = false;
		}
	}

	/** Replaces one owner's live line; without a TTY the line is appended instead. */
	public setLine(owner: symbol, line: string, captureConsole = true): void {
		if (!this.isTTY) {
			this.emit(`${line}\n`);
			return;
		}

		this.lines.set(owner, line);

		if (captureConsole) this.interceptConsole();

		this.redraw();
	}

	/** Leaves an owner's last line on screen as permanent output; the terminal is restored once no line is live. */
	public end(owner: symbol): void {
		const last = this.lines.get(owner);

		this.lines.delete(owner);

		if (last === undefined || !this.isTTY) return;

		this.erase();
		this.emit(`${this.rows([last]).join('\n')}\n`);
		this.redraw();

		if (!this.lines.size) this.release();
	}

	/** Writes a permanent line above the region; colors are left as the caller styled them. */
	public persist(line: string): void {
		if (!this.isLive) {
			this.emit(`${line}\n`);
			return;
		}

		this.erase();
		this.emit(`${line}\n`);
		this.redraw();
	}

	/** Restores the cursor and console. */
	public release(): void {
		process.removeListener('exit', this.onExit);
		process.stderr.removeListener('resize', this.onResize);

		this.unregisterSignal?.();
		this.unregisterSignal = null;

		if (this.cursorHidden) {
			this.emit('\x1B[?25h');
			this.cursorHidden = false;
		}

		this.drawnWidths = [];
		this.restoreConsole();
	}
}
