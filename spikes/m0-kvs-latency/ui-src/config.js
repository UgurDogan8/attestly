/**
 * Spike M0-6 config-panel probe. Bundled with esbuild into static/ui/config.js.
 * Answers, from inside a real macro config modal:
 *   1. does view.getContext() expose the draft/page contentId?
 *   2. does invoke() reach our resolver from a config resource?
 *   3. does view.submit({config}) close & store, does view.close() cancel?
 */
import { view, invoke } from '@forge/bridge';

const log = (msg) => {
  document.getElementById('log').textContent += msg + '\n';
};

(async () => {
  try {
    const ctx = await view.getContext();
    log('contentId from context: ' + (ctx.extension?.content?.id ?? '(none)'));
    log('existing config: ' + JSON.stringify(ctx.extension?.config ?? null));
  } catch (e) {
    log('getContext ERROR: ' + e.message);
  }
  try {
    const r = await invoke('ping', { from: 'config-panel' });
    log('invoke(ping): ' + JSON.stringify(r));
  } catch (e) {
    log('invoke ERROR: ' + e.message);
  }
})();

document.getElementById('save').addEventListener('click', () => {
  view.submit({ config: { spikeSavedAt: 'M0-6' } }).catch((e) => log('submit ERROR: ' + e.message));
});
document.getElementById('cancel').addEventListener('click', () => {
  view.close().catch((e) => log('close ERROR: ' + e.message));
});
