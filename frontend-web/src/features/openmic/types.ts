export type OpenMicContestStatus =
  | 'draft'
  | 'scheduled'
  | 'published'
  | 'registration_open'
  | 'beat_available'
  | 'submission_open'
  | 'submission_closed'
  | 'under_review'
  | 'voting_live'
  | 'voting_closed'
  | 'finalists_selected'
  | 'grand_finale_scheduled'
  | 'grand_finale_live'
  | 'winner_announced'
  | 'completed'
  | 'archived'
  | 'suspended'
  | 'cancelled';

export type OpenMicEntryStatus =
  | 'draft'
  | 'submitted'
  | 'awaiting_payment'
  | 'under_review'
  | 'correction_requested'
  | 'clean_version_requested'
  | 'approved'
  | 'rejected'
  | 'published_for_voting'
  | 'finalist'
  | 'disqualified'
  | 'winner';

export type OpenMicSelectionModel = 'votes_only' | 'judges_only' | 'hybrid' | 'admin_curated';
export type OpenMicApplicationStatus = 'pending' | 'approved' | 'rejected';
export type OpenMicPaymentStatus = 'not_required' | 'pending' | 'paid' | 'failed' | 'waived';
export type OpenMicBeatDownloadStatus = 'not_available' | 'available' | 'downloaded';

export type OpenMicVisibility = 'public' | 'private_invite_only' | 'regional_only' | 'hidden';

export type OpenMicRecurrence = {
  enabled: boolean;
  repeatMonths: number;
  autoCreateNext: boolean;
  autoCopySettings: boolean;
  autoPublishFuture: boolean;
  requireNewBeatEveryMonth: boolean;
};

export type OpenMicBeatConfig = {
  id: string;
  contestId: string;
  beatTitle: string;
  producerName: string;
  producerCredit: string;
  previewUrl?: string;
  downloadUrl?: string;
  bpm?: number;
  musicalKey?: string;
  genre?: string;
  mood?: string;
  durationSeconds?: number;
  usageRules: string;
  allowDownload: boolean;
  previewOnly: boolean;
  requiresPaidEntryForDownload: boolean;
  explicitLyricsAllowed: boolean;
  cleanVersionRequired: boolean;
  maxSongDurationSeconds?: number;
  createdAt: string;
  updatedAt: string;
};

export type OpenMicPrizePackage = {
  id: string;
  title: string;
  description: string;
  prizeType: string;
  cashValueNgn?: number;
  nonCashValue?: string;
  sponsor?: string;
  numberOfWinners: number;
};

export type OpenMicVotingConfig = {
  enabled: boolean;
  freeVoting: boolean;
  paidVoting: boolean;
  votePrice: number;
  voteBundlePrice?: number;
  voteBundleCount?: number;
  leaderboardVisible: boolean;
  voteCountPublic: boolean;
  minVotePurchase?: number;
  maxVotePurchase?: number;
  suspiciousVoteThreshold?: number;
  suspiciousVoteHighThreshold?: number;
  votingStartAt?: string;
  votingEndAt?: string;
};

export type OpenMicFinaleConfig = {
  venueName: string;
  venueType: string;
  address: string;
  city: string;
  state: string;
  date?: string;
  artistArrivalTime?: string;
  doorsOpenTime?: string;
  showStartTime?: string;
  winnerAnnouncementTime?: string;
  playbackMode: 'all_approved' | 'top_20' | 'top_10' | 'finalists_only';
};

export type OpenMicFinalePlaylistItem = {
  order: number;
  submissionId: string;
  stageName: string;
  songTitle: string;
  status: OpenMicEntryStatus;
  durationSeconds?: number;
  djCueNote?: string;
  played?: boolean;
  playedAt?: string;
  judgeScore?: number;
  audienceReactionScore?: number;
};

export type OpenMicContest = {
  id: string;
  title: string;
  slug: string;
  month: number;
  year: number;
  season: string;
  description: string;
  objective?: string;
  theme?: string;
  hashtag?: string;
  status: OpenMicContestStatus;
  visibility: OpenMicVisibility;
  registrationFeeNgn: number;
  entryFeeRequired: boolean;
  votingConfig: OpenMicVotingConfig;
  recurrence: OpenMicRecurrence;
  selectionModel: OpenMicSelectionModel;
  finalistsTarget: number;
  judgeWeight: number;
  publicVoteWeight: number;
  registrationStartAt?: string;
  registrationEndAt?: string;
  submissionStartAt?: string;
  submissionEndAt?: string;
  reviewEndAt?: string;
  finale: OpenMicFinaleConfig;
  finalePlaylist: OpenMicFinalePlaylistItem[];
  finalePlaylistLocked: boolean;
  prizes: OpenMicPrizePackage[];
  beat?: OpenMicBeatConfig;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type OpenMicApplication = {
  id: string;
  contestId: string;
  contestSlug: string;
  userId?: string;
  fullName: string;
  stageName: string;
  email: string;
  phone: string;
  gender: 'male' | 'female' | 'prefer_not_to_say';
  ageRange: 'under_18' | '18_24' | '25_34' | '35_plus';
  country: string;
  city: string;
  state: string;
  lga: string;
  instagramHandle?: string;
  tiktokHandle?: string;
  youtubeHandle?: string;
  facebookHandle?: string;
  xHandle?: string;
  musicGenre: string;
  artistBio?: string;
  profilePhotoUrl?: string;
  applicationStatus: OpenMicApplicationStatus;
  paymentStatus: OpenMicPaymentStatus;
  beatDownloadStatus: OpenMicBeatDownloadStatus;
  hasAgreedToRules: boolean;
  hasAgreedToBeatTerms: boolean;
  hasAgreedToVotingTerms: boolean;
  appliedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type OpenMicBeatDownloadLog = {
  id: string;
  beatId: string;
  contestId: string;
  userId?: string;
  artistName: string;
  artistEmail?: string;
  termsAccepted: boolean;
  paidAccessConfirmed: boolean;
  downloadedAt: string;
};

export type OpenMicSubmission = {
  id: string;
  contestId: string;
  contestSlug: string;
  artistUserId?: string;
  stageName: string;
  realName?: string;
  email?: string;
  phone?: string;
  country?: string;
  state?: string;
  lga?: string;
  instagramHandle?: string;
  tiktokHandle?: string;
  youtubeHandle?: string;
  facebookHandle?: string;
  xHandle?: string;
  genre: string;
  songTitle: string;
  songMood?: string;
  language?: string;
  songUrl: string;
  songObjectKey?: string;
  songFileName?: string;
  videoUrl?: string;
  lyricsUrl?: string;
  artworkUrl?: string;
  story?: string;
  votingSlogan?: string;
  fanMessage?: string;
  explicitVersion: boolean;
  cleanVersionAvailable: boolean;
  officialBeatConfirmed: boolean;
  ownershipConfirmed: boolean;
  noUnauthorizedSamplesConfirmed: boolean;
  finaleAvailabilityConfirmed: boolean;
  status: OpenMicEntryStatus;
  reviewNote?: string;
  voteCount: number;
  leaderboardScore: number;
  isFinalist: boolean;
  isWinner: boolean;
  submittedAt?: string;
  approvedAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type OpenMicSubmissionReviewInput = {
  status: Extract<
    OpenMicEntryStatus,
    'approved' | 'rejected' | 'correction_requested' | 'clean_version_requested' | 'published_for_voting' | 'disqualified' | 'finalist' | 'winner'
  >;
  note?: string;
};

export type OpenMicVoteInput = {
  contestId: string;
  submissionId: string;
  voterUserId?: string;
  voterName?: string;
  source: 'free' | 'paid' | 'bundle' | 'bonus';
  votes: number;
  paymentReference?: string;
};

export type OpenMicPaymentEvent = {
  id: string;
  contestId: string;
  applicationId?: string;
  submissionId?: string;
  eventType: 'entry_fee' | 'vote_payment' | 'refund';
  amountNgn: number;
  paymentStatus: 'pending' | 'successful' | 'failed' | 'refunded' | 'waived';
  paymentReference?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type OpenMicNotification = {
  id: string;
  contestId?: string;
  applicationId?: string;
  submissionId?: string;
  audience: 'artist' | 'admin';
  channel: 'in_app' | 'email' | 'sms_whatsapp_placeholder';
  eventKey: string;
  title: string;
  message: string;
  status: 'queued' | 'sent';
  sentAt?: string;
  createdAt: string;
};

export type OpenMicFraudAlert = {
  id: string;
  contestId: string;
  submissionId: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  votesInEvent: number;
  status?: 'open' | 'resolved';
  resolvedAt?: string;
  resolutionNote?: string;
  createdAt: string;
};
