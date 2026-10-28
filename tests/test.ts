import { Inumaki } from '../src/logger/Inumaki';

const logger = Inumaki.create({
	mode: 'live',
	theme: {
		icon: '⬇',
		tagline: 'segmented media transfer',
		palette: {
			accent: '38;5;44',
			success: '38;5;42',
			warn: '38;5;214',
			danger: '38;5;203',
			muted: '38;5;245'
		}
	}
});
logger.log('log message 1');
logger.log('log message 2');
logger.log('Log message 3');
logger.log('log message 4');
logger.log('log message 5');
logger.log('log message 6');
logger.log('log message 7');
logger.log('log message 8');
logger.log('log message 9');
logger.log('log message 10');
logger.log('log message 11');
logger.log('log message 12');

// logger.end();
