export interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  walletBalance: number;
  kycStatus?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface AuthResult {
  user: User;
  tokens: AuthTokens;
  message?: string;
}
