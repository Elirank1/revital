// @vitest-environment jsdom
/**
 * DataPanel DOM tests (jsdom) — kanban-ui, Wave 3.
 *
 * Covered: retention setting through the store (persisted key, audited),
 * purge disabled while retention is off, purge result counts, and the
 * per-person deletion cascade UI gates: export-BEFORE-delete (typed
 * confirmation stays disabled until the backup downloaded), exact-name
 * confirmation, the CascadeResult summary, and one-click undo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { DataPanel } from './DataPanel';
import {
  resetPipelineStore,
  seedPersonWithDeal,
} from '../../views/Pipeline/storeTestKit';

const store = () => usePipelineStore.getState();

beforeEach(() => resetPipelineStore());
afterEach(cleanup);

describe('retention', () => {
  it('sets the window through the store (persisted + audited); purge disabled while off', () => {
    render(<DataPanel onClose={() => {}} />);
    expect(store().retentionMonths).toBeNull();
    expect(
      (screen.getByTestId('purge-button') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByTestId('retention-select'), {
      target: { value: '6' },
    });
    expect(store().retentionMonths).toBe(6);
    expect(JSON.parse(localStorage.getItem('revital_v3_retention')!)).toBe(6);
    expect(
      store().auditLog.some((e) => e.action === 'settings.retention'),
    ).toBe(true);
    expect(
      (screen.getByTestId('purge-button') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('purge physically removes only expired tombstones and reports counts', () => {
    const { person } = seedPersonWithDeal({
      name: 'נועה כהן',
      jobTitle: 'Backend',
    });
    const keep = store().addPerson({ name: 'דנה לוי' }).person;
    store().deletePersonCascade(person.id, { confirm: true });
    // age the tombstones far past any window
    usePipelineStore.setState((s) => ({
      persons: s.persons.map((p) =>
        p.id === person.id ? { ...p, deletedAt: '2020-01-01T00:00:00.000Z' } : p,
      ),
      deals: s.deals.map((d) =>
        d.personId === person.id
          ? { ...d, deletedAt: '2020-01-01T00:00:00.000Z' }
          : d,
      ),
      stageEvents: s.stageEvents.map((e) =>
        e.deleted ? { ...e, deletedAt: '2020-01-01T00:00:00.000Z' } : e,
      ),
    }));

    render(<DataPanel onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('retention-select'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByTestId('purge-button'));

    const result = screen.getByTestId('purge-result');
    expect(result.textContent).toContain('1 מועמדים');
    expect(result.textContent).toContain('1 כרטיסים');
    // physically gone; the live person survives
    expect(store().persons.find((p) => p.id === person.id)).toBeUndefined();
    expect(store().persons.find((p) => p.id === keep.id)).toBeTruthy();
  });
});

describe('deletion cascade UI flow', () => {
  it('enforces export-before-delete + exact typed name, then cascades and undoes', () => {
    const { person, deal } = seedPersonWithDeal({
      name: 'נועה כהן',
      jobTitle: 'Backend Engineer',
    });
    seedPersonWithDeal({ name: 'דנה לוי', jobTitle: 'QA' });
    const download = vi.fn();

    render(<DataPanel onClose={() => {}} download={download} />);
    fireEvent.change(screen.getByTestId('cascade-person-select'), {
      target: { value: person.id },
    });

    // gate (a): confirm input + delete disabled until the backup downloads
    const input = screen.getByTestId('cascade-confirm-input') as HTMLInputElement;
    const del = screen.getByTestId('cascade-delete-button') as HTMLButtonElement;
    expect(input.disabled).toBe(true);
    expect(del.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('cascade-export-button'));
    expect(download).toHaveBeenCalledOnce();
    const [json, filename] = download.mock.calls[0];
    expect(filename).toMatch(/^revital-export-/);
    expect(JSON.parse(json).app).toBe('revital');
    expect(input.disabled).toBe(false);

    // gate (b): exact name required
    fireEvent.change(input, { target: { value: 'נועה' } });
    expect(del.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'נועה כהן' } });
    expect(del.disabled).toBe(false);

    // nothing was deleted before the click
    expect(store().persons.find((p) => p.id === person.id)!.deleted).toBeUndefined();

    fireEvent.click(del);
    const result = screen.getByTestId('cascade-result');
    expect(result.textContent).toContain('1 כרטיסים');
    const s = store();
    expect(s.persons.find((p) => p.id === person.id)!.deleted).toBe(true);
    expect(s.deals.find((d) => d.id === deal.id)!.deleted).toBe(true);
    // the other person is untouched
    expect(s.persons.filter((p) => !p.deleted)).toHaveLength(1);

    // one-click undo restores everything live
    fireEvent.click(screen.getByTestId('cascade-undo-button'));
    expect(screen.getByTestId('cascade-undone')).toBeTruthy();
    const after = store();
    expect(after.persons.find((p) => p.id === person.id)!.deleted).toBeUndefined();
    expect(after.deals.find((d) => d.id === deal.id)!.deleted).toBeUndefined();
  });

  it('switching person resets the export + confirmation gates', () => {
    const a = seedPersonWithDeal({ name: 'נועה כהן', jobTitle: 'X' });
    const b = seedPersonWithDeal({ name: 'דנה לוי', jobTitle: 'Y' });
    const download = vi.fn();
    render(<DataPanel onClose={() => {}} download={download} />);

    fireEvent.change(screen.getByTestId('cascade-person-select'), {
      target: { value: a.person.id },
    });
    fireEvent.click(screen.getByTestId('cascade-export-button'));
    fireEvent.change(screen.getByTestId('cascade-confirm-input'), {
      target: { value: 'נועה כהן' },
    });
    expect(
      (screen.getByTestId('cascade-delete-button') as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.change(screen.getByTestId('cascade-person-select'), {
      target: { value: b.person.id },
    });
    expect(
      (screen.getByTestId('cascade-confirm-input') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('cascade-delete-button') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
