-- Paymax Invest · Learn Center — education-first investing-literacy surface.
-- Backs backend/internal/learn (routes /api/v1/learn/*). Mirrors the mobile
-- contract in mobile-app/reactnative/src/features/learn.
--
-- ADDITIVE-ONLY. Content (paths / lessons / quizzes / glossary) is server-driven
-- config seeded here. The only mutation is quiz submission, scored server-side:
-- the answer key (learn_quiz_options.is_correct) is NEVER serialised to clients.
-- No money path exists in this module. RLS: content is readable by any
-- authenticated member; per-user progress/attempts are owner-scoped;
-- service_role bypasses for the Go backend writes.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- Content config: paths → lessons → quizzes → questions → options + glossary.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.learn_paths (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon_color  text NOT NULL DEFAULT '#000000',
  level       text NOT NULL DEFAULT 'beginner'
                CHECK (level IN ('beginner','stock','crypto','wealth')),
  sort_order  int  NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.learn_lessons (
  id            text PRIMARY KEY,
  path_id       text NOT NULL REFERENCES public.learn_paths(id) ON DELETE CASCADE,
  title         text NOT NULL,
  duration_mins int  NOT NULL DEFAULT 0 CHECK (duration_mins >= 0),
  kind          text NOT NULL DEFAULT 'article' CHECK (kind IN ('article','video')),
  body          text NOT NULL DEFAULT '',
  summary       text NOT NULL DEFAULT '',
  sort_order    int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learn_lessons_path ON public.learn_lessons (path_id, sort_order);

CREATE TABLE IF NOT EXISTS public.learn_quizzes (
  id         text PRIMARY KEY,
  lesson_id  text NOT NULL UNIQUE REFERENCES public.learn_lessons(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.learn_quiz_questions (
  id         text PRIMARY KEY,
  quiz_id    text NOT NULL REFERENCES public.learn_quizzes(id) ON DELETE CASCADE,
  prompt     text NOT NULL,
  sort_order int  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_learn_quiz_questions_quiz ON public.learn_quiz_questions (quiz_id, sort_order);

-- is_correct is the ANSWER KEY. It is only ever read server-side during scoring
-- and is scrubbed from the client-facing quiz payload.
CREATE TABLE IF NOT EXISTS public.learn_quiz_options (
  id          text PRIMARY KEY,
  question_id text NOT NULL REFERENCES public.learn_quiz_questions(id) ON DELETE CASCADE,
  label       text NOT NULL,
  is_correct  boolean NOT NULL DEFAULT false,
  sort_order  int  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_learn_quiz_options_q ON public.learn_quiz_options (question_id, sort_order);

CREATE TABLE IF NOT EXISTS public.learn_glossary (
  term       text PRIMARY KEY,
  definition text NOT NULL
);

-- ════════════════════════════════════════════════════════════════════════════
-- Per-learner state: lesson completion (drives path progress) + quiz attempts.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.learn_lesson_progress (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id    text NOT NULL REFERENCES public.learn_lessons(id) ON DELETE CASCADE,
  completed    boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_learn_progress_user ON public.learn_lesson_progress (user_id);

CREATE TABLE IF NOT EXISTS public.learn_quiz_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quiz_id    text NOT NULL REFERENCES public.learn_quizzes(id) ON DELETE CASCADE,
  score      int  NOT NULL CHECK (score >= 0),
  total      int  NOT NULL CHECK (total >= 0),
  passed     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learn_attempts_user ON public.learn_quiz_attempts (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.learn_paths           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_lessons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_quizzes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_quiz_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_quiz_options    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_glossary        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_quiz_attempts   ENABLE ROW LEVEL SECURITY;

-- Content: any authenticated member may read. NOTE: quiz options include the
-- answer key; the Go service scrubs is_correct before serialising, and the
-- backend uses the service_role connection, so direct client reads of the key
-- are not a practical vector — but keep option reads authenticated-only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['learn_paths','learn_lessons','learn_quizzes','learn_quiz_questions','learn_quiz_options','learn_glossary']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (TRUE)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I TO service_role USING (TRUE) WITH CHECK (TRUE)', t, t);
  END LOOP;
END $$;

-- Per-learner state: owner-scoped reads; service_role writes.
DROP POLICY IF EXISTS learn_progress_own ON public.learn_lesson_progress;
CREATE POLICY learn_progress_own ON public.learn_lesson_progress
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS learn_progress_service ON public.learn_lesson_progress;
CREATE POLICY learn_progress_service ON public.learn_lesson_progress
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS learn_attempts_own ON public.learn_quiz_attempts;
CREATE POLICY learn_attempts_own ON public.learn_quiz_attempts
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS learn_attempts_service ON public.learn_quiz_attempts;
CREATE POLICY learn_attempts_service ON public.learn_quiz_attempts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- Seed content (matches the mobile learn.mock.ts fixtures so a flipped client
-- renders identical copy). Idempotent via ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.learn_paths (id, title, description, icon_color, level, sort_order) VALUES
  ('path_beginner','Investing Basics','Start here: what investing is, risk vs return, and diversification.','#2563EB','beginner',1),
  ('path_stock','Stock Market 101','Understand shares, quotes and how the market works.','#0EA5A4','stock',2),
  ('path_crypto','Crypto Foundations','Learn how crypto works and how to stay safe.','#F59E0B','crypto',3),
  ('path_wealth','Spotlight Wealth','Build a long-term plan: goals, compounding, and staying the course.','#D4AF37','wealth',4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.learn_lessons (id, path_id, title, duration_mins, kind, summary, body, sort_order) VALUES
  ('les_basics','path_beginner','What is investing?',4,'article','Putting money to work so it can grow over time.','Investing means committing money today in the hope that it grows into more money over time. Instead of leaving cash idle, you buy an asset that you expect to rise in value or pay you income.'||chr(10)||chr(10)||'The trade-off is risk. Prices move up and down, and there is no guarantee you get back what you put in.'||chr(10)||chr(10)||'A useful mindset for beginners: invest only money you will not need soon, start small, and give your investments years rather than days.',1),
  ('les_risk_return','path_beginner','Risk and return',5,'article','Higher potential returns come with higher risk.','Every investment sits on a spectrum between safety and growth. Cash and government bonds are relatively stable but grow slowly. Stocks and crypto can grow faster, but their prices can also fall sharply.'||chr(10)||chr(10)||'This is the risk–return trade-off: there is no free lunch.',2),
  ('les_diversify','path_beginner','Why diversification matters',4,'article','Don''t put all your eggs in one basket.','Diversification means spreading your money across different assets so that no single one can sink your whole portfolio.'||chr(10)||chr(10)||'Funds and ETFs make diversification easy.',3),
  ('les_what_is_stock','path_stock','What is a stock?',5,'article','A share is part-ownership of a real business.','A stock is a slice of ownership in a company. Shareholders can earn money two ways: the share price rising over time, and dividends.',1),
  ('les_read_quote','path_stock','Reading a stock quote',5,'article','What the numbers on a stock ticker mean.','A stock quote shows the last traded price plus context: the day''s range, volume, and how the price has moved.',2),
  ('les_crypto_basics','path_crypto','Crypto basics',6,'article','What crypto is and how it is recorded.','Cryptocurrency is a digital asset whose transactions are recorded on a blockchain maintained by a network of computers rather than a single central authority.'||chr(10)||chr(10)||'For most people crypto belongs as a small, high-risk slice of a wider mix.',1),
  ('les_crypto_safety','path_crypto','Staying safe in crypto',5,'article','Spotting scams and protecting your wallet.','Treat any promise of guaranteed returns as a warning sign. Protect your keys, verify addresses, and never share your recovery phrase.',2),
  ('les_goals','path_wealth','Setting money goals',4,'article','Turn vague wishes into concrete targets.','A good goal has a number and a date. Breaking a big goal into monthly amounts makes it achievable.',1),
  ('les_compounding','path_wealth','The power of compounding',5,'article','Earning returns on your returns.','Compounding means earning returns on both your original money and the returns it has already generated. Time is its most important ingredient.',2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.learn_quizzes (id, lesson_id) VALUES
  ('quiz_basics','les_basics'),
  ('quiz_crypto','les_crypto_basics')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.learn_quiz_questions (id, quiz_id, prompt, sort_order) VALUES
  ('quiz_basics_q1','quiz_basics','What is the main reason people invest rather than hold cash?',1),
  ('quiz_basics_q2','quiz_basics','Which mindset suits a beginner investor best?',2),
  ('quiz_basics_q3','quiz_basics','What is the trade-off for the chance of higher returns?',3),
  ('quiz_crypto_q1','quiz_crypto','What records cryptocurrency transactions?',1),
  ('quiz_crypto_q2','quiz_crypto','How should most people treat crypto in a portfolio?',2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.learn_quiz_options (id, question_id, label, is_correct, sort_order) VALUES
  ('quiz_basics_q1_a','quiz_basics_q1','To guarantee they never lose money',false,1),
  ('quiz_basics_q1_b','quiz_basics_q1','To aim for growth that beats cash, especially after inflation',true,2),
  ('quiz_basics_q1_c','quiz_basics_q1','Because cash is illegal to hold',false,3),
  ('quiz_basics_q1_d','quiz_basics_q1','To avoid ever paying any fees',false,4),
  ('quiz_basics_q2_a','quiz_basics_q2','Invest money you need next week for quick gains',false,1),
  ('quiz_basics_q2_b','quiz_basics_q2','Borrow heavily to maximise returns',false,2),
  ('quiz_basics_q2_c','quiz_basics_q2','Start small and invest for the long term',true,3),
  ('quiz_basics_q2_d','quiz_basics_q2','Check prices every hour and trade often',false,4),
  ('quiz_basics_q3_a','quiz_basics_q3','Accepting more risk',true,1),
  ('quiz_basics_q3_b','quiz_basics_q3','Paying no tax',false,2),
  ('quiz_basics_q3_c','quiz_basics_q3','Getting guaranteed income',false,3),
  ('quiz_basics_q3_d','quiz_basics_q3','Lower volatility',false,4),
  ('quiz_crypto_q1_a','quiz_crypto_q1','A single central bank',false,1),
  ('quiz_crypto_q1_b','quiz_crypto_q1','A blockchain maintained by a network',true,2),
  ('quiz_crypto_q1_c','quiz_crypto_q1','A government spreadsheet',false,3),
  ('quiz_crypto_q1_d','quiz_crypto_q1','Nobody — they are not recorded',false,4),
  ('quiz_crypto_q2_a','quiz_crypto_q2','As a risk-free savings account',false,1),
  ('quiz_crypto_q2_b','quiz_crypto_q2','As the only thing they own',false,2),
  ('quiz_crypto_q2_c','quiz_crypto_q2','As a small, high-risk slice of a wider mix',true,3),
  ('quiz_crypto_q2_d','quiz_crypto_q2','As a guaranteed way to get rich',false,4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.learn_glossary (term, definition) VALUES
  ('Asset','Anything you own that has value and may grow or earn income, such as a stock, bond, fund, or crypto.'),
  ('Bear market','A prolonged period of falling prices, usually a drop of 20% or more from recent highs.'),
  ('Bull market','A prolonged period of rising prices and general optimism.'),
  ('Blockchain','A shared, tamper-resistant digital ledger that records crypto transactions across a network of computers.'),
  ('Bond','A loan you make to a government or company that pays interest and returns the principal at maturity.'),
  ('Compounding','Earning returns on both your original money and the returns it has already generated.'),
  ('Diversification','Spreading money across different assets so no single one can sink your portfolio.'),
  ('Dividend','A cash payment some companies make to shareholders out of their profits.'),
  ('ETF','An exchange-traded fund — a basket of assets you can buy as a single, tradable investment.'),
  ('Inflation','The gradual rise in prices over time, which erodes the spending power of cash.'),
  ('Liquidity','How easily an asset can be bought or sold without moving its price.'),
  ('Market cap','The total value of a company or crypto: its price multiplied by the number of units outstanding.'),
  ('Portfolio','The full collection of investments a person or institution holds.'),
  ('Volatility','How much and how quickly a price moves up and down; higher volatility means a bumpier ride.'),
  ('Yield','The income an investment produces, expressed as a percentage of its price.')
ON CONFLICT (term) DO NOTHING;

COMMIT;
