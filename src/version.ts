/**
 * Written into every confirmation record for audit traceability (data model
 * §2.1). Kept as a plain constant rather than importing package.json: the
 * Forge bundler roots backend compilation at src/ (tech design §10), and an
 * import reaching outside src/ is a needless risk. Bump this alongside the
 * "version" field in package.json.
 */
export const APP_VERSION = '0.1.0';
