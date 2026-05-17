export function isElectronAuthBypassEnabled(): boolean {
  return process.env.ELECTRON_CHILD === '1'
    || process.env.AGENT_STUDIO_ELECTRON_AUTH_BYPASS === '1';
}
