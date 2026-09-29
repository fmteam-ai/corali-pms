export type RecoveryInput = {
  username: string;
  displayName: string;
  email: string;
  password: string;
  resetTwoFactor: boolean;
};

export function validateRecoveryInput(input: Partial<RecoveryInput>): RecoveryInput;

export function applyAdministratorRecovery(
  client: { query(query: string | { text: string; values?: unknown[] }, values?: unknown[]): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }> },
  options: { ownerId: string; input: RecoveryInput; passwordHash: string; now: number },
): Promise<unknown>;
