export interface ApplicantProfileData {
  id: string;
  legalName: string;
  email: string;
  phone: string | null;
  emailVerifiedAt: string | null;
  profile: { country: string; discipline: string | null } | null;
}
export interface ApplicantOnboarding {
  emailVerified: boolean;
  profileComplete: boolean;
  identitySubmitted: boolean;
  documents: { id: string; category: string; status: string; scanStatus: string }[];
}
export interface ProfileState {
  status: string;
  data: ApplicantProfileData | null;
  onboarding: ApplicantOnboarding | null;
  error: string;
  fieldErrors: Record<string, string>;
  draft: Record<string, string> | null;
  saving: boolean;
  notice: string;
  onboardingError: string;
}

export interface ApplicantDocument {
  id: string; category: string; title: string; courseName?: string | null;
  certificationName?: string | null; issuer?: string | null; institutionName?: string | null; institutionId?: string | null;
  issuedAt?: string | null; expiresAt?: string | null; verificationUrl?: string | null;
  qualificationId?: string | null; replacesId?: string | null; isCurrent?: boolean;
  mimeType: string; size: number; scanStatus: string; status: string; createdAt: string; updatedAt?: string;
  transcripts?: ApplicantDocument[];
}
export interface DocumentRule { category: string; label: string; institutionRequired: boolean; requiredFields: string[]; transcriptsRequired: boolean; }
export interface DocumentRequirements { categories: DocumentRule[]; maxFileBytes: number; maxTotalBytes: number; maxTranscripts: number; }
export interface DocumentHistory {
  history: { fromStatus: string | null; toStatus: string; reason: string; createdAt: string }[];
  reviews: { outcome: string; method: string; reason: string; createdAt: string }[];
  evidence: { note: string; reference?: string | null; createdAt: string }[];
}
export interface DocumentState {
  summary: { current: number; authenticated: number } | null;
  status: string; items: ApplicantDocument[]; requirements: DocumentRequirements | null;
  busy: boolean; error: string; notice: string; detailId: string; detail: ApplicantDocument | null;
  detailStatus: string; detailError: string; history: DocumentHistory | null;
}

export interface ApplicantDemoState {
  name: string;
  discipline: string;
  career: string;
  booked: boolean;
  prepared: boolean;
  learning: boolean[];
  slot: number;
  messages: string[];
  started: boolean;
}

export interface CareerIndustry { id: string; name: string; active: boolean; }
export interface CareerCompany { id: string; name: string; industries: { industryId: string }[]; }
export interface CareerBlueprint { id: string; frameworkId: string; title: string; active: boolean; durationMinutes: number; }
export interface CareerRole {
  id: string; title: string; description: string;
  industries: { industryId: string; industry: CareerIndustry }[];
  blueprints?: CareerBlueprint[];
}
export interface CareerFramework {
  id: string; scope: string;
  competencies: { competency: { id: string; name: string; description: string } }[];
}
export interface CareerDraft { jobRoleId: string; industryIds: string[]; companyIds: string[]; qualificationIds: string[]; blueprintId: string; }
export interface CareerTarget {
  id: string; jobRoleId: string; status: string; jobRole: CareerRole;
  industries: { industryId: string; industry: CareerIndustry }[];
  companies: { companyId: string; company: CareerCompany }[];
  qualifications: { documentId: string; document: { title?: string; courseName?: string | null; certificationName?: string | null } }[];
  attempt?: { id: string; blueprintId: string } | null;
}
export interface CareerState {
  status: string; items: CareerRole[]; industries: CareerIndustry[]; companies: CareerCompany[];
  qualifications: ApplicantDocument[]; activeTarget: CareerTarget | null;
  selectedId: string; detail: CareerRole | null; frameworks: CareerFramework[];
  detailStatus: string; detailError: string; draft: CareerDraft | null;
  busy: boolean; uncertain: boolean; error: string; notice: string;
  recoveryTargetId: string; recoveryReason: string;
}

export interface AssessmentBooking {
  bookingId: string; slotId?: string; status: string; startsAt: string; endsAt: string; timezone: string; durationMinutes: number; instructions: string; jobRole: { title: string }; blueprint: { id: string; title: string }; rescheduleCount: number;
  changePolicy?: { deadline: string; reschedulesRemaining: number };
  events: { action: string; reason?: string | null; createdAt: string }[];
}
export interface BookingState {
  status: string; busy: boolean; error: string; notice: string; requiresMfa?: boolean; uncertain: boolean; mode: string; reason: string; selectedSlot: string; blueprintId: string;
  bookings: AssessmentBooking[];
  slots: { id: string; startsAt: string; endsAt: string; timezone: string; remainingCapacity: number }[];
  eligibility: { reasons: string[]; attemptId: string | null; blueprints: { blueprintId: string; reasons: string[] }[]; identityRecovery?: { documentId: string } | null } | null;
}

export interface PageContext {
  state: ApplicantDemoState;
  profileState: ProfileState;
  documentState: DocumentState;
  careerState: CareerState;
  bookingState: BookingState;
  assessmentState: unknown;
  learningState: unknown;
  routeParams: URLSearchParams;
  escape: (value: unknown) => string;
  heading: (title: string, subtitle: string, action?: string) => string;
  button: (text: string, href: string, className?: string) => string;
  card: (title: string, body: string, link?: string) => string;
  badge: (text: string, className?: string) => string;
  field: (label: string, name: string, value?: string, type?: string) => string;
  documents: () => string;
  icon: (name: string) => string;
  currentUser: () => { legalName: string; email?: string } | null;
  careers: string[];
}
