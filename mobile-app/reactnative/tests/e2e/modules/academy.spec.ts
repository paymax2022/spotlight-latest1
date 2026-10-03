import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Spotlight Academy hub (/learn/academy). EXPO_PUBLIC_ACADEMY_USE_MOCK defaults
 * true; MOCK_PROFILE seeds a learner who has NOT finished onboarding, so the
 * hub renders the StudyHub welcome hero with the Get started CTA rather than
 * the streak/XP dashboard. /learn/* has no routeModuleKeys entry.
 */
test.describe('Academy E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the StudyHub welcome hero for the seeded learner', async ({ page }) => {
    await page.goto('/learn/academy');

    await expect(page.getByText('StudyHub')).toBeVisible();
    await expect(
      page.getByText('Learn. Play. Earn. Pass your exams with edutainment lessons, CBT mocks and learn-to-earn rewards.'),
    ).toBeVisible();
    await expect(page.getByText('Get started')).toBeVisible();
  });

  test('get started opens role selection', async ({ page }) => {
    await page.goto('/learn/academy');

    await page.getByText('Get started').click();
    await expect(page).toHaveURL(/\/learn\/academy\/onboarding\/role/);
    // The hub stays mounted-but-hidden — assert the onboarding header.
    await expect(page.getByText('Welcome to Spotlight Academy')).toBeVisible();
  });
});
