/**
 * Model catalog. Pure data: no React Native imports.
 *
 * Every entry is pinned to a Hugging Face commit so the bytes behind the URL
 * can never change. `sizeBytes` and `sha256` come from the HF API
 * (`/api/models/<repo>/tree/<commit>` → `lfs.size` / `lfs.oid`, which matches
 * the `x-linked-size` / `x-linked-etag` headers on `resolve/<commit>/<file>`).
 * The download is rejected unless both match.
 *
 * Note: `huggingface.co/.../resolve/...` answers with a 302 to a CDN host
 * (`*.hf.co`, e.g. `us.aws.cdn.hf.co` / `cas-bridge.xethub.hf.co`), so the
 * network security config must allow `huggingface.co` and `hf.co` subdomains.
 */

export type ModelArch = 'qwen3' | 'qwen35';

export interface ModelSpec {
  /** Stable id used in storage, task ids and file names. */
  id: string;
  displayName: string;
  /** Hugging Face repo, e.g. `unsloth/Qwen3-0.6B-GGUF`. */
  repo: string;
  /** Full 40-hex commit sha the URL is pinned to. */
  revision: string;
  /** File name inside the repo (also used as the on-device file name). */
  file: string;
  /** `https://huggingface.co/<repo>/resolve/<revision>/<file>`. */
  url: string;
  /** Exact byte size of the GGUF. */
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the GGUF. */
  sha256: string;
  /** SPDX licence id of the weights. */
  license: string;
  licenseUrl: string;
  /** llama.cpp `general.architecture`. */
  arch: ModelArch;
  quant: 'Q4_K_M';
  /** Upstream model the GGUF was converted from. */
  baseModel: string;
  isDefault: boolean;
}

function hfUrl(repo: string, revision: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
}

function spec(s: Omit<ModelSpec, 'url'>): ModelSpec {
  return { ...s, url: hfUrl(s.repo, s.revision, s.file) };
}

/**
 * The official `Qwen/Qwen3-0.6B-GGUF` repo only ships Q8_0, so the Q4_K_M
 * quants come from unsloth (same Apache-2.0 weights, re-quantised).
 */
export const MODEL_CATALOG: readonly ModelSpec[] = [
  spec({
    id: 'qwen3-0.6b-q4km',
    displayName: 'Qwen3 0.6B (Q4_K_M)',
    repo: 'unsloth/Qwen3-0.6B-GGUF',
    revision: '50968a4468ef4233ed78cd7c3de230dd1d61a56b',
    file: 'Qwen3-0.6B-Q4_K_M.gguf',
    sizeBytes: 396705472,
    sha256: 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3-0.6B/blob/main/LICENSE',
    arch: 'qwen3',
    quant: 'Q4_K_M',
    baseModel: 'Qwen/Qwen3-0.6B',
    isDefault: true,
  }),
  // llama.rn 0.13.0-rc.7 bundles llama.cpp build 11385 (bf9a0cc), which has
  // LLM_ARCH_QWEN35 ("qwen35"), so this GGUF loads. Text-only use (no mmproj).
  spec({
    id: 'qwen3.5-0.8b-q4km',
    displayName: 'Qwen3.5 0.8B (Q4_K_M)',
    repo: 'unsloth/Qwen3.5-0.8B-GGUF',
    revision: '6ab461498e2023f6e3c1baea90a8f0fe38ab64d0',
    file: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    sizeBytes: 532517120,
    sha256: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3.5-0.8B/blob/main/LICENSE',
    arch: 'qwen35',
    quant: 'Q4_K_M',
    baseModel: 'Qwen/Qwen3.5-0.8B',
    isDefault: false,
  }),
];

export const DEFAULT_MODEL_ID: string = MODEL_CATALOG.find(m => m.isDefault)!.id;

export function getModelSpec(id: string): ModelSpec | undefined {
  return MODEL_CATALOG.find(m => m.id === id);
}
