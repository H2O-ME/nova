/**
 * Options for `launchWeb` / `WebController.create()`.
 *
 * The shapes live in `controller-options.ts` (see the module header there for why
 * the persistence seams are grouped); this file is the import path the rest of the
 * package and the shell already use, kept so moving the types did not touch every
 * call site.
 */
export type {
  ControllerOptions,
  LaunchWebOptions,
  PersistConfigSeams,
  ProviderSeams,
} from './controller-options.js';
