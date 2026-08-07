import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
const provider = createOpenAI({ baseURL: "http://127.0.0.1:11434/v1", apiKey: "ollama" });
const result = await generateText({ model: provider("qwen3:0.6b"), prompt: "Reply with exactly one word: swapped.", maxOutputTokens: 512 });
console.log(JSON.stringify({ text: result.text.slice(0, 120), finishReason: result.finishReason, usage: result.usage }));
