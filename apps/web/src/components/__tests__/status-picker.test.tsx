import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRESENCE_PRESETS } from '@fg/shared';
import { StatusPicker } from '../status-picker';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderPicker() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <StatusPicker current={{ presence: 'available', statusEmoji: null, statusText: null }} userId="u1" />
    </QueryClientProvider>,
  );
}

describe('StatusPicker', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ presence: 'lunch', statusExpiresAt: null }), { status: 200 })) as unknown as typeof fetch;
  });

  it('lists every preset status', () => {
    renderPicker();
    const options = within(screen.getByRole('listbox', { name: 'Quick status' })).getAllByRole('option');
    expect(options).toHaveLength(PRESENCE_PRESETS.length);
    PRESENCE_PRESETS.forEach((p, i) => expect(options[i]).toHaveTextContent(p.label));
  });

  it('quick-select calls PUT /api/me/status with the preset', async () => {
    renderPicker();
    await userEvent.click(screen.getByRole('option', { name: /Lunch break/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/me/status');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toMatchObject({ presence: 'lunch', emoji: null, text: null });
  });

  it('saves a custom message with expiry', async () => {
    renderPicker();
    await userEvent.type(screen.getByLabelText('Status message'), 'Client demo');
    await userEvent.selectOptions(screen.getByLabelText('Clear after'), '1h');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body).toMatchObject({ text: 'Client demo', expiry: '1h' });
  });
});
