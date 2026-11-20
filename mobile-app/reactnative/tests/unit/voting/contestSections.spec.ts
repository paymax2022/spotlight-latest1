// The landing row's contest sections.
//
// Each tile is a VIEW over the contests an admin has published, so the two
// things that can silently break are (1) a tile whose route no longer resolves
// to a section, and (2) a matcher that quietly includes the wrong contest or
// excludes the right one — both invisible until someone taps the tile on a
// device. Dependency-free utils, so this runs under plain node:test like
// contestFilter's own spec.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_MODULES, HOME_CONTEST_SERVICE_IDS } from '@/constants/modules';
import { registryKeyFor } from '@/features/modules/serviceModuleKeys';
import {
  CONTEST_SECTIONS,
  sectionFor,
  contestInSection,
  filterContestsBySection,
} from '@/features/voting/utils/contestSections';
import type { Contest } from '@/features/voting/types/voting.types';

function titled(title: string, category = ''): Contest {
  return { id: title, title, category, status: 'LIVE', contestantCount: 0, totalVotes: 0 } as Contest;
}

describe('section ↔ tile contract', () => {
  for (const section of CONTEST_SECTIONS) {
    it(`the ${section.id} tile routes to its own section`, () => {
      const tile = SERVICE_MODULES.find((m) => m.route === `/voting/contests?section=${section.id}`);
      assert.ok(tile, `no SERVICE_MODULES tile points at section '${section.id}'`);
      assert.equal(tile.category, 'contest', `${tile.id} must sit in the Contest band as well as the landing row`);
    });

    it(`the ${section.id} tile is registry-gated`, () => {
      const key = registryKeyFor(section.id);
      assert.ok(key, `${section.id} has no registry key, so /admin/modules cannot toggle it`);
    });

    it(`the ${section.id} section says something when nothing is published`, () => {
      // The empty state is the whole story for a section whose contest does not
      // exist yet (Rising Star today). A blank list reads as a bug.
      assert.ok(section.emptyTitle.length > 0);
      assert.ok(section.emptyMessage.length > 0);
    });
  }

  it('every keyword is already in normalized form', () => {
    // Matching normalizes the contest text, not the keyword: a 'open-mic' entry
    // would then never match anything, and the section would look empty forever.
    for (const section of CONTEST_SECTIONS) {
      for (const kw of section.keywords) {
        assert.match(kw, /^[a-z0-9 ]+$/, `'${kw}' in ${section.id} cannot ever match`);
      }
    }
  });
});

describe('matching contests to sections', () => {
  const openMic = sectionFor('open-mic')!;
  const talentHunt = sectionFor('talent-hunt')!;
  const risingStar = sectionFor('rising-star')!;

  it('finds the contests by the names the console publishes them under', () => {
    assert.ok(contestInSection(titled('September Open Mic Challenge'), openMic));
    assert.ok(contestInSection(titled('Spotlight Talent Search Season 2'), talentHunt));
    assert.ok(contestInSection(titled('Nollywood Rising Star'), risingStar));
  });

  it('is indifferent to case, punctuation and run-together words', () => {
    assert.ok(contestInSection(titled('OPEN MIC 2026!'), openMic));
    assert.ok(contestInSection(titled('The Open-Mic Session'), openMic));
  });

  it('reads the category too, where the console records one', () => {
    assert.ok(contestInSection(titled('Season 4', 'Rising Star'), risingStar));
  });

  it('keeps an unrelated contest out of every section', () => {
    const actor = titled('Best Emerging Actor 2025');
    for (const section of CONTEST_SECTIONS) {
      assert.equal(contestInSection(actor, section), false, `${actor.title} leaked into ${section.id}`);
    }
  });

  it('leaves the general list untouched without a section', () => {
    const all = [titled('September Open Mic Challenge'), titled('Comedy Skit Creator Award')];
    assert.equal(sectionFor(undefined), null);
    assert.equal(sectionFor('not-a-section'), null);
    assert.equal(filterContestsBySection(all, null), all);
    assert.equal(filterContestsBySection(all, openMic).length, 1);
  });
});

describe('the landing contest shelf', () => {
  it('holds the four briefed services, in order', () => {
    assert.deepEqual(
      [...HOME_CONTEST_SERVICE_IDS],
      ['open-mic', 'film-academy', 'talent-hunt', 'rising-star'],
    );
  });

  it('names only real tiles, and gates every one of them', () => {
    for (const id of HOME_CONTEST_SERVICE_IDS) {
      const tile = SERVICE_MODULES.find((m) => m.id === id);
      assert.ok(tile, `${id} is in the shelf but has no SERVICE_MODULES tile`);
      assert.ok(tile.icon, `${id} has no icon`);
      assert.ok(registryKeyFor(id), `${id} cannot be toggled from /admin/modules`);
    }
  });

  it('sends Film Academy to the hub that lists every training area', () => {
    // The brief asks for "the list of all the film academy categories". The
    // existing /film-academy hub renders the interest areas of each batch
    // (app/film-academy/index.tsx), so the tile points there rather than
    // inventing a second list the app would have to keep in step.
    assert.equal(SERVICE_MODULES.find((m) => m.id === 'film-academy')?.route, '/film-academy');
  });
});
