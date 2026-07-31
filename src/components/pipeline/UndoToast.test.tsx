// @vitest-environment jsdom
/**
 * UndoToast DOM tests (jsdom) — kanban-ui, Wave 1.
 * The 6-second undo affordance: ביטול fires onUndo; auto-close at 6s.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UndoToast, UNDO_TOAST_MS } from './UndoToast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UndoToast', () => {
  it('renders the message and the ביטול button', () => {
    render(<UndoToast message="הכרטיס עבר לשלב הוגשו" onUndo={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('status').textContent).toContain('הכרטיס עבר לשלב הוגשו');
    expect(screen.getByText('ביטול').tagName).toBe('BUTTON');
  });

  it('clicking ביטול fires onUndo', () => {
    const onUndo = vi.fn();
    render(<UndoToast message="m" onUndo={onUndo} onClose={() => {}} />);
    fireEvent.click(screen.getByText('ביטול'));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it(`auto-closes after ${UNDO_TOAST_MS}ms (6 seconds) and not before`, () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<UndoToast message="m" onUndo={() => {}} onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(UNDO_TOAST_MS - 1);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('unmount clears the timer (no late onClose)', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { unmount } = render(<UndoToast message="m" onUndo={() => {}} onClose={onClose} />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(UNDO_TOAST_MS * 2);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
