export type AgentKind =
  | 'DOCUMENT_REVIEW'
  | 'ASSESSMENT_PLANNER'
  | 'TECHNICAL_INTERVIEWER'
  | 'PRACTICAL_ASSESSMENT'
  | 'COMPETENCY_EVALUATOR'
  | 'ASSESSMENT_INTEGRITY'
  | 'SKILLS_GAP_ANALYST';
export interface AssessmentPlanInput {
  requestId: string;
  bookingId: string;
  pseudonymousApplicantId: string;
  jobRoleId: string;
  blueprintId: string;
  blueprintVersion: number;
  frameworkId: string;
  competencies: { code: string; weight: number }[];
}
export interface ApprovedAssessmentPlan {
  requestId: string;
  blueprintId: string;
  blueprintVersion: number;
  tasks: { approvedTaskId: string; competencyCodes: string[]; durationMinutes: number }[];
}
export interface AssessmentPlanner {
  plan(input: AssessmentPlanInput): Promise<ApprovedAssessmentPlan>;
}
// Future transports must authenticate per service and validate versioned payloads.
// The TypeScript interviewer adapter and LangGraph workflow are implemented in ../assessment-interview.
// AI proposals are reviewed by authorised assessors before final results are published.
export type { InterviewInput, InterviewOutput } from '../assessment-interview/provider.js';
