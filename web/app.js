// ─── CLIPilot Chat UI ──────────────────────────────

(function () {
	"use strict";

	const messagesEl = document.getElementById("messages");
	const inputEl = document.getElementById("input");
	const sendBtn = document.getElementById("send-btn");
	const statusDot = document.getElementById("status-dot");
	const statusText = document.getElementById("status-text");

	let ws = null;
	let currentAssistantEl = null; // The in-progress streaming message element
	let reconnectTimer = null;
	let agentState = "idle";

	// ─── WebSocket Connection ───────────────────────────

	function connect() {
		const protocol = location.protocol === "https:" ? "wss:" : "ws:";
		ws = new WebSocket(`${protocol}//${location.host}/ws`);

		ws.onopen = function () {
			setConnectionStatus("connected");
			loadHistory();
		};

		ws.onmessage = function (event) {
			let data;
			try {
				data = JSON.parse(event.data);
			} catch {
				return;
			}
			handleServerMessage(data);
		};

		ws.onclose = function () {
			setConnectionStatus("disconnected");
			scheduleReconnect();
		};

		ws.onerror = function () {
			// onclose will fire after this
		};
	}

	function scheduleReconnect() {
		if (reconnectTimer) return;
		reconnectTimer = setTimeout(function () {
			reconnectTimer = null;
			connect();
		}, 3000);
	}

	function setConnectionStatus(status) {
		statusDot.className = "";
		if (status === "connected") {
			statusDot.classList.add(agentState);
			statusText.textContent = agentState === "idle" ? "空闲" : "执行中...";
		} else {
			statusDot.classList.add("disconnected");
			statusText.textContent = "连接断开，正在重连...";
		}
	}

	// ─── History Loading ────────────────────────────────

	function loadHistory() {
		fetch("/api/history")
			.then(function (res) { return res.json(); })
			.then(function (messages) {
				messagesEl.innerHTML = "";
				currentAssistantEl = null;
				for (const msg of messages) {
					if (msg.role === "user") {
						const content = typeof msg.content === "string" ? msg.content : "[complex content]";
						// Skip system injections like [HUMAN] and [RESUME]
						if (content.startsWith("[HUMAN]") || content.startsWith("[RESUME]")) continue;
						addMessageBubble("user", content);
					} else if (msg.role === "assistant") {
						const text = extractText(msg.content);
						if (text) addMessageBubble("assistant", text);
					}
					// Skip tool messages in history display
				}
				scrollToBottom();
			})
			.catch(function () {
				// Silently fail — history is optional
			});
	}

	function extractText(content) {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter(function (b) { return b.type === "text"; })
				.map(function (b) { return b.text; })
				.join("");
		}
		return "";
	}

	// ─── Server Message Handling ────────────────────────

	function handleServerMessage(data) {
		switch (data.type) {
			case "assistant_delta":
				if (!currentAssistantEl) {
					currentAssistantEl = addMessageBubble("assistant", "");
				}
				currentAssistantEl.textContent += data.delta;
				scrollToBottom();
				break;

			case "assistant_done":
				if (currentAssistantEl) {
					// Render markdown on the completed message
					currentAssistantEl.innerHTML = renderMarkdown(currentAssistantEl.textContent);
					currentAssistantEl = null;
				}
				break;

			case "agent_update":
				addMessageBubble("agent-update", data.summary);
				scrollToBottom();
				break;

			case "tool_activity":
				addMessageBubble("tool-activity", data.summary);
				scrollToBottom();
				break;

			case "state":
				agentState = data.state;
				setConnectionStatus("connected");
				break;

			case "system":
				addMessageBubble("system", data.message);
				scrollToBottom();
				break;

			case "clear":
				messagesEl.innerHTML = "";
				currentAssistantEl = null;
				break;
		}
	}

	// ─── Message Rendering ──────────────────────────────

	function addMessageBubble(type, text) {
		const el = document.createElement("div");
		el.className = "msg " + type;

		if (type === "assistant" && text) {
			el.innerHTML = renderMarkdown(text);
		} else {
			el.textContent = text;
		}

		messagesEl.appendChild(el);
		return el;
	}

	function scrollToBottom() {
		requestAnimationFrame(function () {
			messagesEl.scrollTop = messagesEl.scrollHeight;
		});
	}

	// ─── Basic Markdown Rendering ───────────────────────

	function renderMarkdown(text) {
		// Escape HTML
		let html = text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");

		// Code blocks: ```...```
		html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (_match, _lang, code) {
			return "<pre><code>" + code.trim() + "</code></pre>";
		});

		// Inline code: `...`
		html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

		// Bold: **...**
		html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

		// Italic: *...*
		html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

		return html;
	}

	// ─── Input Handling ─────────────────────────────────

	function sendMessage() {
		const text = inputEl.value.trim();
		if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

		if (text.startsWith("/")) {
			// Slash command
			const name = text.slice(1).split(/\s+/)[0];
			ws.send(JSON.stringify({ type: "command", name: name }));
		} else {
			// Regular message
			ws.send(JSON.stringify({ type: "message", content: text }));
			addMessageBubble("user", text);
			scrollToBottom();
		}

		inputEl.value = "";
		inputEl.style.height = "auto";
	}

	// Enter to send, Shift+Enter for newline
	inputEl.addEventListener("keydown", function (e) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});

	sendBtn.addEventListener("click", sendMessage);

	// Auto-resize textarea
	inputEl.addEventListener("input", function () {
		this.style.height = "auto";
		this.style.height = Math.min(this.scrollHeight, 120) + "px";
	});

	// ─── Initialize ─────────────────────────────────────

	connect();
})();
