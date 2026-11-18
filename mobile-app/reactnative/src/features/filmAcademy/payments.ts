// Programme payment terms for the Film Academy, as supplied by the academy
// team. Registration is free — an application charges nothing — and tuition is
// settled offline: weekly at the academy venue, or by bank transfer. Nothing
// here is charged in-app, so these figures are presentation copy, not a quote
// the platform collects. (They mirror ACADEMY_PAYMENTS on the web app; the two
// interfaces share an API but not UI code.)
export const ACADEMY_PAYMENTS = {
  tuitionNgn: 50000,
  weeklyNgn: 15000,
  bankName: 'Providus Bank',
  accountNumber: '1311026275',
} as const;
