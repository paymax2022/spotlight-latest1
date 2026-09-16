export type AdminUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  userType: string;
  status: string;
  profileCompleted: boolean;
  state: string;
  country: string;
  programId?: string;
  contestId?: string;
  schoolId?: string;
  createdAt: string;
};

export type AdminUserFilters = {
  role?: string;
  userType?: string;
  status?: string;
  state?: string;
  program?: string;
  search?: string;
  limit?: number;
};
