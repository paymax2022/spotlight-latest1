import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Bus transport PRD v2 smoke suite. EXPO_PUBLIC_BUS_V2 is pinned 'true' in
 * playwright.config.ts, so geography, departures, holds, bookings and tickets
 * come from busv2.mock.ts fixtures — only the ambient/auth/wallet stubs are
 * needed.
 */
test.describe('Bus v2 E2E — customer flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockModuleVisibility(page, ['transport']);
    await mockWallet(page);
    await loginAs(page);
  });

  test('search form renders geo-fed pickers, trip type and pax stepper', async ({ page }) => {
    await page.goto('/mobility/bus');

    await expect(page.getByText('Bus travel', { exact: true })).toBeVisible();
    await expect(page.getByText('One-way', { exact: true })).toBeVisible();
    await expect(page.getByText('Return', { exact: true })).toBeVisible();
    await expect(page.getByText('Passengers', { exact: true })).toBeVisible();

    // States come from the geo fixture (mock bus_geo_state rows), not a
    // hard-coded list — 'Lagos' only exists because the fixture serves it.
    await page.getByText('Departure state', { exact: true }).click();
    await page.getByText('Lagos', { exact: true }).last().click();
    await page.getByText('Destination state', { exact: true }).click();
    await page.getByText('Abuja (FCT)', { exact: true }).last().click();

    await expect(page.getByText('Departure date', { exact: true })).toBeVisible();
    await expect(page.getByText('Search buses', { exact: true })).toBeVisible();
  });

  test('results groups outbound + return legs with boarding vs departure times', async ({ page }) => {
    await page.goto(
      '/mobility/bus/results?fromStateId=st_lagos&toStateId=st_fct&fromState=Lagos&toState=Abuja%20(FCT)&date=2099-01-15&pax=1&tripType=return&returnDate=2099-01-20',
    );

    await expect(page.getByText(/^Outbound · /)).toBeVisible();
    await expect(page.getByText(/^Return · /)).toBeVisible();
    // Departure cards carry BOTH instants, labelled distinctly.
    await expect(page.getByText(/^Boards /).first()).toBeVisible();
    await expect(page.getByText(/^Departs /).first()).toBeVisible();
    // Continue stays disabled until both legs are held.
    await expect(page.getByText('Pick your outbound departure')).toBeVisible();
  });

  test('tickets tab lists the seeded booking with its status', async ({ page }) => {
    await page.goto('/mobility/bus?tab=tickets');

    await expect(page.getByText(/Lagos Central Terminal → Abuja \(FCT\) Gateway Terminal/).first()).toBeVisible();
    await expect(page.getByText('Ticket issued').first()).toBeVisible();
  });

  test('ticket detail shows the QR boarding pass and cancellation policy', async ({ page }) => {
    await page.goto('/mobility/bus/ticket/PMX-SEED01');

    await expect(page.getByText('Boarding pass', { exact: true })).toBeVisible();
    await expect(page.getByText('Ref PMX-SEED01')).toBeVisible();
    await expect(page.getByText('Show this QR to the operator to board.')).toBeVisible();
    await expect(page.getByText('Request cancellation').first()).toBeVisible();
  });
});
