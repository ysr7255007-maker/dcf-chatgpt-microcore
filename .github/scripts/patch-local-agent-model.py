from pathlib import Path

path = Path('chrome-extension/code-units/local-agent/main.js')
text = path.read_text()

old_version = "const UNIT_VERSION = '1.0.0-rc.2-local-agent.2';"
if old_version not in text:
    raise SystemExit('unexpected Local Agent version')
text = text.replace(old_version, "const UNIT_VERSION = '1.0.0-rc.2-local-agent.3';", 1)

needle = """  function normalizeModel(value) {
    if (!value || typeof value !== 'object') return null;
    const providerID = String(value.providerID || '').trim();
    const modelID = String(value.modelID || '').trim();
    return providerID && modelID ? { providerID, modelID } : null;
  }
"""
replacement = needle + """
  function encodeModelValue(value) {
    const model = normalizeModel(value);
    return model ? encodeURIComponent(JSON.stringify(model)) : '';
  }

  function decodeModelValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try { return normalizeModel(JSON.parse(decodeURIComponent(raw))); }
    catch (_) { return null; }
  }

  function modelOptionsForRender(models, savedModel) {
    const options = Array.isArray(models) ? [...models] : [];
    const saved = normalizeModel(savedModel);
    if (!saved) return options;
    const savedValue = encodeModelValue(saved);
    if (options.some((item) => encodeModelValue(item) === savedValue)) return options;
    return [{ ...saved, label: `已保存 · ${saved.providerID} / ${saved.modelID}`, persisted_only: true }, ...options];
  }
"""
if needle not in text:
    raise SystemExit('normalizeModel block not found')
text = text.replace(needle, replacement, 1)

old_save = """    const modelValue = root.querySelector('[data-field=\"model\"]').value;
    let model = null;
    if (modelValue) {
      const [providerID, modelID] = modelValue.split('\\u0000');
      if (providerID && modelID) model = { providerID, modelID };
    }
"""
new_save = """    const modelValue = root.querySelector('[data-field=\"model\"]').value;
    const model = decodeModelValue(modelValue);
"""
if old_save not in text:
    raise SystemExit('saveAndConnect model block not found')
text = text.replace(old_save, new_save, 1)

old_render = """    const agents = agentOptions();
    const models = modelOptions();
    const currentModel = state.config.model ? `${state.config.model.providerID}\\u0000${state.config.model.modelID}` : '';
"""
new_render = """    const agents = agentOptions();
    const models = modelOptionsForRender(modelOptions(), state.config.model);
    const currentModel = encodeModelValue(state.config.model);
"""
if old_render not in text:
    raise SystemExit('render model header not found')
text = text.replace(old_render, new_render, 1)

old_option = "const value = `${item.providerID}\\u0000${item.modelID}`;"
if old_option not in text:
    raise SystemExit('model option encoding not found')
text = text.replace(old_option, 'const value = encodeModelValue(item);', 1)

path.write_text(text)
