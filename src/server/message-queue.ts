/**
 * Message queue for human messages received during EXECUTING state.
 * Messages are drained and injected into conversation between tool-use rounds.
 */
export class MessageQueue {
	private queue: string[] = [];

	enqueue(content: string): void {
		this.queue.push(content);
	}

	drain(): string[] {
		const messages = this.queue.slice();
		this.queue = [];
		return messages;
	}

	isEmpty(): boolean {
		return this.queue.length === 0;
	}
}
