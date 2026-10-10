/**
 * App smoke test on the demo backend (no PennySms native module under Jest).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';
import { PRIVACY_POLICY_URL } from '../src/app/links';
import App from '../App';
import { resetDataStore } from '../src/app/data/store';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

afterEach(() => resetDataStore());

it('opens the daily close and drills into a transaction', async () => {
  await render(<App />);

  expect(await screen.findByTestId('today-screen')).toBeTruthy();
  expect(screen.getByTestId('close-hero')).toBeTruthy();
  expect(screen.getByText('Daily close')).toBeTruthy();
  // The unknown merchant asks for a quick check, and Activity shows the review dot.
  expect(screen.getByTestId('quick-check')).toBeTruthy();
  expect(screen.getByTestId('review-dot')).toBeTruthy();

  fireEvent.press(screen.getByTestId('tab-Activity'));
  expect(await screen.findByTestId('activity-screen')).toBeTruthy();
  fireEvent.press(screen.getByText('Swiggy'));

  expect(await screen.findByTestId('detail-screen')).toBeTruthy();
  expect(screen.getByText('2 alerts → 1 transaction')).toBeTruthy();
});

it('resolving the quick check clears the review queue', async () => {
  await render(<App />);
  fireEvent.press(await screen.findByTestId('quick-check-yes'));
  await waitFor(() => expect(screen.queryByTestId('quick-check')).toBeNull());
  expect(screen.queryByTestId('review-dot')).toBeNull();
});

it('can stop counting an account and bring it back', async () => {
  await render(<App />);
  fireEvent.press(await screen.findByTestId('tab-Accounts'));
  fireEvent.press(await screen.findByTestId('ignore-sbi-8821'));

  const restore = await screen.findByTestId('toggle-sbi-8821');
  expect(screen.getByText('You chose not to count it')).toBeTruthy();
  expect(screen.queryByTestId('ignore-sbi-8821')).toBeNull();

  fireEvent.press(restore);
  expect(await screen.findByTestId('ignore-sbi-8821')).toBeTruthy();
  expect(screen.queryByTestId('not-counted')).toBeNull();
});

it('steps back to earlier weeks on Today and returns', async () => {
  await render(<App />);
  expect(await screen.findByTestId('week-strip')).toBeTruthy();
  expect(screen.queryByTestId('week-today')).toBeNull();
  fireEvent.press(screen.getByTestId('week-prev'));
  expect(await screen.findByTestId('week-today')).toBeTruthy();
  fireEvent.press(screen.getByTestId('week-today'));
  await waitFor(() => expect(screen.queryByTestId('week-today')).toBeNull());
});

it('opens an account’s transactions from Today', async () => {
  await render(<App />);
  fireEvent.press(await screen.findByTestId('account-row-sbi-8821'));
  expect(await screen.findByTestId('account-detail')).toBeTruthy();
  expect(screen.getByText(/Last month · \d+ of \d+/)).toBeTruthy();
});

it('change category lists every category and can add a new one', async () => {
  await render(<App />);
  fireEvent.press(await screen.findByTestId('tab-Activity'));
  fireEvent.press(await screen.findByText('Swiggy'));
  fireEvent.press(await screen.findByTestId('change-category'));

  expect(await screen.findByTestId('option-food')).toBeTruthy();
  expect(screen.getByTestId('option-family')).toBeTruthy();
  expect(screen.getByTestId('option-investments')).toBeTruthy();

  fireEvent.press(screen.getByTestId('new-category'));
  await fireEvent.changeText(await screen.findByTestId('new-category-name'), 'Late night snacks');
  await fireEvent.press(screen.getByTestId('add-category'));
  expect(await screen.findByTestId('option-custom-late-night-snacks')).toBeTruthy();
  expect(screen.getByTestId('option-custom-late-night-snacks').props.accessibilityState).toMatchObject({
    selected: true,
  });
});

it("sets a day's closing balance from Today", async () => {
  await render(<App />);
  await fireEvent.press(await screen.findByTestId('set-closing-link'));
  expect(await screen.findByTestId('closing-sheet')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('closing-account-sbi-8821'));
  await fireEvent.changeText(screen.getByTestId('closing-input'), '30000');
  await fireEvent.press(screen.getByTestId('save-closing'));
  expect(await screen.findByText(/SBI Savings closed ₹30,000 on/)).toBeTruthy();
});

it('shows credit cards on their own, outside the closing balance', async () => {
  await render(<App />);
  expect(await screen.findByTestId('cards-card')).toBeTruthy();
  expect(screen.getByText('Not in your closing balance')).toBeTruthy();
  expect(screen.getByTestId('card-icici-4471')).toBeTruthy();
  // The card is not listed among the cash accounts.
  expect(screen.queryByTestId('account-row-icici-4471')).toBeNull();
});

it('dates the bank balance next to the calculated one on Accounts', async () => {
  await render(<App />);
  await fireEvent.press(await screen.findByTestId('tab-Accounts'));
  expect((await screen.findAllByText('Balance now')).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Bank said · /).length).toBeGreaterThan(0);
});

it('links to the privacy policy from the Privacy tab (Play requires it in the app)', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await render(<App />);
  await fireEvent.press(await screen.findByTestId('tab-Privacy'));
  await fireEvent.press(await screen.findByTestId('privacy-policy-link'));
  expect(open).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  open.mockRestore();
});
