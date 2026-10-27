import { EventEmitter } from 'node:events';
import { getLoggerConfig, type LogMode } from '../logger/config';
import { SegraLogger } from '../logger/SegraLogger';
import { Style } from '../theme/Style';
import { type Tone } from '../theme/Theme';
import { Format } from './Format';

export type TransferStatus = 'active' | 'done' | 'failed';

/** Fields a `transfer()` call may report; anything left out keeps its last value. */
export interface TransferUpdate {
	label?: string;
	bytes?: number;
	/** Expected size, or 0 when the source declares none. */
	totalBytes?: number;
	segments?: number;
	totalSegments?: number;
	status?: TransferStatus;
}

export interface TransferSnapshot {
	key: string;
	label: string;
	status: TransferStatus;
	bytes: number;
	totalBytes: number;
	segments: number;
	totalSegments: number;
	/** Smoothed bytes per second. */
	speed: number;
	/** Seconds remaining, or 0 when it cannot be estimated. */
	eta: number;
}

export interface ProgressSnapshot {
	status: string;
	tone: Tone;
	counts: Record<string, { done: number; total: number }>;
	details: Record<string, { value: string; tone?: Tone }>;
	message: string;
	/** Active transfers plus the last few finished ones. */
	transfers: TransferSnapshot[];
	/** Totals across transfers; `totalBytes` is 0 unless every transfer declares a size. */
	bytes: number;
	totalBytes: number;
	segments: number;
	totalSegments: number;
	speed: number;
	/** The slowest active transfer's ETA. */
	eta: number;
	ended: boolean;
	startedAt: number;
}

export interface ProgressOptions {
	/** Overrides the configured mode for this progress only. */
	mode?: LogMode;
	/** Draws output; when false only `update` events are emitted. Defaults to true. */
	display?: boolean;
	/** In live mode, move foreign stdout/stderr writes above the panel. Defaults to true. */
	captureConsole?: boolean;
}

type Transfer = TransferSnapshot & { startedAt: number; updatedAt: number };

/** Job progress drawn with the configured theme: a panel redrawn in place in live mode, a summary line in append mode. */
export class SegraProgress extends EventEmitter<{ update: [ProgressSnapshot] }> {
	private static readonly PANEL_MS = 500;
	private static readonly SUMMARY_MS = 2000;
	private static readonly SMOOTHING = 0.3;
	private static readonly FINISHED_KEPT = 3;
	private static readonly SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

	private readonly transfers = new Map<string, Transfer>();
	private state = SegraProgress.blank();
	private logger?: SegraLogger;
	private lastRender = 0;
	private lastLine = '';
	/** Trailing redraw for updates that arrived inside the throttle window. */
	private pending?: NodeJS.Timeout;
	private tick = 0;

	constructor(
		public readonly context = 'Progress',
		private options: ProgressOptions = {}
	) {
		super();
	}

	private static blank(): Omit<ProgressSnapshot, 'transfers' | 'bytes' | 'totalBytes' | 'segments' | 'totalSegments' | 'speed' | 'eta'> {
		return { status: '', tone: 'accent', counts: {}, details: {}, message: '', ended: false, startedAt: Date.now() };
	}

	/** Begins a new run, clearing every row; `options` replace the constructor's for this run. */
	public start(options: ProgressOptions = {}): void {
		clearTimeout(this.pending);
		this.pending = undefined;
		this.logger?.end();
		this.logger = undefined;
		this.options = { ...this.options, ...options };
		this.state = SegraProgress.blank();
		this.transfers.clear();
		this.lastRender = 0;
		this.lastLine = '';
	}

	/** Sets the heading, e.g. `DOWNLOADING`. */
	public status(text: string, tone: Tone = 'accent'): void {
		if (this.state.ended) return;

		const changed = text !== this.state.status;

		this.state.status = text;
		this.state.tone = tone;
		this.changed(changed);
	}

	/** Sets a counter row such as `Items 3/178`. */
	public count(label: string, done: number, total: number): void {
		if (this.state.ended) return;

		this.state.counts[label] = { done, total };
		this.changed();
	}

	/** Reports one transfer; rate and ETA are worked out from successive calls. */
	public transfer(key: string, update: TransferUpdate): void {
		if (this.state.ended) return;

		const now = Date.now();
		const entry: Transfer = this.transfers.get(key) ?? {
			key,
			label: key,
			status: 'active',
			bytes: 0,
			totalBytes: 0,
			segments: 0,
			totalSegments: 0,
			speed: 0,
			eta: 0,
			startedAt: now,
			updatedAt: now
		};

		if (update.bytes !== undefined) {
			const elapsed = now - entry.updatedAt;
			const delta = update.bytes - entry.bytes;

			if (elapsed > 0 && delta >= 0) {
				const instant = (delta / elapsed) * 1000;

				entry.speed = entry.speed > 0 ? entry.speed * (1 - SegraProgress.SMOOTHING) + instant * SegraProgress.SMOOTHING : instant;
			}
		}

		Object.assign(entry, Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)), { updatedAt: now });

		entry.eta = SegraProgress.eta(entry, now);
		this.transfers.set(key, entry);
		this.retireFinished();
		this.changed(update.status !== undefined && update.status !== 'active');
	}

	/** Sets a `label value` row, e.g. the source URL; an empty value removes it. */
	public detail(label: string, value?: string | number, tone?: Tone): void {
		if (this.state.ended) return;

		if (value === undefined || value === '') delete this.state.details[label];
		else this.state.details[label] = { value: String(value), tone };

		this.changed();
	}

	/** Sets the free-text line under the panel. */
	public message(text: string): void {
		if (this.state.ended) return;

		this.state.message = text;
		this.changed();
	}

	/** Draws the final frame and keeps it on screen; later calls are ignored until `start()`. */
	public end(status?: string, tone?: Tone): void {
		if (this.state.ended) return;

		if (status !== undefined) this.state.status = status;
		if (tone !== undefined) this.state.tone = tone;

		this.state.ended = true;
		this.changed(true);
		this.logger?.end();
	}

	/** The current state, with totals rolled up from the transfers. */
	public get snapshot(): ProgressSnapshot {
		const transfers = [...this.transfers.values()].map(({ startedAt: _s, updatedAt: _u, ...transfer }) => transfer);
		const active = transfers.filter((transfer) => transfer.status === 'active');
		const rated = active.length ? active : transfers;
		const sized = transfers.length > 0 && transfers.every((transfer) => transfer.totalBytes > 0);
		const sum = (pick: (transfer: TransferSnapshot) => number) => transfers.reduce((total, transfer) => total + pick(transfer), 0);

		return {
			...this.state,
			counts: { ...this.state.counts },
			details: { ...this.state.details },
			transfers,
			bytes: sum((transfer) => transfer.bytes),
			totalBytes: sized ? sum((transfer) => transfer.totalBytes) : 0,
			segments: sum((transfer) => transfer.segments),
			totalSegments: sum((transfer) => transfer.totalSegments),
			speed: rated.reduce((total, transfer) => total + transfer.speed, 0),
			eta: rated.reduce((slowest, transfer) => Math.max(slowest, transfer.eta), 0)
		};
	}

	/** Prefers bytes remaining; segmented streams without a size fall back to segments per second. */
	private static eta(entry: Transfer, now: number): number {
		if (entry.status !== 'active') return 0;

		const remaining = entry.totalBytes > 0 ? Math.max(entry.totalBytes - entry.bytes, 0) : 0;

		if (entry.speed > 0 && remaining > 0) return remaining / entry.speed;

		const elapsed = (now - entry.startedAt) / 1000;

		if (!entry.totalSegments || entry.segments <= 0 || elapsed <= 0) return 0;

		return Math.max(entry.totalSegments - entry.segments, 0) / (entry.segments / elapsed);
	}

	/** Keeps only the newest finished transfers so the panel stays short. */
	private retireFinished(): void {
		const finished = [...this.transfers.values()].filter((transfer) => transfer.status !== 'active');

		finished
			.sort((a, b) => a.updatedAt - b.updatedAt)
			.slice(0, Math.max(0, finished.length - SegraProgress.FINISHED_KEPT))
			.forEach((transfer) => this.transfers.delete(transfer.key));
	}

	/** A panel only makes sense where it can be redrawn; elsewhere progress is one line per update. */
	private get usesPanel(): boolean {
		return (this.options.mode ?? getLoggerConfig().mode) === 'live' && Boolean(process.stderr.isTTY);
	}

	/** Emits the snapshot and redraws, throttled unless `force`: 500 ms for the panel, 2 s for summary lines. */
	private changed(force = false): void {
		const snapshot = this.snapshot;
		const now = Date.now();
		const wait = (this.usesPanel ? SegraProgress.PANEL_MS : SegraProgress.SUMMARY_MS) - (now - this.lastRender);

		this.emit('update', snapshot);

		if (this.options.display === false) return;

		// a throttled update is drawn once the window closes, so the last change is never lost
		if (!force && wait > 0) {
			this.pending ??= setTimeout(() => this.draw(), wait);
			return;
		}

		this.draw(snapshot);
	}

	private draw(snapshot = this.snapshot): void {
		clearTimeout(this.pending);
		this.pending = undefined;
		this.lastRender = Date.now();
		this.render(snapshot);
	}

	private render(snapshot: ProgressSnapshot): void {
		this.logger ??= new SegraLogger(this.context, { mode: this.options.mode, captureConsole: this.options.captureConsole ?? true });

		const style = new Style(process.stderr);

		if (this.usesPanel) {
			this.logger.log(this.panel(style, snapshot).join('\n'));
			return;
		}

		const line = this.summary(style, snapshot);

		if (line === this.lastLine) return;

		this.lastLine = line;
		this.logger.log(line);
	}

	private heading(style: Style, snapshot: ProgressSnapshot): string {
		this.tick += 1;

		const mark = snapshot.ended ? style.theme.icon : SegraProgress.SPINNER[this.tick % SegraProgress.SPINNER.length];

		return [style.accent(mark), snapshot.status && style.paint(snapshot.tone, snapshot.status)].filter(Boolean).join(' ');
	}

	/** The multi-line live panel; rows with nothing to show are left out. */
	private panel(style: Style, snapshot: ProgressSnapshot): string[] {
		const width = Math.max(24, (process.stderr.columns || 80) - 7);
		const row = (label: string, value: string) => `  ${style.muted(label.padEnd(10))} ${value}`;
		const lines = [this.heading(style, snapshot), ''];

		for (const [label, { done, total }] of Object.entries(snapshot.counts))
			lines.push(row(label, Format.countTrack(style, done, total)));

		if (snapshot.totalSegments) lines.push(row('Segments', Format.countTrack(style, snapshot.segments, snapshot.totalSegments)));

		if (snapshot.bytes || snapshot.totalBytes) {
			lines.push(row('Download', Format.byteTrack(style, snapshot.bytes, snapshot.totalBytes, snapshot.speed, snapshot.eta)));
		}

		const details = Object.entries(snapshot.details);

		if (details.length) lines.push('');

		for (const [label, { value, tone }] of details) {
			const paint = (text: string) => (tone ? style.paint(tone, text) : style.dim(text));
			const [first = '', ...rest] = Format.wrap(Format.shortUrl(value), width - 6);

			lines.push(row(label, paint(first)), ...rest.map((continuation) => `${' '.repeat(13)}${paint(continuation)}`));
		}

		if (snapshot.transfers.length) lines.push('', ...this.transferRows(style, snapshot.transfers));

		if (snapshot.message) {
			const [first = '', ...rest] = Format.wrap(snapshot.message, width);

			lines.push('', `  ${style.accent('›')} ${style.dim(first)}`, ...rest.map((continuation) => `    ${style.dim(continuation)}`));
		}

		lines.push('');

		return lines;
	}

	/** One row per transfer, so parallel downloads each show their own numbers. */
	private transferRows(style: Style, transfers: TransferSnapshot[]): string[] {
		const labelWidth = Math.min(28, Math.max(8, ...transfers.map((transfer) => transfer.label.length)));

		return transfers.map((transfer) => {
			const label =
				transfer.label.length > labelWidth ? `${transfer.label.slice(0, labelWidth - 1)}…` : transfer.label.padEnd(labelWidth);

			// segmented streams know their segment ratio but not their byte total
			const bySegments = transfer.totalBytes <= 0 && transfer.totalSegments > 0;
			const done = bySegments ? transfer.segments : transfer.bytes;
			const total = bySegments ? transfer.totalSegments : transfer.totalBytes;

			const cells = [
				Format.bar(style, done, total, 18),
				Format.percent(done, total),
				style.bold(Format.bytes(transfer.bytes).padStart(9))
			];

			if (transfer.status === 'active') {
				cells.push(style.muted(Format.speed(transfer.speed).padStart(11)), style.muted(`ETA ${Format.duration(transfer.eta)}`));
			} else {
				cells.push(transfer.status === 'failed' ? style.danger('✖ failed') : style.success('✔ done'));
			}

			return `  ${style.dim(label)}  ${cells.join('  ')}`;
		});
	}

	/** One line for append mode and non-TTY output. */
	private summary(style: Style, snapshot: ProgressSnapshot): string {
		const parts = [snapshot.status && style.paint(snapshot.tone, snapshot.status)];

		for (const [label, { done, total }] of Object.entries(snapshot.counts)) parts.push(`${label} ${done}/${total}`);

		if (snapshot.totalSegments) parts.push(`Segments ${snapshot.segments}/${snapshot.totalSegments}`);

		if (snapshot.bytes || snapshot.totalBytes) {
			parts.push(
				snapshot.totalBytes
					? `${Format.bytes(snapshot.bytes)} / ${Format.bytes(snapshot.totalBytes)}`
					: Format.bytes(snapshot.bytes)
			);

			if (!snapshot.ended) parts.push(Format.speed(snapshot.speed), `ETA ${Format.duration(snapshot.eta)}`);
		}

		for (const [label, { value, tone }] of Object.entries(snapshot.details)) {
			parts.push(`${label} ${tone ? style.paint(tone, value) : Format.shortUrl(value)}`);
		}

		if (snapshot.message) parts.push(style.dim(`› ${snapshot.message}`));

		return parts.filter(Boolean).join('  ');
	}
}
