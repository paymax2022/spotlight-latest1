// ── Paymax AI Symptom Checker — vernacular copy (EN + Pidgin) ─────────────────
// Phase 1 ships English + Pidgin (pcm). pcm strings are stubbed (mostly EN) and
// can be tuned by a localisation pass without touching screens. A simple language
// toggle picks the active pack; every screen pulls copy through `t(lang)`.
//
// SAFETY copy lives here so SC-1 / SC-8 / SC-9 wording is reviewed in one place.

import type { Language } from './types';

export interface TriageStrings {
  // Brand / entry
  appName: string;
  appTagline: string;
  // Disclaimer (SC-8) — shown persistently on every screen.
  disclaimer: string;
  notADiagnosis: string; // SC-1
  // Emergency (SC-8) — persistent shortcut + full screen.
  emergencyShortcut: string;
  emergencyTitle: string;
  emergencySubtitle: string;
  callAmbulance: string;
  nearestEr: string;
  firstAidTitle: string;
  // SC-9 caution
  childCaution: string;
  maternalCaution: string;
  // Profile + consent
  whoIsThisFor: string;
  consentTitle: string;
  consentBody: string;
  consentAgree: string;
  startCheck: string;
  // Intake
  intakeTitle: string;
  intakePrompt: string;
  intakePlaceholder: string;
  bodyMapHint: string;
  commonSymptomsHint: string;
  continue: string;
  // Interview
  interviewTitle: string;
  // Result
  resultTitle: string;
  possibleCauses: string;
  whatToDoNext: string;
  careOptions: string;
  selfCareTitle: string;
  saveToRecords: string;
  savedToRecords: string;
  setReminder: string;
  rateThis: string;
  done: string;
  // Language toggle
  language: string;
}

const en: TriageStrings = {
  appName: 'Symptom Checker',
  appTagline: 'Check your symptoms in your language. Not a diagnosis — guidance on what to do next.',
  disclaimer:
    'This is guidance only, not a medical diagnosis. In an emergency, seek in-person care immediately.',
  notADiagnosis:
    'These are possible causes only — not a diagnosis. A clinician must confirm what is going on.',
  emergencyShortcut: 'Emergency',
  emergencyTitle: 'Seek emergency care now',
  emergencySubtitle: 'Your answers suggest this may be serious. Do not wait.',
  callAmbulance: 'Call ambulance',
  nearestEr: 'Nearest emergency room',
  firstAidTitle: 'While you wait — first aid',
  childCaution:
    'This check is for a child. Children can get worse quickly — when in doubt, see a clinician.',
  maternalCaution:
    'This check is for someone who is pregnant. Some symptoms need urgent maternal care — favour seeing a clinician.',
  whoIsThisFor: 'Who is this check for?',
  consentTitle: 'Before we start',
  consentBody:
    'I understand this Symptom Checker gives triage and navigation guidance only, not a diagnosis or treatment, and I agree to my health data being used to provide this guidance.',
  consentAgree: 'I understand and agree',
  startCheck: 'Start symptom check',
  intakeTitle: 'What is happening?',
  intakePrompt: 'Describe how you feel in your own words.',
  intakePlaceholder: 'e.g. I have had a fever and headache since yesterday…',
  bodyMapHint: 'Or tap where it hurts',
  commonSymptomsHint: 'Or pick a common symptom',
  continue: 'Continue',
  interviewTitle: 'A few questions',
  resultTitle: 'What to do next',
  possibleCauses: 'Possible causes',
  whatToDoNext: 'What to do next',
  careOptions: 'Get care',
  selfCareTitle: 'Self-care guidance',
  saveToRecords: 'Save to my health records',
  savedToRecords: 'Saved to your health records',
  setReminder: 'Remind me to check in',
  rateThis: 'Was this helpful?',
  done: 'Done',
  language: 'Language',
};

// Pidgin (pcm) — stubbed: a handful of high-value strings localised, the rest
// fall back to English for now. Safe to expand without code changes.
const pcm: TriageStrings = {
  ...en,
  appTagline: 'Check wetin dey worry you for your language. No be diagnosis — na guide on wetin to do next.',
  disclaimer:
    'Na guide this one be, no be doctor diagnosis. If e be emergency, find person care sharp-sharp.',
  notADiagnosis:
    'Na possible cause this ones be — no be diagnosis. Doctor must confirm wetin dey happen.',
  emergencyShortcut: 'Emergency',
  emergencyTitle: 'Find emergency care now-now',
  emergencySubtitle: 'Wetin you talk fit be serious. No wait.',
  callAmbulance: 'Call ambulance',
  childCaution:
    'Na pikin this check be for. Pikin fit worse quick-quick — if you no sure, make una see doctor.',
  maternalCaution:
    'Na person wey dey pregnant this check be for. Some signs need maternal care sharp — better make una see doctor.',
  whoIsThisFor: 'Who this check be for?',
  consentTitle: 'Before we start',
  consentAgree: 'I understand, I gree',
  startCheck: 'Start the check',
  intakeTitle: 'Wetin dey happen?',
  intakePrompt: 'Talk how your body dey feel for your own words.',
  intakePlaceholder: 'e.g. My body dey hot and head dey pain me since yesterday…',
  bodyMapHint: 'Or tap where e dey pain you',
  commonSymptomsHint: 'Or pick something wey common',
  continue: 'Continue',
  resultTitle: 'Wetin to do next',
  possibleCauses: 'Possible causes',
  whatToDoNext: 'Wetin to do next',
  careOptions: 'Get care',
  saveToRecords: 'Save am to my health records',
  savedToRecords: 'We don save am to your health records',
  rateThis: 'This one help you?',
  done: 'Done',
  language: 'Language',
};

const PACKS: Record<Language, TriageStrings> = { en, pcm };

export function t(lang: Language): TriageStrings {
  return PACKS[lang] ?? en;
}

export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'pcm', label: 'Pidgin' },
];
