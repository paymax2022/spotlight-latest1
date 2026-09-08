// Tier 4 — Business. How a film gets paid for, protected, sold and seen.
import type { Tier } from './types';

export const TIER_4: Tier = {
  level: 4,
  name: 'Producing and Business',
  summary:
    'Schedule, budget, rights, finance and distribution — with a Nigerian market focus. You will finish able to break down a script, build a defensible budget, and explain how your film reaches an audience and returns money.',
  modules: [
    {
      title: 'Breakdown, Schedule and Budget',
      description: 'Turning a script into a plan and a number.',
      lessons: [
        {
          title: 'The Script Breakdown',
          description: 'Extracting every element a scene requires.',
          content: `# Every scene is a shopping list

A breakdown goes through the script scene by scene and extracts every element: cast, extras, locations, props, costume, make-up, vehicles, animals, stunts, VFX, special equipment.

The unit is the **eighth of a page** — a page divided into eight, the industry's smallest scheduling measure. A 3/8 scene is short; a 2 4/8 scene is substantial.

## Why it must be exhaustive

Anything not on the breakdown is not budgeted, not scheduled, and will not be there on the day. The commonest omission on low-budget shoots is the small prop that turns out to be central — a letter, a phone with a specific screen, a photograph.

## Then: the stripboard

Each scene becomes a strip carrying its number, page count, cast, location and day/night. Strips are then rearranged into a **shooting order** grouped by location and lighting condition — which is why the film shoots out of order.

## Day out of days

For each cast member, which days they work. This drives contracts and cost, and it is where a schedule quietly becomes expensive: an actor held across two weeks for three days' work is usually paid for the gap.`,
          videoUrl: '',
          minutes: 30,
        },
        {
          title: 'Building a Budget That Survives Contact',
          description: 'Above and below the line, contingency, and the lines beginners forget.',
          content: `# The shape of a budget

**Above the line** — story rights, writer, producer, director, principal cast. Decided early, hard to change.

**Below the line** — crew, equipment, locations, art, transport, catering: the cost of actually shooting.

**Post and delivery** — edit, sound, grade, music, deliverables, festival fees.

**Contingency** — typically 10%. A budget without contingency is not a budget; it is a wish.

## The lines beginners forget

- Insurance, and it is usually mandatory for locations and equipment.
- Transport and fuel — significant in Nigerian production, and volatile.
- Catering. Underfeeding a crew costs more in lost hours than the food saved.
- Hard drives and backup. Every production, every time.
- Contingency for weather, which in a rainy season is not an edge case.
- Post supervision, which is real work someone must do.

## Honesty

A budget's purpose is to be true, not to be approved. An under-budgeted film does not become cheap; it becomes unfinished — and unfinished is the most expensive outcome of all.`,
          videoUrl: 'https://www.youtube.com/watch?v=6b_2I7zuhYU',
          resourceLabel: 'Film funding — budget breakdowns and investor appeal',
          minutes: 30,
        },
        {
          title: 'Scheduling Reality',
          description: 'Page counts, day length and what actually goes wrong.',
          content: `# What a day holds

A realistic day for a small drama crew is **2 to 4 pages**, depending on setups, cast and location moves. Ambitious independent schedules routinely assume 6 to 8 and then lose scenes.

## The expensive events

1. **Company moves.** Budget at least two hours, honestly. Two moves in a day usually means losing a scene.
2. **Relights.** A significant lighting change is not free because the camera did not move.
3. **Night for day, day for night.** Both are slower than anyone plans.
4. **Children and animals.** Statutory limits and unpredictability.

## Protecting the film

Schedule the **hardest scene** when the crew is fresh and the schedule still has slack — never on the last day, where it has no room to fail.

Identify your **drop scenes** in advance: the ones you will lose if you must. Deciding under pressure at 8pm on day four produces the wrong choice.`,
          videoUrl: '',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Breakdown, Schedule and Budget',
        description: 'Eighths, stripboards, contingency and realistic days.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What is the standard smallest unit of scheduling measurement?',
            type: 'single_choice',
            options: ['One page', 'One scene', 'One eighth of a page', 'One minute of screen time'],
            correct: ['One eighth of a page'],
            points: 2,
            explanation: 'Eighths let scenes of very different lengths be compared, scheduled and costed on one scale.',
          },
          {
            text: 'A realistic daily page count for a small drama crew is roughly…',
            type: 'single_choice',
            options: ['1 page', '2 to 4 pages', '6 to 8 pages', '10 pages'],
            correct: ['2 to 4 pages'],
            points: 2,
            explanation: 'Independent schedules that assume 6-8 pages routinely lose scenes. Setups, cast and location moves are what consume the day.',
          },
          {
            text: 'A budget with no contingency line is…',
            type: 'single_choice',
            options: ['Lean and competitive', 'Not a budget — every production has overruns', 'Acceptable on short films', 'Standard for documentary'],
            correct: ['Not a budget — every production has overruns'],
            points: 2,
            explanation: 'Around 10% is normal. Without it the first surprise is paid for by cutting something you needed.',
          },
          {
            text: 'The hardest scene should be scheduled for the last day, when the crew knows the material best.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'The last day has no slack. If the hard scene fails there, there is nowhere to recover it — schedule it while the crew is fresh and time remains.',
          },
          {
            text: 'Which budget lines do beginners most often omit? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Insurance', 'Catering', 'Hard drives and backup', 'Principal cast fees'],
            correct: ['Insurance', 'Catering', 'Hard drives and backup'],
            points: 3,
            explanation: 'Cast fees are always remembered. Insurance, food and storage are invisible until their absence stops the shoot — underfeeding a crew costs more in lost hours than the food saved.',
          },
        ],
      },
      assignment: {
        title: 'Break Down and Schedule Your Short',
        brief: 'Produce a full breakdown of your short film script in eighths, listing every element per scene. Build a stripboard and a shooting order grouped by location and lighting. Then produce a budget with above-the-line, below-the-line, post and a contingency. Mark your two drop scenes.',
        rubric: 'Breakdown is exhaustive, including small props (15) · Shooting order minimises moves and relights (10) · Budget includes insurance, catering, storage and contingency (10) · Drop scenes identified with reasoning (5)',
        maxScore: 40,
        dueInDays: 21,
      },
    },
    {
      title: 'Rights, Contracts and Chain of Title',
      description: 'Owning what you made, and being able to prove it.',
      lessons: [
        {
          title: 'Chain of Title',
          description: 'The paperwork without which your film cannot be sold.',
          content: `# You must be able to prove you own it

**Chain of title** is the documentary trail showing you hold every right in the film. No distributor, platform or financier will proceed without it, and no amount of quality substitutes.

## What it consists of

- **Underlying rights** — if adapted, the option or purchase agreement.
- **Writer's agreement** — assigning the screenplay's rights to the production.
- **Director and producer agreements.**
- **Cast agreements**, including the right to use likeness and performance.
- **Crew agreements** assigning any authorship in their contributions.
- **Music licences** — composition and master, as covered in Module 18.
- **Location agreements.**
- **Any third-party material** — footage, photographs, artwork, brands.

## The commonest failures

A film shot with friends on a handshake. A track cleared for festivals only. A logo visible on a wall nobody cleared. Each can stop a sale.

## The fix is cheap and early

Every one of these documents costs almost nothing to obtain **before** shooting, and can become impossible afterwards — the actor who has moved abroad, the location owner who has sold up.`,
          videoUrl: 'https://www.youtube.com/watch?v=6b_2I7zuhYU',
          minutes: 30,
        },
        {
          title: 'Contracts You Will Actually Sign',
          description: 'Deal memos, releases and the clauses that matter.',
          content: `# Read the clauses that bite

**The deal memo.** Role, dates, fee, payment terms, credit, and what happens on overrun. Short is fine; vague is not.

**The performer release.** Consent to record and to use the performance, with stated media and territory. Covered in Module 6 — consent is specific, informed and revocable up to the point stated.

**The location agreement.** Dates, hours, what you may alter, restoration, and liability.

**Crew agreements.** Assignment of rights, confidentiality where relevant, and safety obligations.

## Clauses to look for

- **Payment terms.** "On delivery" of what, verified by whom, within how many days?
- **Credit.** Position and size — this is contractual, as Module 19 covered.
- **Termination.** What happens if the production stops.
- **Moral rights** and their waiver, which varies by jurisdiction.

## A practical rule

If you do not understand a clause, do not sign it and do not ask the other side to explain it. Ask someone who acts for you.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Copyright in Nigeria and Beyond',
          description: 'What copyright protects, and how it is enforced in practice.',
          content: `# The basics

Copyright protects the **expression**, not the idea. Two films about the same premise are both legitimate; copying the particular way one was written is not.

In Nigeria, copyright arises on creation, and registration with the Nigerian Copyright Commission provides evidentiary support in a dispute rather than creating the right. Nigeria is a party to the Berne Convention, so protection extends to other member states.

## Practical protection

- **Register** the screenplay and the finished film.
- **Keep dated records** of drafts and delivery.
- **Watermark** screeners sent for consideration.
- **Contract clearly** with everyone who contributes.

## Piracy

Nigerian filmmakers face a distribution environment where piracy is a first-order commercial threat rather than a background nuisance. Practical responses include controlled screener distribution, staggered release windows, timely legitimate availability at an accessible price, and enforcement against the largest infringers rather than all of them.

The most effective anti-piracy measure remains making the legitimate version easy and affordable to obtain first.

*This module gives you the vocabulary to instruct a lawyer. It is not legal advice, and a real production should take advice on its own facts.*`,
          videoUrl: 'https://www.youtube.com/watch?v=sQwhQ4P4eFU',
          resourceLabel: 'The financial reality of Nollywood cinema',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Rights and Contracts',
        description: 'Chain of title, contract clauses and copyright.',
        passMark: 75,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What is chain of title?',
            type: 'single_choice',
            options: ['The credit order in the titles', 'The documentary trail proving you hold every right in the film', 'The distribution agreement', 'The order of ownership of the camera negative'],
            correct: ['The documentary trail proving you hold every right in the film'],
            points: 3,
            explanation: 'No distributor, platform or financier proceeds without it, and quality is no substitute. It is assembled before shooting, cheaply — or afterwards, sometimes impossibly.',
          },
          {
            text: 'Copyright protects…',
            type: 'single_choice',
            options: ['The idea', 'The expression of the idea', 'The title', 'The genre'],
            correct: ['The expression of the idea'],
            points: 2,
            explanation: 'Two films may share a premise legitimately. What is protected is the particular way it was written and made.',
          },
          {
            text: 'In Nigeria, registration with the Copyright Commission…',
            type: 'single_choice',
            options: ['Creates the copyright', 'Provides evidentiary support in a dispute', 'Is required before distribution', 'Extends protection to Berne states'],
            correct: ['Provides evidentiary support in a dispute'],
            points: 2,
            explanation: 'The right arises on creation. Registration helps you prove it. Berne membership is what extends protection abroad.',
          },
          {
            text: 'A film shot with friends on a handshake can usually be cleared later.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 3,
            explanation: 'People move, relationships change, leverage shifts once the film exists. Documents that cost nothing before the shoot can become impossible afterwards.',
          },
          {
            text: 'Which belong in chain of title? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Writer\'s agreement assigning the screenplay', 'Cast agreements covering likeness and performance', 'Location agreements', 'The shooting schedule'],
            correct: ['Writer\'s agreement assigning the screenplay', 'Cast agreements covering likeness and performance', 'Location agreements'],
            points: 3,
            explanation: 'The schedule is a production document, not a rights document. Chain of title is exclusively about what you own and from whom.',
          },
        ],
      },
      assignment: {
        title: 'Chain of Title File',
        brief: 'Assemble a chain-of-title file for your short: list every right required, who holds it, and which document transfers it. Draft or obtain at least three of those documents — a performer release, a location agreement and a crew deal memo. Identify any right you do NOT currently hold and how you would obtain it.',
        rubric: 'The list of required rights is complete (15) · Three documents are usable and specific (15) · Gaps honestly identified (10)',
        maxScore: 40,
        dueInDays: 21,
      },
    },
    {
      title: 'Financing a Film',
      description: 'Where the money comes from, what it costs, and what it wants back.',
      lessons: [
        {
          title: 'Sources of Finance',
          description: 'Equity, pre-sales, grants, brands and self-funding.',
          content: `# Money has conditions attached

**Equity investment.** An investor buys a share of the film's returns. They rank in a **recoupment waterfall** — the order in which money coming back is paid out. Where you sit in that waterfall matters more than the headline figure.

**Pre-sales.** A distributor commits to buy for a territory before the film exists. Converts a promise into finance, usually at a discount.

**Grants and funds.** Public and institutional bodies. Non-recoupable or soft, but with obligations — reporting, deadlines, sometimes content or local-spend conditions.

**Brand and product placement.** Real money in the Nigerian market, with a real cost: creative control, and an obligation to feature things the story may not want.

**Self-funding and deferrals.** Common on first films. Deferrals are only honest if the recoupment schedule is written down.

## The question every financier asks

Not "is it good?" but **"how does this money come back?"** A finance conversation you cannot answer that question in is a conversation that ends.`,
          videoUrl: 'https://www.youtube.com/watch?v=6b_2I7zuhYU',
          minutes: 30,
        },
        {
          title: 'The Pitch and the Deck',
          description: 'What is actually in a package that gets read.',
          content: `# The package

**The logline.** One sentence: who wants what, and what stands in the way.

**The synopsis.** One page. The whole story including the ending — investors are not an audience and do not want the twist protected.

**The deck.** Comparable films with actual numbers, the audience, the budget top-sheet, the finance plan, key attachments, and the team with what they have made before.

**The pitch.** Two minutes, spoken, no slides. If you cannot do this, the deck will not save you.

## What comparables are for

"Comparable" means comparable in **budget, audience and route to market** — not in ambition. Citing a ₦2bn film as a comparable for a ₦20m one signals that you have not thought about the market.

## The team slide

For a first film, this slide is doing more work than any other. Attachments — a known cast member, an experienced DOP, a producer with a track record — de-risk the film in the only way an investor can assess.`,
          videoUrl: 'https://www.youtube.com/watch?v=sQwhQ4P4eFU',
          minutes: 25,
        },
        {
          title: 'Recoupment and Realistic Expectations',
          description: 'How money actually comes back, and in what order.',
          content: `# The waterfall

Money returning from a film is paid out in a fixed order, typically:

1. Distribution fees and expenses.
2. Sales agent commission.
3. Senior debt.
4. Equity investors, to the point of recoupment.
5. Then **profit** is shared — between investors and, at the end, the filmmakers.

Note where the filmmakers sit. Points on "profit" often mean nothing at all; that is not cynicism, it is arithmetic.

## Being honest with investors

An investor told a film will definitely return their money has been misled. Independent films frequently do not. What you can honestly offer is: a defensible plan, a real route to market, controlled costs, and complete transparency about risk.

## The Nigerian market specifically

Cinema returns are concentrated in a small number of screens; streaming licences from local and international platforms have become a significant route; and the informal market is large and hard to monetise. A finance plan built on a single route is fragile — plans that work usually combine two or three.`,
          videoUrl: 'https://www.youtube.com/watch?v=niBuRmpFvPc',
          resourceLabel: 'Film distribution masterclass',
          minutes: 30,
        },
      ],
      quiz: {
        title: 'Quiz — Financing',
        description: 'Sources, packaging and the recoupment waterfall.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What is a recoupment waterfall?',
            type: 'single_choice',
            options: ['The rate at which a film loses value', 'The fixed order in which returning money is paid out', 'A distribution schedule', 'The marketing spend curve'],
            correct: ['The fixed order in which returning money is paid out'],
            points: 2,
            explanation: 'Where you sit in that order matters far more than the headline investment figure — and filmmakers usually sit near the bottom.',
          },
          {
            text: 'What makes a film a valid "comparable"?',
            type: 'single_choice',
            options: ['Similar artistic ambition', 'Similar budget, audience and route to market', 'The same genre', 'The same director'],
            correct: ['Similar budget, audience and route to market'],
            points: 2,
            explanation: 'Citing a ₦2bn film as a comparable for a ₦20m one tells an investor you have not thought about the market.',
          },
          {
            text: 'The question every financier is actually asking is…',
            type: 'single_choice',
            options: ['"Is the script good?"', '"How does this money come back?"', '"Who is directing?"', '"What festivals will it play?"'],
            correct: ['"How does this money come back?"'],
            points: 2,
            explanation: 'Quality matters to the extent it drives return. A finance conversation in which you cannot answer this ends there.',
          },
          {
            text: 'A synopsis for investors should withhold the ending to preserve the twist.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Investors are not an audience. They are assessing whether the story works, and they need the ending to do that.',
          },
          {
            text: 'Which carry obligations beyond repayment? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Grants with reporting and local-spend conditions', 'Brand placement requiring products on screen', 'Pre-sales committing delivery to a territory', 'Personal savings'],
            correct: ['Grants with reporting and local-spend conditions', 'Brand placement requiring products on screen', 'Pre-sales committing delivery to a territory'],
            points: 3,
            explanation: 'Each brings conditions that shape the film itself — content, deadlines, deliverables. Only self-funding is free of external obligation, which is its one advantage.',
          },
        ],
      },
      assignment: {
        title: 'Finance Plan and Deck',
        brief: 'Produce a finance plan for your short or first feature: every source, the amount, what it wants in return, and where it sits in the waterfall. Then build a six-slide deck — logline, synopsis, comparables with real numbers, budget top-sheet, finance plan, team. Include a written two-minute pitch.',
        rubric: 'Finance plan combines more than one route (10) · Waterfall position stated for each source (10) · Comparables genuinely comparable on budget and market (10) · Pitch answers "how does the money come back" (10)',
        maxScore: 40,
        dueInDays: 21,
      },
    },
    {
      title: 'Distribution, Festivals and Streaming',
      description: 'Getting the film in front of an audience.',
      lessons: [
        {
          title: 'The Routes to an Audience',
          description: 'Cinema, streaming, broadcast, festivals and direct.',
          content: `# Every route has a gatekeeper and a rhythm

**Cinema.** Prestige and a marketing engine, but expensive to service and concentrated in few screens. Nigerian cinema returns are real but narrow.

**Streaming.** Local and international platforms licence content. Terms vary from a flat licence fee to revenue share; exclusivity is usually demanded and its duration is the negotiation.

**Broadcast.** Television licences, often per-territory, with strict technical and content standards.

**Festivals.** Not principally a revenue route — a visibility and credibility route that leads to the others.

**Direct.** Selling to your own audience. Highest margin, hardest work, and viable only if you have built the audience first.

## Windows

The order and timing of these releases. Holding a film back from one window to protect another used to be sacred and is now negotiable — but the sequence still matters, and a platform deal signed early can foreclose a cinema release entirely.`,
          videoUrl: 'https://www.youtube.com/watch?v=niBuRmpFvPc',
          minutes: 30,
        },
        {
          title: 'Festival Strategy',
          description: 'Choosing, submitting and using a festival run.',
          content: `# A festival run is a campaign

**Premiere status matters.** Major festivals want a world, international or regional premiere. Playing a small festival early can disqualify you from a larger one later. Plan the order **before** the first submission.

**Tiers.** A handful of top-tier festivals, a wider band of strong regional and genre festivals, then the long tail. Applying only to the top tier wastes a year; applying only to the long tail wastes the film.

**Costs.** Submission fees accumulate quickly. Budget the festival run as a line item — it is a marketing spend, not an afterthought.

**Deadlines.** Earlier deadlines are cheaper and, at some festivals, considered more carefully.

## What a festival is actually for

Reviews, a sales agent, a distributor, and the next film. Set a goal before you go: a run with no objective produces laurels and nothing else.

## African and Nigerian festivals

AFRIFF, Nollywood Week, Durban and Carthage among others matter for regional visibility, distributor relationships and local press — often more usefully for a Nigerian film's actual commercial life than a marginal placement at a distant major.`,
          videoUrl: 'https://www.youtube.com/watch?v=TLreJgMuNMA',
          minutes: 25,
        },
        {
          title: 'Sales Agents and Deals',
          description: 'Who sells your film, and on what terms.',
          content: `# The sales agent

A sales agent licenses your film to distributors territory by territory. They take a **commission** (commonly 15-25%) and recoup **expenses** — market attendance, materials, marketing — usually before you see anything.

## What to check

- **Term.** How long do they hold the rights? Multi-year terms on a film that does not sell are how films disappear.
- **Territories.** All, or only those they can genuinely service?
- **Expense cap.** Uncapped expenses are how a film with sales returns nothing.
- **Reporting.** How often, in what detail, and can you audit?
- **Reversion.** What happens if they fail to sell — do rights come back, and when?

## Direct deals

Approaching a platform directly is increasingly viable, particularly in the Nigerian market where local platforms actively acquire. You keep the commission; you also do the work and have no leverage from a slate.

## The judgement

An agent is worth their commission if they open doors you cannot. If they are simply forwarding your film to the same contacts you already have, they are not.`,
          videoUrl: 'https://www.youtube.com/watch?v=niBuRmpFvPc',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Distribution and Festivals',
        description: 'Routes, windows, premiere status and sales terms.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'Why does premiere status matter?',
            type: 'single_choice',
            options: ['It affects ticket prices', 'Playing a small festival early can disqualify the film from a larger one', 'It determines the licence fee', 'It is required for streaming'],
            correct: ['Playing a small festival early can disqualify the film from a larger one'],
            points: 2,
            explanation: 'Major festivals want a world, international or regional premiere. The order of submissions must be planned before the first one goes in.',
          },
          {
            text: 'In a sales agency agreement, the most dangerous term to leave open is…',
            type: 'single_choice',
            options: ['The commission percentage', 'Uncapped recoupable expenses', 'The delivery date', 'The territory list'],
            correct: ['Uncapped recoupable expenses'],
            points: 2,
            explanation: 'Expenses are recouped before you see anything. Uncapped, they can consume the entirety of a film\'s sales.',
          },
          {
            text: 'Festivals are principally…',
            type: 'single_choice',
            options: ['A revenue route', 'A visibility and credibility route that leads to the others', 'A legal requirement for distribution', 'A way to test the edit'],
            correct: ['A visibility and credibility route that leads to the others'],
            points: 2,
            explanation: 'Set an objective before the run — reviews, a sales agent, a distributor, the next film. A run with no goal produces laurels and nothing else.',
          },
          {
            text: 'A streaming deal signed early can foreclose a cinema release.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['True'],
            points: 2,
            explanation: 'Exclusivity and windowing terms routinely rule out a theatrical window. The sequence of releases must be decided before the first deal is signed.',
          },
          {
            text: 'What should you check in a sales agreement? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Term length', 'Whether rights revert if the film does not sell', 'Reporting frequency and audit rights', 'The agent\'s office location'],
            correct: ['Term length', 'Whether rights revert if the film does not sell', 'Reporting frequency and audit rights'],
            points: 3,
            explanation: 'A multi-year term with no reversion on a film that does not sell is how films disappear entirely for the length of the deal.',
          },
        ],
      },
      assignment: {
        title: 'Distribution Plan',
        brief: 'Write a distribution plan for your film: the routes you will pursue in order, the windows and why that sequence, a festival strategy naming at least six specific festivals with deadlines and fees across tiers, and a stated objective for the run. Include what you would and would not accept in a sales agreement.',
        rubric: 'Route sequence is justified, not just listed (10) · Festivals are real, dated and tiered (10) · Objective for the run is specific (10) · Sales terms show understanding of expenses and reversion (10)',
        maxScore: 40,
        dueInDays: 21,
      },
    },
    {
      title: 'Marketing, Audience and Release',
      description: 'Building an audience before the film is finished.',
      lessons: [
        {
          title: 'Who Is This For?',
          description: 'Defining an audience specifically enough to reach it.',
          content: `# "Everyone" is not an audience

A film for everyone is marketed to no one. Define the audience concretely: who are they, what else do they watch, where do they spend attention, and what would make them tell someone else about this film?

## The one-line proposition

What does a viewer get from this film that they cannot easily get elsewhere? If the answer is "a good story", you have not answered.

## Building early

Audience-building starts in pre-production, not at delivery:

- Document the making. Behind-the-scenes material is cheap during production and impossible afterwards.
- Photograph properly — a **stills photographer** on key days is one of the highest-return small budget lines there is. Press cannot run an article without images.
- Collect an audience you own: an email list, a subscriber base. Followers on a platform are rented; a list is owned.`,
          videoUrl: 'https://www.youtube.com/watch?v=sQwhQ4P4eFU',
          minutes: 25,
        },
        {
          title: 'Materials That Do the Work',
          description: 'Key art, trailer, synopsis, press kit.',
          content: `# The four things you will be asked for

**Key art.** A single image that communicates genre and tone at thumbnail size. Test it small — that is how it will be seen.

**The trailer.** Sets expectation. The commonest failure is a trailer that promises a different film, which converts an audience that then dislikes what it gets. Second commonest: giving away the turn.

**The synopsis**, in three lengths — one line, one paragraph, one page. You will be asked for all three.

**The press kit** — synopsis, credits, key stills at print resolution, director's statement, contacts. Assembled once, used everywhere.

## The stills problem

Frame grabs are not stills. They are low resolution, badly timed and usually unusable in print. This is why a stills photographer earns their fee: press coverage is gated on images.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Release and Word of Mouth',
          description: 'Timing, press and the thing you cannot buy.',
          content: `# The release

**Timing.** Avoid the weekend a major title opens. Check school terms, public holidays and religious calendars — in the Nigerian market these strongly shape cinema attendance.

**Press.** Approach outlets weeks ahead, not days. Journalists work to lead times, and a screener plus a complete press kit makes covering you easy.

**Screenings.** A well-run premiere generates the material — photographs, quotes, social content — for the following weeks.

## Word of mouth

The only marketing that reliably works and the only one you cannot buy. It comes from a film that delivers what it promised. Which returns to craft: the most effective marketing decision available to you is to make the film good and describe it honestly.

## Measuring

Track what actually converts — which post, which article, which screening drove ticket sales or views. Most marketing effort is wasted; without measurement you cannot tell which half.`,
          videoUrl: '',
          minutes: 20,
        },
      ],
      quiz: {
        title: 'Quiz — Marketing and Release',
        description: 'Audience definition, materials and release timing.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'Why is a stills photographer a high-return budget line?',
            type: 'single_choice',
            options: ['Stills are needed for continuity', 'Press cannot run articles without usable images, and frame grabs are not usable', 'It satisfies festival requirements', 'It documents the crew'],
            correct: ['Press cannot run articles without usable images, and frame grabs are not usable'],
            points: 2,
            explanation: 'Frame grabs are low resolution and badly timed. Press coverage is gated on images, and they can only be captured during production.',
          },
          {
            text: 'The commonest failure of a trailer is…',
            type: 'single_choice',
            options: ['Being too long', 'Promising a different film than the one delivered', 'Using temp music', 'Showing too little'],
            correct: ['Promising a different film than the one delivered'],
            points: 2,
            explanation: 'It converts an audience that then dislikes what it gets — which poisons word of mouth, the one form of marketing you cannot buy.',
          },
          {
            text: 'When does audience-building start?',
            type: 'single_choice',
            options: ['On delivery', 'At the festival premiere', 'In pre-production', 'When the trailer is ready'],
            correct: ['In pre-production'],
            points: 2,
            explanation: 'Behind-the-scenes material and stills are cheap during production and impossible to obtain afterwards.',
          },
          {
            text: 'Social media followers and an owned email list are equivalent assets.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Followers are rented from a platform that controls reach and can change the rules. A list is owned and reaches people directly.',
          },
          {
            text: 'Which should be checked when timing a Nigerian release? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Major competing titles', 'School terms', 'Public and religious holidays', 'The festival circuit calendar'],
            correct: ['Major competing titles', 'School terms', 'Public and religious holidays'],
            points: 3,
            explanation: 'All three strongly shape cinema attendance. The festival calendar matters to a festival strategy, but not to release-weekend attendance.',
          },
        ],
      },
      assignment: {
        title: 'Marketing Package',
        brief: 'For your film: define the audience in one specific paragraph (not "everyone"), write the one-line proposition, and produce a synopsis in all three lengths. Then assemble a press kit outline and describe your key art concept and why it works at thumbnail size. State how you will measure what converts.',
        rubric: 'Audience is specific and reachable (10) · Proposition says what this film offers that others do not (10) · Three synopsis lengths all present and consistent (10) · Measurement plan is concrete (10)',
        maxScore: 40,
        dueInDays: 21,
      },
    },
  ],
  assessment: {
    title: 'Tier 4 Assessment — Producing and Business',
    description: 'Covers scheduling, budgeting, rights, finance, distribution and marketing. Pass to unlock the Capstone tier.',
    passMark: 75,
    timeLimitMinutes: 45,
    maxAttempts: 3,
    questions: [
      {
        text: 'A distributor asks for chain of title and you cannot produce a signed writer\'s agreement. What is the consequence?',
        type: 'single_choice',
        options: ['A delay while it is drafted', 'The deal cannot proceed — you cannot prove you own the screenplay', 'A reduction in the licence fee', 'Nothing, if the writer is credited'],
        correct: ['The deal cannot proceed — you cannot prove you own the screenplay'],
        points: 3,
        explanation: 'Without the assignment, the production does not hold the underlying right. No amount of quality or goodwill substitutes for the document.',
      },
      {
        text: 'Your schedule assumes 7 pages a day for a dialogue drama with a small crew. This is…',
        type: 'single_choice',
        options: ['Ambitious but achievable', 'Roughly double a realistic rate, so scenes will be lost', 'Standard for independent film', 'Fine if the cast is rehearsed'],
        correct: ['Roughly double a realistic rate, so scenes will be lost'],
        points: 3,
        explanation: '2-4 pages is realistic once setups, cast and moves are accounted for. Schedules built on 6-8 do not go faster; they lose scenes at the end of each day.',
      },
      {
        text: 'Which reduce the risk that a financed film returns nothing to its makers? (Choose all that apply.)',
        type: 'multiple_choice',
        options: ['Capping recoupable sales expenses', 'Securing rights reversion if the film does not sell', 'Combining more than one route to market', 'Taking points on net profit instead of a fee'],
        correct: ['Capping recoupable sales expenses', 'Securing rights reversion if the film does not sell', 'Combining more than one route to market'],
        points: 4,
        explanation: 'Points on net profit are frequently worth nothing — the waterfall pays filmmakers last. The other three are structural protections that actually bite.',
      },
      {
        text: 'A budget\'s purpose is to be approved.',
        type: 'true_false',
        options: ['True', 'False'],
        correct: ['False'],
        points: 3,
        explanation: 'Its purpose is to be true. An under-budgeted film does not become cheap — it becomes unfinished, which is the most expensive outcome available.',
      },
      {
        text: 'You are offered a streaming deal before your festival run. The first thing to check is…',
        type: 'single_choice',
        options: ['The licence fee', 'Whether exclusivity and windowing foreclose the festival and cinema routes', 'The platform\'s subscriber numbers', 'The delivery deadline'],
        correct: ['Whether exclusivity and windowing foreclose the festival and cinema routes'],
        points: 3,
        explanation: 'Premiere status and theatrical windows are both easily destroyed by an early exclusivity commitment — and neither can be recovered afterwards.',
      },
    ],
  },
};
