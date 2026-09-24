/**
 * Options for `launchWeb` / `createController` (M11 批2). The provider is
 * injected (only the CLI shell builds an OpenAI-compatible client from
 * config) — the same seam that keeps `createAgentKernel` surface-agnostic
 * keeps the whole web surface testable with a scripted provider.
 */
import type { ChatProvider, ModelCatalogPort } from '@nova-agent/core';
import type { KernelConfig } from '@nova-agent/plugins';

export interface ControllerOptions {
  rootDir: string;
  provider: ChatProvider;
  config: KernelConfig;
  /** Resume an existing JSONL log as the first session. */
  resumeFile?: string;
  /** Display label for the active model (from config; the surface shows it). */
  providerModelLabel: string;
  /**
   * The catalog's display name for that model, when the shell's metadata store
   * knows one (an id is not a label: `deepseek-v4.1-flash` reads better as
   * "DeepSeek V4.1 Flash"). Omitted → the id is the label.
   */
  providerModelName?: string;
  /**
   * Model context window, when the owning shell knows it (config override or
   * model metadata). The surface only needs the denominator to draw the
   * context gauge; resolving it is the shell's business.
   */
  contextWindow?: number;
  /**
   * Metadata for the model picker (display names + context windows). Omitting
   * it leaves the seat inert: the ids themselves come from the endpoint
   * (`ChatProvider.listModels`), so this port never becomes a second catalog
   * that could disagree with the one actually being served.
   */
  modelCatalog?: ModelCatalogPort;
}

export interface LaunchWebOptions extends ControllerOptions {
  /** Directory of built frontend assets (vite `dist`). Served at `/`. */
  staticDir: string;
  /** TCP port; 0 (default) picks a free ephemeral port. */
  port?: number;
  /** Bind host. MUST stay a loopback address — the surface is localhost-only. */
  host?: '127.0.0.1' | 'localhost' | '::1';
  /** Called with the full launch URL (token included) once listening. */
  onReady?: (url: string) => void;
}

/** Re-export the kernel config slice type so consumers import from web root. */
export type { KernelConfig };
