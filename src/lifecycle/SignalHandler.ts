/** Cleanup to run before exiting on a signal. */
export type ShutdownTask = () => Promise<void> | void;

/** Single owner of SIGINT/SIGTERM: runs every task (5s cap), then exits 130 once; a second Ctrl+C exits at once. */
export class SignalHandler {
	private static readonly GRACE_MS = 5000;

	private static readonly tasks = new Set<ShutdownTask>();

	private static installed = false;

	private static shuttingDown = false;

	/** Adds a task; returns its remover. */
	public static register(task: ShutdownTask): () => void {
		SignalHandler.tasks.add(task);
		SignalHandler.install();

		return () => {
			SignalHandler.tasks.delete(task);

			if (!SignalHandler.tasks.size) SignalHandler.uninstall();
		};
	}

	private static readonly onSignal = (): void => {
		if (SignalHandler.shuttingDown) process.exit(130);

		SignalHandler.shuttingDown = true;

		const grace = new Promise<void>((resolve) => setTimeout(resolve, SignalHandler.GRACE_MS).unref());
		const drain = Promise.allSettled([...SignalHandler.tasks].map(async (task) => task()));

		void Promise.race([drain, grace]).then(() => process.exit(130));
	};

	private static install(): void {
		if (SignalHandler.installed) return;

		process.on('SIGINT', SignalHandler.onSignal);
		process.on('SIGTERM', SignalHandler.onSignal);
		SignalHandler.installed = true;
	}

	private static uninstall(): void {
		if (!SignalHandler.installed) return;

		process.off('SIGINT', SignalHandler.onSignal);
		process.off('SIGTERM', SignalHandler.onSignal);
		SignalHandler.installed = false;
	}
}
