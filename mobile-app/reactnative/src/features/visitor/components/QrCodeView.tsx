// Visitor QR display now delegates to the shared, spec-compliant QR component
// (react-native-qrcode-svg). Re-exported here so existing imports
// ('@/features/visitor/components/QrCodeView') keep working unchanged while the
// numeric-code fallback on the code screen still covers unscannable cases.
export { default } from '@/components/QrCodeView';
