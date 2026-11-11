import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Dialog } from '../ui/dialog';
import { FilterChips } from '../ui/filter-chips';
import { TabPanel, Tabs } from '../ui/tabs';

const OPTIONS = [
  { value: 'all', label: 'All', count: 3 },
  { value: 'in', label: 'Checked in', count: 2 },
  { value: 'out', label: 'Checked out', count: null },
] as const;

function Chips() {
  const [v, setV] = useState<(typeof OPTIONS)[number]['value']>('all');
  return <FilterChips label="Show" value={v} onChange={setV} options={OPTIONS} />;
}

const TABS = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
] as const;

function Sections({ variant }: { variant?: 'segmented' | 'side' }) {
  const [v, setV] = useState<(typeof TABS)[number]['value']>('one');
  return (
    <Tabs value={v} onValueChange={setV} items={TABS} label="Sections" variant={variant}>
      <TabPanel value="one">First panel</TabPanel>
      <TabPanel value="two">Second panel</TabPanel>
    </Tabs>
  );
}

describe('FilterChips', () => {
  it('works like radio buttons: one tab stop, arrow keys move and select, counts are shown', async () => {
    render(<Chips />);
    const group = screen.getByRole('radiogroup', { name: 'Show' });
    expect(group).toBeInTheDocument();
    const all = screen.getByRole('radio', { name: /All/ });
    expect(all).toHaveAttribute('aria-checked', 'true');
    expect(all).toHaveTextContent('3');
    expect(screen.getByRole('radio', { name: /Checked out/ })).toHaveTextContent('–');
    await userEvent.tab();
    expect(all).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /Checked in/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Checked in/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: /Checked out/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(all);
    expect(all).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Tabs', () => {
  it('shows one panel at a time and moves with the arrow keys', async () => {
    render(<Sections />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('First panel');
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Second panel');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
  });

  it('the side list also answers to left and right, for when it lies flat on a phone', async () => {
    render(<Sections variant="side" />);
    await userEvent.click(screen.getByRole('tab', { name: 'One' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Dialog guard', () => {
  function Host({ guard }: { guard: boolean }) {
    const [open, setOpen] = useState(true);
    return (
      <Dialog open={open} onOpenChange={setOpen} title="Edit details" guard={guard}>
        <input aria-label="Name" />
      </Dialog>
    );
  }

  it('closes on Escape when nothing would be lost', async () => {
    render(<Host guard={false} />);
    await userEvent.keyboard('{Escape}');
    // The dialog leaves with a short exit animation.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('stays open on Escape while guarded, and still closes from its own close button', async () => {
    render(<Host guard />);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Edit details' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    // The dialog leaves with a short exit animation.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
