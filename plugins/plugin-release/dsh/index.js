// DeepSeek Harness entry for the plugin-release Claude Code plugin: its skill is read from the plugin tree as is.
import { createPlugin, rootFrom } from 'claude-plugin-dsh'

const plugin = createPlugin({ root: rootFrom(import.meta.url) })
export const { name, apply } = plugin
export default plugin
