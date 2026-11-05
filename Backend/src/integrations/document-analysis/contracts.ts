export interface DocumentAnalysisRequest {
  requestId: string;
  documentId: string;
  consentedPurpose: 'NAME_CONSISTENCY_REVIEW';
  documentCategory: string;
  shortLivedReadCapability: string;
  identityName?: string;
}
export interface NameComparison {
  normalizedIdentityName: string;
  normalizedCredentialName: string;
  signals: (
    | 'REORDERED_NAMES'
    | 'INITIALS'
    | 'POSSIBLE_NAME_CHANGE'
    | 'DISCREPANCY'
    | 'INSUFFICIENT_EVIDENCE'
  )[];
  explanation: string;
  requiresHumanReview: true;
}
export interface DocumentAnalysisResult {
  requestId: string;
  serviceVersion: string;
  extractedName?: string;
  comparison?: NameComparison;
  findings: { code: string; message: string; confidence?: number }[];
  authenticityDecision: 'NOT_DETERMINED';
}
export interface DocumentAnalysisService {
  analyze(input: DocumentAnalysisRequest): Promise<DocumentAnalysisResult>;
}
