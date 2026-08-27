import { OPERATION_STATE, type OperationState } from './operation-state.js';

const TRANSITIONS: Readonly<Record<OperationState, readonly OperationState[]>> =
  {
    [OPERATION_STATE.CREATED]: [OPERATION_STATE.PAYMENT_REQUESTED],
    [OPERATION_STATE.PAYMENT_REQUESTED]: [
      OPERATION_STATE.COMPLETED,
      OPERATION_STATE.FAILED,
      OPERATION_STATE.AWAITING_CONFIRMATION,
    ],
    [OPERATION_STATE.AWAITING_CONFIRMATION]: [
      OPERATION_STATE.COMPLETED,
      OPERATION_STATE.FAILED,
    ],
    [OPERATION_STATE.COMPLETED]: [],
    [OPERATION_STATE.FAILED]: [],
  };

export function assertTransition(
  from: OperationState,
  to: OperationState,
): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid operation transition: ${from} -> ${to}`);
  }
}
