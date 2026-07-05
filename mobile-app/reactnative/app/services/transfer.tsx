import TransferScreen from '@/features/transfers/TransferScreen';

// Unified transfer experience: a single screen with a top SegmentedControl that
// switches between Wallet→Wallet (Paymax P2P), Wallet→Bank, and Bank→Bank.
// Replaces the old wallet-only PaymentActionScreen kind="transfer" flow.
export default function TransferRoute() {
  return <TransferScreen />;
}
