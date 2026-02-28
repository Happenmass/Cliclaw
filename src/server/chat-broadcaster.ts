import type { WebSocket } from "ws";
import { logger } from "../utils/logger.js";

export interface ChatMessage {
	type: string;
	[key: string]: any;
}

/**
 * Manages WebSocket client connections and broadcasts messages to all clients.
 */
export class ChatBroadcaster {
	private clients: Set<WebSocket> = new Set();

	addClient(ws: WebSocket): void {
		this.clients.add(ws);
		logger.info("chat-broadcaster", `Client connected (total: ${this.clients.size})`);
	}

	removeClient(ws: WebSocket): void {
		this.clients.delete(ws);
		logger.info("chat-broadcaster", `Client disconnected (total: ${this.clients.size})`);
	}

	broadcast(message: ChatMessage): void {
		const data = JSON.stringify(message);
		for (const client of this.clients) {
			if (client.readyState === 1) {
				// WebSocket.OPEN
				client.send(data);
			}
		}
	}

	getClientCount(): number {
		return this.clients.size;
	}
}
