// The version of Hunt: the plugin and this server ship together under one number. scripts/release.mjs writes this file and both
// plugin manifests; `node scripts/release.mjs --check` (CI) fails when they disagree.
export const VERSION = '0.2.0';
/** The agent API's generation: raised only when an older plugin can no longer talk to this server. */
export const API = 1;
/** The oldest plugin this server serves (X-Hunt-Version). A plugin that sends no version (before 0.2.0) is let through. */
export const MIN_PLUGIN = '0.1.0';
