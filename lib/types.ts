export type ProjectStatus = "draft" | "running" | "paused" | "review" | "completed";
export type EvidenceClassification = "VERIFICADO" | "PROBABLE" | "HIPOTÉTICO" | "NO DEMOSTRADO";
export type WorkspaceRole = "owner" | "admin" | "editor" | "reviewer" | "viewer";

export type ResearchProject = {
  id: string;
  name: string;
  area: string;
  language: string;
  output: string;
  status: ProjectStatus;
  progress: number;
  humanApproval: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ResearchSource = {
  id: string;
  projectId: string;
  type: string;
  title: string;
  url: string;
  status: string;
  confidence: number;
  createdAt: string;
};

export type StoredObjectStatus = "uploaded" | "processing" | "ready" | "failed" | "quarantined";
export type ProcessingJobStatus = "queued" | "active" | "retrying" | "completed" | "failed" | "dead_letter";

export type StoredObject = {
  id: string;
  projectId: string;
  sourceId: string | null;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  status: StoredObjectStatus;
  createdAt: string;
};

export type ProcessingJob = {
  id: string;
  projectId: string;
  objectId: string;
  jobType: "ingest" | "scan" | "extract" | "transcribe";
  status: ProcessingJobStatus;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SecurityScan = {
  id: string;
  objectId: string;
  status: "clean" | "infected" | "error";
  engine: string;
  engineVersion: string | null;
  threatName: string | null;
  detectedMime: string | null;
  detectedExtension: string | null;
  scannedAt: string;
};

export type ExtractedDocumentSummary = {
  id: string;
  objectId: string;
  extractor: string;
  detectedMime: string;
  textSha256: string;
  characterCount: number;
  wordCount: number;
  pageCount: number | null;
  chunkCount: number;
  textPreview: string;
  extractedAt: string;
};

export type TranscriptionSummary = {
  id: string;
  objectId: string;
  engine: string;
  model: string;
  device: string;
  computeType: string;
  detectedLanguage: string | null;
  languageProbability: number | null;
  durationSeconds: number;
  textSha256: string;
  segmentCount: number;
  wordCount: number;
  textPreview: string;
  transcribedAt: string;
};

export type Evidence = {
  id: string;
  projectId: string;
  sourceId: string | null;
  sourceTitle: string;
  claim: string;
  classification: EvidenceClassification;
  confidence: number;
  sha256: string;
  createdAt: string;
};

export type Approval = {
  id: string;
  projectId: string;
  stage: string;
  status: "approved" | "rejected";
  reviewer: string;
  note: string;
  createdAt: string;
};

export type Activity = {
  id: string;
  projectId: string;
  action: string;
  detail: string;
  actor: string;
  createdAt: string;
};

export type ProjectSnapshot = {
  project: ResearchProject;
  sources: ResearchSource[];
  evidence: Evidence[];
  approvals: Approval[];
  activity: Activity[];
  objects: StoredObject[];
  jobs: ProcessingJob[];
  scans: SecurityScan[];
  documents: ExtractedDocumentSummary[];
  transcriptions: TranscriptionSummary[];
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  createdAt: string;
};

export type WorkspaceMember = {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
};

export type UserSessionInfo = {
  id: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  current: boolean;
};

export type SecurityAuditEvent = {
  id: string;
  eventType: string;
  outcome: "success" | "failure" | "blocked";
  userAgent: string;
  createdAt: string;
};
