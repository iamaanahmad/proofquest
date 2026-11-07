export type QuestStatus =
  | "open"
  | "claimed"
  | "submitted"
  | "approved"
  | "cancelled"
  | "refunded";

export interface Quest {
  publicKey: string;
  questId: string;
  creator: string;
  worker: string | null;
  mint: string;
  rewardAmount: number; // lamports of test-USDC
  status: QuestStatus;
  createdAt: number;
  claimDeadline: number;
  submitDeadline: number;
  coarseGeohash: string;
  evidenceSchemaHash: string;
  evidenceManifestHash: string | null;
  submittedAt: number | null;
  // Supabase metadata
  title?: string;
  description?: string;
  templateId?: string;
  areaLabel?: string;
}

export interface EvidenceManifest {
  questAddress: string;
  workerWallet: string;
  captureTimestamp: number;
  coarseLocation: { geohash: string; accuracy: number };
  nonce: string;
  qrChallengeResult: string | null;
  mediaSha256: string;
  storageObjectId: string;
  appVersion: string;
}

export type RootStackParamList = {
  Welcome: undefined;
  Home: undefined;
  CreateQuest: undefined;
  QuestDetail: { questPublicKey: string };
  Capture: { questPublicKey: string };
  Review: { questPublicKey: string };
};
