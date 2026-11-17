export function workspaceUrl(role: string, path?: string): string;
export function availableWorkspaces(principal: { roles?: string[] } | null): string[];
export function sharedLoginUrl(): string;
