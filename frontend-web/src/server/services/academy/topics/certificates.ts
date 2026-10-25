// TMFA verifiable credentials.
//
// A certificate is EARNED, never assigned. Issuance recomputes the whole topic
// ledger on the server and refuses unless every topic in the curriculum is
// published, every one is MASTERED, and no academic hold is open. At issue time
// the counts are frozen onto the certificate row so a later curriculum change
// cannot silently re-describe what was certified.
//
// The public verification lookup exposes the holder's display name, programme,
// completion date and status — never an email, phone, user id or enrollment id.
// Revoked credentials remain resolvable so a verifier sees "revoked", not a 404.

import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/server';
import { asActorId } from './admin';

type Db = ReturnType<typeof createAdminClient>;

export class CertificateError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CertificateError';
    this.status = status;
    this.code = code;
  }
}

export interface CertificateBlocker {
  code: string;
  message: string;
}

export interface CertificateReadiness {
  topicsRequired: number;
  topicsPublished: number;
  topicsMastered: number;
  openHolds: number;
  eligible: boolean;
  blockers: CertificateBlocker[];
}

export interface CertificateView {
  id: string;
  certificateNumber: string;
  studentName: string;
  programName: string;
  batchName: string;
  completionDate: string | null;
  grade: string | null;
  status: string;
  verificationCode: string;
  issuedAt: string | null;
  revokedAt: string | null;
  revocationReason: string;
  curriculumLabel: string;
  topicsRequired: number | null;
  topicsMastered: number | null;
}

export interface CertificateVerification {
  found: boolean;
  valid: boolean;
  certificateNumber: string | null;
  studentName: string | null;
  programName: string | null;
  completionDate: string | null;
  status: string | null;
  issuedAt: string | null;
  revokedAt: string | null;
}

/**
 * The single eligibility rule. Pure so it can be tested without a database.
 * A credential is withheld while the curriculum itself is withdrawn — all
 * topics mastered is not enough if the teaching material is no longer live.
 */
export function evaluateCertificateEligibility(input: {
  topicsRequired: number;
  topicsPublished: number;
  topicsMastered: number;
  openHolds: number;
}): CertificateReadiness {
  const required = Math.max(0, Math.trunc(input.topicsRequired));
  const published = Math.max(0, Math.trunc(input.topicsPublished));
  const mastered = Math.max(0, Math.trunc(input.topicsMastered));
  const holds = Math.max(0, Math.trunc(input.openHolds));
  const blockers: CertificateBlocker[] = [];

  if (required === 0) {
    blockers.push({
      code: 'CURRICULUM_EMPTY',
      message: 'No curriculum topics exist yet. Import and publish the TMFA pack before a credential can be earned.',
    });
  } else if (published < required) {
    blockers.push({
      code: 'CURRICULUM_INCOMPLETE',
      message: `${published} of ${required} topics are published. A credential cannot be issued while the curriculum is incomplete or withdrawn.`,
    });
  }
  if (required > 0 && mastered < required) {
    blockers.push({
      code: 'TOPICS_INCOMPLETE',
      message: `${mastered} of ${required} topics are mastered. Every topic must pass the 85% gate and its practical holds.`,
    });
  }
  if (holds > 0) {
    blockers.push({
      code: 'HOLDS_OPEN',
      message: `${holds} academic hold${holds === 1 ? ' is' : 's are'} open. Clear every practical, safety or review hold before certification.`,
    });
  }

  return {
    topicsRequired: required,
    topicsPublished: published,
    topicsMastered: mastered,
    openHolds: holds,
    eligible: blockers.length === 0,
    blockers,
  };
}

async function exactCount(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function loadCertificateReadiness(
  db: Db,
  enrollmentId: string,
): Promise<CertificateReadiness> {
  try {
    const [required, published, mastered, holds] = await Promise.all([
      exactCount(db.from('film_topics').select('topic_id', { count: 'exact', head: true })),
      exactCount(
        db.from('film_topics').select('topic_id', { count: 'exact', head: true }).eq('published', true),
      ),
      exactCount(
        db
          .from('film_topic_mastery')
          .select('id', { count: 'exact', head: true })
          .eq('enrollment_id', enrollmentId)
          .eq('state', 'MASTERED'),
      ),
      exactCount(
        db
          .from('film_mastery_holds')
          .select('id', { count: 'exact', head: true })
          .eq('enrollment_id', enrollmentId)
          .eq('status', 'open'),
      ),
    ]);
    return evaluateCertificateEligibility({
      topicsRequired: required,
      topicsPublished: published,
      topicsMastered: mastered,
      openHolds: holds,
    });
  } catch (error) {
    console.error('[film/certificates] readiness failed', error);
    throw new CertificateError(500, 'CERTIFICATE_READINESS_FAILED', 'Could not evaluate credential eligibility.');
  }
}

interface CertificateRow {
  id: string;
  certificate_number: string;
  student_name: string;
  program_name: string;
  batch_name: string | null;
  completion_date: string | null;
  grade: string | null;
  status: string;
  qr_verification_code: string | null;
  issued_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  curriculum_label: string | null;
  topics_required: number | null;
  topics_mastered: number | null;
}

const CERTIFICATE_COLUMNS =
  'id, certificate_number, student_name, program_name, batch_name, completion_date, grade, status, ' +
  'qr_verification_code, issued_at, revoked_at, revocation_reason, curriculum_label, ' +
  'topics_required, topics_mastered';

function certificateView(row: CertificateRow): CertificateView {
  return {
    id: row.id,
    certificateNumber: row.certificate_number,
    studentName: row.student_name,
    programName: row.program_name,
    batchName: row.batch_name ?? '',
    completionDate: row.completion_date,
    grade: row.grade,
    status: row.status,
    verificationCode: row.qr_verification_code ?? '',
    issuedAt: row.issued_at,
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason ?? '',
    curriculumLabel: row.curriculum_label ?? '',
    topicsRequired: row.topics_required,
    topicsMastered: row.topics_mastered,
  };
}

async function latestCertificate(db: Db, enrollmentId: string): Promise<CertificateView | null> {
  const { data, error } = await db
    .from('academy_certificates')
    .select(CERTIFICATE_COLUMNS)
    .eq('enrollment_id', enrollmentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[film/certificates] certificate lookup failed', error);
    throw new CertificateError(500, 'CERTIFICATE_LOAD_FAILED', 'Could not load the credential.');
  }
  return data ? certificateView(data as unknown as CertificateRow) : null;
}

export async function readLearnerCertificate(
  db: Db,
  enrollmentId: string,
): Promise<{ readiness: CertificateReadiness; certificate: CertificateView | null }> {
  const [readiness, certificate] = await Promise.all([
    loadCertificateReadiness(db, enrollmentId),
    latestCertificate(db, enrollmentId),
  ]);
  return { readiness, certificate };
}

function certificateNumber(): string {
  return `TMFA-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function verificationCode(): string {
  const raw = randomBytes(10).toString('hex').toUpperCase();
  return raw.match(/.{1,4}/g)?.join('-') ?? raw;
}

async function writeAudit(
  db: Db,
  input: {
    actorId: string | null;
    actorRole: string;
    action: string;
    certificateId: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    reason?: string;
  },
): Promise<void> {
  const { error } = await db.from('film_academic_audit').insert({
    actor_id: input.actorId,
    actor_role: input.actorRole,
    action: input.action,
    target_type: 'academy_certificate',
    target_id: input.certificateId,
    before: input.before ?? {},
    after: input.after ?? {},
    reason: input.reason ?? '',
  });
  if (error) console.error('[film/certificates] audit write failed', error);
}

interface EnrollmentRecord {
  id: string;
  user_id: string | null;
  academy_applications:
    | { full_name?: string; email?: string }
    | Array<{ full_name?: string; email?: string }>
    | null;
  academy_programs: { title?: string } | Array<{ title?: string }> | null;
  academy_batches: { batch_name?: string } | Array<{ batch_name?: string }> | null;
}

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Issue the programme credential. Idempotent: an already-issued, unrevoked
 * credential is returned unchanged. Every call re-derives eligibility first, so
 * a client cannot mint a credential by replaying a request.
 */
export async function issueCertificate(
  db: Db,
  input: {
    enrollmentId: string;
    actorId: string;
    actorRole: string;
    /** When present, the enrollment must belong to this user (learner self-issue). */
    userId?: string;
  },
): Promise<{ certificate: CertificateView; readiness: CertificateReadiness; created: boolean }> {
  const readiness = await loadCertificateReadiness(db, input.enrollmentId);
  if (!readiness.eligible) {
    throw new CertificateError(
      409,
      'CERTIFICATE_NOT_EARNED',
      readiness.blockers[0]?.message ?? 'The programme credential has not been earned yet.',
    );
  }

  const existing = await latestCertificate(db, input.enrollmentId);
  if (existing && existing.status === 'issued' && !existing.revokedAt) {
    return { certificate: existing, readiness, created: false };
  }
  if (existing && existing.revokedAt && input.userId) {
    throw new CertificateError(
      409,
      'CERTIFICATE_REVOKED',
      'This credential was revoked. Only an academy administrator can issue a replacement.',
    );
  }

  const { data: enrollmentData, error: enrollmentError } = await db
    .from('academy_enrollments')
    .select(
      'id, user_id, academy_applications(full_name, email), academy_programs(title), academy_batches(batch_name)',
    )
    .eq('id', input.enrollmentId)
    .maybeSingle();
  if (enrollmentError) {
    console.error('[film/certificates] enrollment lookup failed', enrollmentError);
    throw new CertificateError(500, 'ENROLLMENT_LOOKUP_FAILED', 'Could not load the enrolled learner.');
  }
  if (!enrollmentData) {
    throw new CertificateError(404, 'ENROLLMENT_NOT_FOUND', 'That enrollment does not exist.');
  }
  const enrollment = enrollmentData as unknown as EnrollmentRecord;
  if (input.userId && enrollment.user_id !== input.userId) {
    throw new CertificateError(403, 'NOT_YOUR_ENROLLMENT', 'You can only request your own credential.');
  }

  const application = firstRelation(enrollment.academy_applications);
  const program = firstRelation(enrollment.academy_programs);
  const batch = firstRelation(enrollment.academy_batches);
  const studentName = application?.full_name?.trim() || 'Film Academy Learner';
  const programName = program?.title?.trim() || 'Spotlight Film Academy — TMFA';
  const today = new Date().toISOString().slice(0, 10);
  const actorId = asActorId(input.actorId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const number = certificateNumber();
    const code = verificationCode();
    const { data, error } = await db
      .from('academy_certificates')
      .insert({
        enrollment_id: input.enrollmentId,
        certificate_number: number,
        student_name: studentName,
        program_name: programName,
        batch_name: batch?.batch_name ?? null,
        completion_date: today,
        grade: null,
        qr_verification_code: code,
        status: 'issued',
        approved_by: actorId,
        issued_by: actorId,
        issued_at: new Date().toISOString(),
        certificate_type: 'programme_completion',
        curriculum_label: 'TMFA Curriculum 1.0',
        topics_required: readiness.topicsRequired,
        topics_mastered: readiness.topicsMastered,
      })
      .select(CERTIFICATE_COLUMNS)
      .single();

    if (!error && data) {
      const certificate = certificateView(data as unknown as CertificateRow);
      await writeAudit(db, {
        actorId,
        actorRole: input.actorRole,
        action: 'CERTIFICATE_ISSUED',
        certificateId: certificate.id,
        after: {
          certificateNumber: certificate.certificateNumber,
          topicsRequired: readiness.topicsRequired,
          topicsMastered: readiness.topicsMastered,
        },
      });
      return { certificate, readiness, created: true };
    }
    // 23505 = unique violation on either the number or the verification code.
    if (error && (error as { code?: string }).code === '23505') continue;
    console.error('[film/certificates] issue failed', error);
    throw new CertificateError(500, 'CERTIFICATE_ISSUE_FAILED', 'Could not issue the credential.');
  }
  throw new CertificateError(500, 'CERTIFICATE_ISSUE_FAILED', 'Could not allocate a unique certificate number.');
}

export async function revokeCertificate(
  db: Db,
  input: { certificateId: string; actorId: string; actorRole: string; reason: string },
): Promise<CertificateView> {
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new CertificateError(400, 'REVOCATION_REASON_REQUIRED', 'Give a revocation reason (at least 5 characters).');
  }
  const { data, error } = await db
    .from('academy_certificates')
    .select(CERTIFICATE_COLUMNS)
    .eq('id', input.certificateId)
    .maybeSingle();
  if (error) {
    console.error('[film/certificates] revoke lookup failed', error);
    throw new CertificateError(500, 'CERTIFICATE_LOAD_FAILED', 'Could not load that credential.');
  }
  if (!data) {
    throw new CertificateError(404, 'CERTIFICATE_NOT_FOUND', 'That credential does not exist.');
  }
  const current = certificateView(data as unknown as CertificateRow);
  if (current.revokedAt) return current;

  const { data: updated, error: updateError } = await db
    .from('academy_certificates')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: asActorId(input.actorId),
      revocation_reason: reason,
    })
    .eq('id', input.certificateId)
    .select(CERTIFICATE_COLUMNS)
    .single();
  if (updateError || !updated) {
    console.error('[film/certificates] revoke failed', updateError);
    throw new CertificateError(500, 'CERTIFICATE_REVOKE_FAILED', 'Could not revoke the credential.');
  }

  await writeAudit(db, {
    actorId: asActorId(input.actorId),
    actorRole: input.actorRole,
    action: 'CERTIFICATE_REVOKED',
    certificateId: input.certificateId,
    before: { status: current.status },
    after: { status: 'revoked' },
    reason,
  });
  return certificateView(updated as unknown as CertificateRow);
}

const VERIFICATION_ID = /^[A-Za-z0-9-]{6,48}$/;

/** Public lookup. Returns only what is printed on the certificate. */
export async function verifyCertificate(
  db: Db,
  identifier: string,
): Promise<CertificateVerification> {
  const normalized = identifier.trim().toUpperCase();
  const empty: CertificateVerification = {
    found: false,
    valid: false,
    certificateNumber: null,
    studentName: null,
    programName: null,
    completionDate: null,
    status: null,
    issuedAt: null,
    revokedAt: null,
  };
  if (!VERIFICATION_ID.test(normalized)) return empty;

  let { data } = await db
    .from('academy_certificates')
    .select(CERTIFICATE_COLUMNS)
    .eq('qr_verification_code', normalized)
    .maybeSingle();
  if (!data) {
    const byNumber = await db
      .from('academy_certificates')
      .select(CERTIFICATE_COLUMNS)
      .eq('certificate_number', normalized)
      .maybeSingle();
    data = byNumber.data;
  }
  if (!data) return empty;

  const row = certificateView(data as unknown as CertificateRow);
  const valid = row.status === 'issued' && !row.revokedAt;
  return {
    found: true,
    valid,
    certificateNumber: row.certificateNumber,
    studentName: row.studentName,
    programName: row.programName,
    completionDate: row.completionDate,
    status: row.revokedAt ? 'revoked' : row.status,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
  };
}
