/**
 * Options for `launchWeb` / `createController` (M11 批2). The provider is
 * injected (only the CLI shell builds an OpenAI-compatible client from
 * config) — the same seam that keeps `createAgentKernel` surface-agnostic
 * keeps the whole web surface testable with a scripted provider.
 */
import type { ChatProvider } from '@nova-agent/core';
import type { KernelConfig } from '@nova-agent/plugins';

export interface ControllerOptions {
  rootDir: string;
  provider: ChatProvider;
  config: KernelConfig;
  /** Resume an existing JSONL log as the first session. */
  resumeFile?: string;
  /** Display label for the active model (from config; the surface shows it). */
  providerModelLabel: string;
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
