/**
 * E3 — 固定 embedding backend（计划 [修订5]）。
 *
 * 一次性裁决并冻结：
 *   runtime  : @huggingface/transformers（ONNX，进程内，无 daemon）
 *   model    : Xenova/bge-small-zh-v1.5（中文语料适配，512 维）
 *   所有候选引擎与全部 chunk 策略共用同一份向量；
 *   本轮不以 DeepSeek Key 承担 embedding（其公开文档无通用 embedding API）。
 */
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_BACKEND = {
  runtime: "@huggingface/transformers (onnxruntime-node, in-process)",
  model: "Xenova/bge-small-zh-v1.5",
  dims: 512,
  pooling: "mean",
  normalize: true,
} as const;

let extractor: FeatureExtractionPipeline | null = null;

export async function getEmbedder(): Promise<(texts: string[]) => Promise<number[][]>> {
  if (!extractor) {
    extractor = (await pipeline(
      "feature-extraction",
      EMBEDDING_BACKEND.model,
    )) as FeatureExtractionPipeline;
  }
  return async (texts: string[]) => {
    const out: number[][] = [];
    // 小批量推理，避免单次内存尖峰
    for (let i = 0; i < texts.length; i += 8) {
      const batch = texts.slice(i, i + 8);
      const result = await extractor(batch, {
        pooling: EMBEDDING_BACKEND.pooling,
        normalize: EMBEDDING_BACKEND.normalize,
      });
      const arr = result.tolist() as number[][];
      out.push(...arr);
    }
    return out;
  };
}
