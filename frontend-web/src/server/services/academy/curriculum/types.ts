// The shape of an authored pathway.
//
// This is plain data, deliberately separate from the seeder that writes it, so a
// module can be reviewed and edited as content rather than as code.
//
// Every `videoUrl` in this pathway was verified against YouTube's oEmbed endpoint
// (which resolves only for a live, embeddable video) and attributed to its real
// channel before being written down. A lesson with no verified video carries an
// empty string rather than a plausible-looking URL that 404s.

export type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false';

export interface QuizQuestion {
  /** Shown to the learner. */
  text: string;
  type: QuestionType;
  /** Rendered as the choices. Compared verbatim, so keep them stable. */
  options: string[];
  /**
   * Must contain the exact option strings. The grader trims and sorts both sides
   * and compares element-wise, so order is free but spelling and case are not.
   */
  correct: string[];
  points: number;
  /** Shown after grading — the teaching happens here. */
  explanation: string;
}

export interface Lesson {
  title: string;
  description: string;
  /** The lecture itself. Markdown. */
  content: string;
  /** Verified, or '' — never a guess. */
  videoUrl: string;
  resourceUrl?: string;
  resourceLabel?: string;
  minutes: number;
  required?: boolean;
}

export interface Assignment {
  title: string;
  brief: string;
  rubric: string;
  maxScore: number;
  /** Days after enrolment. The seeder turns this into a date. */
  dueInDays: number;
}

export interface Quiz {
  title: string;
  description: string;
  passMark: number;
  timeLimitMinutes: number;
  maxAttempts: number;
  questions: QuizQuestion[];
}

export interface Module {
  title: string;
  description: string;
  lessons: Lesson[];
  quiz: Quiz;
  assignment?: Assignment;
}

export interface Tier {
  /** 1-based. Modules are ordered tier by tier. */
  level: number;
  name: string;
  summary: string;
  modules: Module[];
  /** A wider assessment across the tier. Carries no module_id. */
  assessment?: Quiz;
}

export interface Pathway {
  name: string;
  summary: string;
  tiers: Tier[];
}
