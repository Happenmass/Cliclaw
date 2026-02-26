import { sha256 } from "./store.js";
import type { MemoryChunk } from "./types.js";

export interface ChunkingConfig {
	/** Max tokens per chunk (default 400) */
	tokens: number;
	/** Overlap tokens between adjacent chunks (default 80) */
	overlap: number;
}

const DEFAULT_CHUNKING: ChunkingConfig = { tokens: 400, overlap: 80 };

/**
 * Split Markdown content into overlapping chunks suitable for embedding.
 *
 * Algorithm:
 * 1. Accumulate lines until maxChars is reached
 * 2. Flush current chunk
 * 3. Carry overlap lines into the next chunk
 * 4. Repeat
 */
export function chunkMarkdown(content: string, config: Partial<ChunkingConfig> = {}): MemoryChunk[] {
	const chunking = { ...DEFAULT_CHUNKING, ...config };
	const lines = content.split("\n");
	const maxChars = Math.max(32, chunking.tokens * 4);
	const overlapChars = Math.max(0, chunking.overlap * 4);
	const chunks: MemoryChunk[] = [];

	let current: Array<{ line: string; lineNo: number }> = [];
	let currentChars = 0;

	const flush = () => {
		if (current.length === 0) return;
		const text = current.map((e) => e.line).join("\n");
		chunks.push({
			startLine: current[0].lineNo,
			endLine: current[current.length - 1].lineNo,
			text,
			hash: sha256(text),
		});
	};

	const carryOverlap = () => {
		if (overlapChars <= 0) {
			current = [];
			currentChars = 0;
			return;
		}
		let acc = 0;
		const kept: Array<{ line: string; lineNo: number }> = [];
		for (let i = current.length - 1; i >= 0; i--) {
			acc += current[i].line.length + 1;
			kept.unshift(current[i]);
			if (acc >= overlapChars) break;
		}
		current = kept;
		currentChars = kept.reduce((sum, e) => sum + e.line.length + 1, 0);
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = i + 1; // 1-indexed
		const lineSize = line.length + 1;

		if (currentChars + lineSize > maxChars && current.length > 0) {
			flush();
			carryOverlap();
		}

		current.push({ line, lineNo });
		currentChars += lineSize;
	}

	flush();
	return chunks;
}
