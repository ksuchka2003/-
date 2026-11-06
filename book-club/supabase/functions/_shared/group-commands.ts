export function groupCommand(text: string, username: string) {
  const m = text.match(/^\/(connect_club|disconnect_club)(?:@([a-z0-9_]+))?\s*$/i);
  return m && (!m[2] || m[2].toLowerCase() === username.toLowerCase()) ? m[1].toLowerCase() : null;
}
export const isChatAdmin = (status: string) => status === 'creator' || status === 'administrator';
