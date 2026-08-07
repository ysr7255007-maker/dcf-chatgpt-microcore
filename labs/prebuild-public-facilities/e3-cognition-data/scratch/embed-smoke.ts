import { getEmbedder, EMBEDDING_BACKEND } from "../source/embed.ts";
const embed = await getEmbedder();
const vecs = await embed(["认知权威与派生检索必须分离", "今天天气不错"]);
console.log("backend:", EMBEDDING_BACKEND.model, "dims:", vecs[0].length);
console.log("sample:", vecs[0].slice(0, 3).map((x) => x.toFixed(4)).join(","));
