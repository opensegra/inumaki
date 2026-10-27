import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dist = new URL('../dist/index.js', import.meta.url).href;

/** Runs a snippet against the build in a fresh process, uncolored. */
function run(body) {
	const script = `import { SegraLogger } from '${dist}';\n${body}`;
	const { stdout, stderr, status } = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined }
	});

	assert.equal(status, 0, stderr);

	return { stdout, stderr };
}

test('default theme brands every line with SEGRA', () => {
	const { stderr } = run(`new SegraLogger('Downloader').log('hello');`);

	assert.match(stderr, /^\[SEGRA\] \d+ {2}- \S+ {2}INFO \[Downloader\] hello$/m);
});

test('create() brands lines and the banner with the configured name', () => {
	const { stderr } = run(`
		const logger = SegraLogger.create({ theme: { name: 'ACME', icon: '▲' }, banner: true });
		logger.info('ready');
		new SegraLogger('Worker').warn('slow');
		SegraLogger.error('static');
	`);
	const lines = stderr.trimEnd().split('\n');

	assert.equal(lines[0], '▲ ACME');
	assert.match(lines[1], /^\[ACME\] .* INFO ready$/);
	assert.match(lines[2], /^\[ACME\] .* WARN \[Worker\] slow$/);
	assert.match(lines[3], /^\[ACME\] .*ERROR static$/);
	assert.doesNotMatch(stderr, /SEGRA|segmented media transfer/);
});

test('loggers created before create() follow it', () => {
	const { stderr } = run(`
		const early = new SegraLogger('Early');
		early.debug('hidden');
		SegraLogger.create({ theme: { name: 'ACME' }, level: 'DEBUG' });
		early.debug('shown');
	`);

	assert.doesNotMatch(stderr, /hidden/);
	assert.match(stderr, /^\[ACME\] .*DEBUG \[Early\] shown$/m);
});

test('the log file gets the same branded line without color', () => {
	const file = join(mkdtempSync(join(tmpdir(), 'segra-logger-')), 'app.log');

	run(`SegraLogger.create({ theme: { name: 'ACME' }, file: ${JSON.stringify(file)} }).log('saved');`);

	assert.match(readFileSync(file, 'utf8'), /^\[ACME\] \d+ {2}- \S+ {2}INFO saved\n$/);
});

test('live mode is set once in create() and falls back to appending without a TTY', () => {
	const { stdout, stderr } = run(`
		const logger = SegraLogger.create({ theme: { name: 'ACME', icon: '▲' }, banner: true, mode: 'live' });
		logger.log('segment 1/2');
		logger.log('segment 2/2');
	`);
	const lines = stderr.trimEnd().split('\n');

	assert.equal(stdout, '');
	assert.equal(lines[0], '▲ ACME');
	assert.match(lines[1], /^\[ACME\] .* INFO segment 1\/2$/);
	assert.match(lines[2], /^\[ACME\] .* INFO segment 2\/2$/);
});

test('a single logger can opt into live mode', () => {
	const { stderr } = run(`
		SegraLogger.create({ theme: { name: 'ACME' } });
		console.error(new SegraLogger('Download', { mode: 'live' }).mode, new SegraLogger('Api').mode);
	`);

	assert.match(stderr, /^live append$/m);
});
