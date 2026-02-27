import { ensureConfigDir, loadConfig, saveConfig } from "../utils/config.js";
import { TUIRenderer } from "./components/renderer.js";
import { ConfigView } from "./config-view.js";

export async function runConfigTUI(): Promise<void> {
	await ensureConfigDir();
	const config = await loadConfig();

	const renderer = new TUIRenderer();

	return new Promise<void>((resolve) => {
		const configView = new ConfigView(config, {
			onSave: async (updatedConfig) => {
				await saveConfig(updatedConfig);
			},
			onClose: () => {
				renderer.stop();
				resolve();
			},
		});

		renderer.setRoot(configView);
		renderer.setInputHandler((data: string) => {
			configView.handleInput(data);
			renderer.requestRender();
		});

		renderer.start();
	});
}
