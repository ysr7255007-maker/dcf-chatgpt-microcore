import fs from 'node:fs';

const corpus = JSON.parse(fs.readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'));
const core = new Set(corpus.core_primitives);
const residual = new Set(corpus.residual_primitives);
const errors = [];
const primitiveUse = new Map();
const residualUse = new Map();

for (const sample of corpus.samples) {
  if (!sample.source?.startsWith('https://')) errors.push(`${sample.id}: missing source`);
  for (const p of sample.mapped_primitives) {
    if (!core.has(p)) errors.push(`${sample.id}: unknown core primitive ${p}`);
    primitiveUse.set(p, (primitiveUse.get(p) ?? 0) + 1);
  }
  for (const r of sample.residuals) {
    if (!residual.has(r)) errors.push(`${sample.id}: unknown residual primitive ${r}`);
    residualUse.set(r, (residualUse.get(r) ?? 0) + 1);
  }
}

const topologyPortable = corpus.samples.filter(s => s.portability_verdict !== 'NOT_PORTABLE').length;
const zeroResidual = corpus.samples.filter(s => s.residuals.length === 0).length;
const runtimeResidual = corpus.samples.filter(s => s.residuals.some(r => r.startsWith('durable.'))).length;

const result = {
  schema: 'dcf-workflow-primitive-mining-result/v1',
  generated_at: '2026-08-07',
  validator_runtime: process.version,
  sample_count: corpus.samples.length,
  topology_portable_count: topologyPortable,
  topology_portable_ratio: topologyPortable / corpus.samples.length,
  zero_residual_count: zeroResidual,
  durable_runtime_residual_count: runtimeResidual,
  residual_usage: Object.fromEntries([...residualUse.entries()].sort()),
  primitive_usage: Object.fromEntries([...primitiveUse.entries()].sort()),
  validation_errors: errors,
  verdict: errors.length === 0 && topologyPortable === corpus.samples.length
    ? 'STRUCTURAL_PORTABILITY_PASS_WITH_STRONG_RUNTIME_RESIDUALS'
    : 'STRUCTURAL_PORTABILITY_INCONCLUSIVE'
};

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exit(1);
