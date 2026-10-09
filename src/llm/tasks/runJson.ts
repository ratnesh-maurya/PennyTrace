/**
 * Shared runner: one schema-constrained, greedy, no-thinking chat completion.
 * Returns the parsed JSON, or undefined on any failure (no model, unloaded,
 * timeout, malformed output). Callers degrade to null / templates.
 */
import { complete, isAvailable } from '../modelManager';
import { extractJson, type JsonSchema } from '../schemas';

export interface JsonTask {
  system: string;
  user: string;
  schema: JsonSchema;
  maxTokens: number;
}

export async function runJson(task: JsonTask): Promise<unknown> {
  if (!isAvailable()) {
    return undefined;
  }
  try {
    const res = await complete({
      messages: [
        { role: 'system', content: task.system },
        { role: 'user', content: task.user },
      ],
      response_format: { type: 'json_schema', json_schema: { schema: task.schema, strict: true } },
      n_predict: task.maxTokens,
    });
    if (res.interrupted || res.context_full) {
      return undefined;
    }
    return extractJson(res.content || res.text);
  } catch {
    return undefined;
  }
}
