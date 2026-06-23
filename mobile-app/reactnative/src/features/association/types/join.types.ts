// ── Association — Join-variants type contract (B) ─────────────────────────────
// Invite codes, group/chapter access codes, and required-document uploads.

export type CodeKind = 'INVITE' | 'ACCESS';

export interface CodeValidation {
  valid:            boolean;
  kind:             CodeKind;
  expired:          boolean;
  organisationId:   string | null;
  organisationName: string | null;
  organisationAcronym: string | null;
  chapterName:      string | null;    // code may be tied to a chapter
  categoryLabel:    string | null;    // or to a membership category
  message:          string;           // human-readable result
}

/** A picked file pending upload during the join flow. */
export interface PickedDocument {
  requirementId: string;
  uri:           string;
  name:          string;
  sizeLabel:     string;
}
