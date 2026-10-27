<p align="center">
	<img src="public/icons/segra-logger.svg" alt="segra-logger" width="128" height="128">
</p>

# Segra Logger

`segra-logger` prints branded output for Segra and any other Node CLI. You set your branding once, then just log. Node.js 22 or newer is required, and there are no runtime dependencies.

## Install

```sh
npm install segra-logger

pnpm install segra-logger
```

## Setup, once

```ts
import { SegraLogger } from 'segra-logger';

const logger = SegraLogger.create({
	theme: { name: 'ACME', icon: '▲', banner: ['ACME', 'Welcome to ACME'], palette: { accent: '35' } },
	level: 'DEBUG', // DEBUG | INFO | WARN | ERROR | SILENT, default INFO
	file: 'app.log', // optional: also append uncolored lines here
	banner: true, // print the banner once at startup
	mode: 'append' // 'append' (default) or 'live'
});
```

Every option is optional. Anything you leave out of `theme` keeps the Segra default. If you change `name`, the default SEGRA banner and tagline are dropped, so they never show under your brand.

## Two ways to print

Both modes use the same logger and the same branded line. Only `mode` changes. Set it for every logger in `create()`, or for one logger with `new SegraLogger('Context', { mode })`.

```ts
class HlsDownloader {
	private readonly logger = new SegraLogger(HlsDownloader.name);

	run() {
		this.logger.log('resolved %d segments', 42);
		this.logger.warn('retrying');
		SegraLogger.error('static calls work too');
	}
}
```

The methods are `debug`, `log` (same as `info`), `info`, `warn` and `error`, on an instance or as statics. A logger created before `create()` runs, for example at import time, still picks up its settings. Everything goes to stderr, so stdout stays free for data.

### `mode: 'append'` (default, NestJS style)

Each call adds a line:

```
[ACME] 4821  - 2026-10-27T12:23:12+0530  INFO [HlsDownloader] resolved 42 segments
[ACME] 4821  - 2026-10-27T12:23:12+0530  WARN [HlsDownloader] retrying
[ACME] 4821  - 2026-10-27T12:23:12+0530 ERROR static calls work too
```

### `mode: 'live'` (curl style)

Each `debug`, `log` or `info` call clears that logger's previous line and writes the new one in its place, under the banner. Use it for progress:

```ts
const download = new SegraLogger('Download', { mode: 'live' });

for (const [index, segment] of segments.entries()) {
	download.log('segment %d/%d', index + 1, segments.length); // rewrites the same line
}
```

- Each logger keeps its own line, so concurrent jobs stack instead of overwriting each other.
- `warn` and `error` are always appended above the live lines, so a problem isn't wiped by the next update. The same goes for append-mode loggers and plain `console.log` calls.
- The last line stays on screen, and the cursor is restored on exit and on Ctrl+C. Register your own cleanup with `SignalHandler.register()` so only one place decides when the process exits.
- Without a TTY (piped or in CI), live lines are appended like append mode.

## Color

Colors come from the theme `palette`, written as ANSI SGR parameters such as `35` or `38;5;44`. Output is uncolored when `NO_COLOR` is set, when `TERM=dumb`, or when the stream is not a TTY. `FORCE_COLOR=1` turns color back on. To color your own text with the theme, use `new Style().accent('text')`.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test   # builds, then checks the brand name, banner, levels, log file and both modes
```
