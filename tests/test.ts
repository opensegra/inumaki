import { SegraLogger } from '../src/logger/SegraLogger';

const logger = SegraLogger.create({
	mode: 'append',
	banner: true
});
logger.info('ready');

logger.info('Debug message');
