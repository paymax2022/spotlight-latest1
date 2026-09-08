// ── What the pharmacist can do to an order, and when ─────────────────────────
//
// Mirrors the server's guarded state machine
// (backend/internal/health/pharmacy/model.go allowedOrderTransitions) so the UI
// offers exactly the actions the API will accept. Offering one it will reject
// produces a button that fails; hiding one it would accept strands the order.
//
// Two rules here are NOT symmetrical with the customer app, and both matter:
//
//   • CANCEL IS PATIENT-ONLY. Service.Cancel rejects any caller who is not the
//     patient (`o.PatientID != patientID → forbidden`), because cancelling
//     refunds the held payment. The pharmacist never gets a cancel button.
//   • COMPLETING A PICKUP NEEDS THE PATIENT'S CODE. The pharmacy is not given
//     pickup_code — the inbox withholds it deliberately — so the pharmacist
//     types in what the customer presents at the counter, and the server checks
//     it. That is the point of the credential.
//
// Dependency-free so it runs under `node --test`.

/** Order states, exactly as the server spells them. */
export type PharmacyOrderState =
  | 'CREATED'
  | 'RX_PENDING_VERIFICATION'
  | 'CONFIRMED'
  | 'DISPENSED'
  | 'IN_DELIVERY'
  | 'READY_FOR_PICKUP'
  | 'DELIVERED'
  | 'COLLECTED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'REFUNDED';

/** The API call a button maps to. */
export type PharmacyAction = 'confirm' | 'dispense' | 'dispatch' | 'complete';

export interface ActionSpec {
  action: PharmacyAction;
  label: string;
  /** One line on what it does — these move money and medicine. */
  hint: string;
  /** True when the patient must present their pickup code to proceed. */
  requiresPickupCode?: boolean;
  /** True when the action needs a fulfilment choice (deliver vs collect). */
  requiresFulfilmentChoice?: boolean;
}

/**
 * The actions available to the PHARMACIST in a given state.
 *
 * Empty means there is nothing for them to do — either the order is finished, or
 * the next move belongs to the patient (collecting, cancelling) or to the
 * delivery rail.
 */
export function actionsFor(state: PharmacyOrderState | string): ActionSpec[] {
  switch (state) {
    case 'CREATED':
    case 'RX_PENDING_VERIFICATION':
      return [{
        action: 'confirm',
        label: 'Accept order',
        hint: 'Confirms you can fill this order. A prescription order must be verified first.',
      }];

    case 'CONFIRMED':
      return [{
        action: 'dispense',
        label: 'Mark dispensed',
        hint: 'Record what you actually dispensed. It is checked against the prescription.',
      }];

    case 'DISPENSED':
      return [{
        action: 'dispatch',
        label: 'Send out',
        hint: 'Hand to a rider for delivery, or set aside for the customer to collect.',
        requiresFulfilmentChoice: true,
      }];

    case 'IN_DELIVERY':
      return [{
        action: 'complete',
        label: 'Mark delivered',
        hint: 'Confirms the customer received the order and releases your payment.',
      }];

    case 'READY_FOR_PICKUP':
      return [{
        action: 'complete',
        label: 'Confirm collection',
        hint: 'Enter the code the customer shows you. This releases your payment.',
        requiresPickupCode: true,
      }];

    // DELIVERED / COLLECTED / CLOSED — done. CANCELLED / REFUNDED — the patient
    // cancelled pre-dispense; there is no pharmacist action either way.
    default:
      return [];
  }
}

/** True when the order is waiting on the pharmacy rather than on someone else. */
export function needsPharmacistAttention(state: PharmacyOrderState | string): boolean {
  return actionsFor(state).length > 0;
}

/** Customer-readable state, for the inbox rows. */
export const STATE_LABELS: Record<string, string> = {
  CREATED: 'New',
  RX_PENDING_VERIFICATION: 'Awaiting Rx check',
  CONFIRMED: 'To dispense',
  DISPENSED: 'Ready to send',
  IN_DELIVERY: 'Out for delivery',
  READY_FOR_PICKUP: 'Awaiting collection',
  DELIVERED: 'Delivered',
  COLLECTED: 'Collected',
  CLOSED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

export function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

/**
 * Inbox ordering: what needs the pharmacist first, then newest.
 *
 * An inbox sorted purely by date buries the order someone is waiting on behind
 * a week of finished ones.
 */
export function inboxRank(state: string): number {
  if (needsPharmacistAttention(state)) return 0;
  if (state === 'DELIVERED' || state === 'COLLECTED') return 1;
  return 2;
}
