export async function withTransientTransactionRetry<T>(
  task: () => Promise<T>,
): Promise<T> {
  const maximumAttempts = 2;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : '';
      if (!['40P01', '40001'].includes(code) || attempt === maximumAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 5));
    }
  }
  throw new Error('Transaction retry invariant violated');
}
