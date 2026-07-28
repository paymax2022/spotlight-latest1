import { createAdminClient } from '@/lib/supabase/server';
import { queueNotification } from '@/src/server/admin/notifications';
import type { UtilityTransactionRow } from './types';

type UtilityCustomerNotificationKind =
  | 'payment_successful'
  | 'payment_pending'
  | 'payment_failed'
  | 'refund_processed'
  | 'token_generated'
  | 'dispute_opened'
  | 'dispute_updated';

interface UtilityNotificationContent {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

function money(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function categoryLabel(category: string) {
  return category.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function contentFor(kind: UtilityCustomerNotificationKind, transaction: UtilityTransactionRow, note?: string): UtilityNotificationContent {
  const reference = transaction.receipt_number ?? transaction.id;
  const service = categoryLabel(transaction.category);

  if (kind === 'payment_successful') {
    return {
      title: `${service} payment successful`,
      message: `${money(transaction.retail_amount_kobo)} payment ${reference} was completed successfully.`,
      type: 'success',
    };
  }

  if (kind === 'token_generated') {
    return {
      title: 'Electricity token generated',
      message: `Token for payment ${reference} is available in your receipt history.`,
      type: 'success',
    };
  }

  if (kind === 'payment_pending') {
    return {
      title: `${service} payment pending`,
      message: `Payment ${reference} is being confirmed with the provider. Do not retry until the status updates.`,
      type: 'warning',
    };
  }

  if (kind === 'refund_processed') {
    return {
      title: 'Utility payment refunded',
      message: `Payment ${reference} has been reversed to your wallet.`,
      type: 'info',
    };
  }

  if (kind === 'dispute_opened') {
    return {
      title: 'Utility dispute opened',
      message: `Support has received your dispute for payment ${reference}.`,
      type: 'info',
    };
  }

  if (kind === 'dispute_updated') {
    return {
      title: 'Utility dispute updated',
      message: note || `Your dispute for payment ${reference} has been updated.`,
      type: 'info',
    };
  }

  return {
    title: `${service} payment failed`,
    message: note || `Payment ${reference} failed and requires review.`,
    type: 'error',
  };
}

export async function notifyUtilityCustomer(
  transaction: UtilityTransactionRow,
  kind: UtilityCustomerNotificationKind,
  note?: string,
) {
  const content = contentFor(kind, transaction, note);
  const supabase = createAdminClient();
  const { error } = await supabase.from('applicant_notifications').insert({
    user_id: transaction.user_id,
    service_type: 'utility_payment',
    application_id: transaction.id,
    title: content.title,
    message: content.message,
    type: content.type,
    link: `/utility?transaction=${transaction.id}`,
    metadata: {
      utility_transaction_id: transaction.id,
      receipt_number: transaction.receipt_number,
      category: transaction.category,
      status: transaction.status,
      token_present: Boolean(transaction.token),
    },
  });

  if (error) {
    console.warn('Failed to queue utility customer notification', {
      transactionId: transaction.id,
      kind,
      error: error.message,
    });
  }
}

export async function notifyUtilityTransactionStatus(transaction: UtilityTransactionRow, note?: string) {
  if (transaction.status === 'successful') {
    await notifyUtilityCustomer(transaction, transaction.token ? 'token_generated' : 'payment_successful', note);
    return;
  }
  if (transaction.status === 'provider_pending' || transaction.status === 'wallet_debited' || transaction.status === 'initiated') {
    await notifyUtilityCustomer(transaction, 'payment_pending', note);
    return;
  }
  if (transaction.status === 'reversed') {
    await notifyUtilityCustomer(transaction, 'refund_processed', note);
    return;
  }
  if (transaction.status === 'failed') {
    await notifyUtilityCustomer(transaction, 'payment_failed', note);
  }
}

export function queueUtilityAdminAlert(input: {
  title: string;
  message: string;
  audience?: 'admins' | 'support' | 'finance';
  createdBy?: string;
}) {
  return queueNotification({
    title: input.title,
    message: input.message,
    channel: 'in_app',
    audience: input.audience ?? 'support',
    createdBy: input.createdBy,
  });
}
