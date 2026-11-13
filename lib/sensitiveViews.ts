export type SensitiveViewAction = 'file_view' | 'record_view';
export type SensitiveViewRole = 'resident' | 'staff' | 'admin';

export const SENSITIVE_VIEW_ACTIONS: readonly SensitiveViewAction[] = ['file_view', 'record_view'];
export const SENSITIVE_VIEW_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export function isSensitiveViewAction(action: string): action is SensitiveViewAction {
  return SENSITIVE_VIEW_ACTIONS.includes(action as SensitiveViewAction);
}

export function decideSensitiveView(input: {
  action: SensitiveViewAction | 'list_view';
  role: SensitiveViewRole;
  isAuthorized: boolean;
  lastEventAt?: string;
  now: number;
  logWriteSucceeded?: boolean;
}) {
  if (input.action === 'list_view') return { shouldLog: false, allowed: true };
  if (!input.isAuthorized) return { shouldLog: false, allowed: false };
  if (input.role === 'resident') return { shouldLog: false, allowed: true };

  const lastEventTime = input.lastEventAt ? Date.parse(input.lastEventAt) : NaN;
  const isDuplicate = Number.isFinite(lastEventTime)
    && lastEventTime <= input.now
    && input.now - lastEventTime < SENSITIVE_VIEW_DEDUPE_WINDOW_MS;
  if (isDuplicate) return { shouldLog: false, allowed: true };

  return { shouldLog: true, allowed: input.logWriteSucceeded === true };
}
