export type User = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  walletBalance?: number;
  kycStatus?: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken?: string;
};
