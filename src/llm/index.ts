/**
 * Public API of the on-device LLM layer.
 *
 * Everything degrades without a model: parseFallback → null, categorize → null,
 * summarize → deterministic template, answer → null. The app stays fully
 * functional; LLM features show a "Download model" call to action.
 *
 * Pure helpers (validation, templates, intent execution) are exported too and
 * have no native dependencies.
 */
import { parseFallback } from './tasks/parseFallback';
import { categorize } from './tasks/categorize';
import { summarize, summarizeDetailed } from './tasks/summarize';
import { answer, toIntent } from './tasks/chat';
import {
  cancelDownload,
  deleteModel,
  disposeModelManager,
  downloadModel,
  initModelManager,
  installedModels,
  isAvailable,
  loadModel,
  pauseDownload,
  refreshInstalled,
  resumeDownload,
  setActiveModel,
  setAllowMetered,
  unloadModel,
  verifyModel,
} from './modelManager';

export const llm = {
  isAvailable,
  parseFallback,
  categorize,
  summarize,
  summarizeDetailed,
  toIntent,
  answer,
};

export const modelManager = {
  init: initModelManager,
  dispose: disposeModelManager,
  refreshInstalled,
  installedModels,
  isAvailable,
  setActiveModel,
  setAllowMetered,
  download: downloadModel,
  pause: pauseDownload,
  resume: resumeDownload,
  cancel: cancelDownload,
  deleteModel,
  verifyModel,
  loadModel,
  unload: unloadModel,
};

export { useLlmStore } from './store';
export type { LlmStoreState } from './store';
export type { ModelEntry, ModelStatus } from './modelState';
export { MODEL_CATALOG, DEFAULT_MODEL_ID, getModelSpec } from './catalog';
export type { ModelSpec } from './catalog';
export { LlmUnavailableError, LLM_CONTEXT_PARAMS, IDLE_UNLOAD_MS } from './modelManager';

export type { CategorizeInput } from './tasks/categorize';
export type { SummaryResult } from './tasks/summarize';
export type { ChatAnswer, AnswerContext } from './tasks/chat';
export type { CategorizeResult, CounterpartyType } from './schemas';

// Pure helpers
export { validateLlmParse, LLM_PARSER_ID, LLM_MAX_CONFIDENCE } from './validate';
export { templateSummary } from './summaryTemplate';
export { executeIntent, templateAnswer, normalizeIntent, resolveRange, INTENT_SCHEMA } from './intent';
export type { QueryIntent, QueryResult, QueryRow, Metric, RangePreset, GroupBy } from './intent';
export { learnTemplate, applyTemplates, applyTemplate, TEMPLATE_PARSER_ID } from './templates';
export type { UserParserTemplate, TemplateField } from './templates';
