import { OPERATION_STATE } from './operation-state.ts';
import { assertTransition } from './operation-state.policy.ts';

describe('operation state policy', () => {
  it('rejects a transition from a terminal state', () => {
    expect(() =>
      assertTransition(OPERATION_STATE.COMPLETED, OPERATION_STATE.FAILED),
    ).toThrow('Invalid operation transition: COMPLETED -> FAILED');
  });

  it('accepts a repeated terminal transition as an idempotent no-op', () => {
    expect(() =>
      assertTransition(OPERATION_STATE.COMPLETED, OPERATION_STATE.COMPLETED),
    ).not.toThrow();
  });
});
