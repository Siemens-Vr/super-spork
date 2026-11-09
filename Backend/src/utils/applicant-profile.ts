// Explicit projection keeps retired profile fields out of API responses.
export const applicantProfileSelect = {
  id: true,
  userId: true,
  country: true,
  discipline: true,
  consentVersion: true,
  consentAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function isProfileComplete(user: {
  phone: string | null;
  profile: { discipline: string | null } | null;
}) {
  return !!(user.phone && user.profile?.discipline);
}
