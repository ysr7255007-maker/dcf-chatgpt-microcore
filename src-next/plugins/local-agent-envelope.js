'use strict';

const TASK_OPEN = '[DCF_LOCAL_TASK]';
const TASK_CLOSE = '[/DCF_LOCAL_TASK]';
const RESULT_OPEN = '[DCF_LOCAL_RESULT]';
const RESULT_CLOSE = '[/DCF_LOCAL_RESULT]';

function validateTask(value) {
  if (!value || value.schema !== 'dcf.local-task.v1') throw new Error('local_task_schema_invalid');
  if (typeof value.instruction !== 'string' || !value.instruction.trim()) throw new Error('local_task_instruction_required');
  if (value.workspace !== undefined && (typeof value.workspace !== 'string' || !value.workspace.trim())) throw new Error('local_task_workspace_invalid');
  return {
    ...value,
    instruction: value.instruction.trim(),
    workspace: value.workspace === undefined ? undefined : value.workspace.trim()
  };
}

function extractLocalTaskEnvelopes(text) {
  const source = String(text || '');
  const tasks = [];
  const errors = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf(TASK_OPEN, cursor);
    if (start < 0) break;
    const contentStart = start + TASK_OPEN.length;
    const end = source.indexOf(TASK_CLOSE, contentStart);
    if (end < 0) {
      errors.push({ code: 'local_task_envelope_unclosed', start });
      break;
    }
    const raw = source.slice(contentStart, end).trim();
    try {
      const task = validateTask(JSON.parse(raw));
      tasks.push({ task, raw, start, end: end + TASK_CLOSE.length });
    } catch (error) {
      errors.push({ code: error?.message || 'local_task_invalid', start });
    }
    cursor = end + TASK_CLOSE.length;
  }

  return { tasks, errors };
}

function buildLocalResultEnvelope(result) {
  const value = {
    ...result,
    schema: 'dcf.local-result.v1'
  };
  return `${RESULT_OPEN}\n${JSON.stringify(value, null, 2)}\n${RESULT_CLOSE}`;
}

module.exports = {
  TASK_OPEN,
  TASK_CLOSE,
  RESULT_OPEN,
  RESULT_CLOSE,
  validateTask,
  extractLocalTaskEnvelopes,
  buildLocalResultEnvelope
};
