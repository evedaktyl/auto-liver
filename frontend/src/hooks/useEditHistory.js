import { useRef, useCallback } from "react";

/**
 * Hook to manage undo/redo history for mask slice edits.
 * Each slice has its own history stack with a maximum of 20 states.
 *
 * @returns {{ saveState, undo, redo, canUndo, canRedo, clearHistory }}
 */
export function useEditHistory() {
  // History structure: { "sliceKey": { states: [blob1, blob2, ...], index: 2 } }
  const history = useRef(new Map());
  const MAX_HISTORY = 20;

  /**
   * Save current state to history before making changes.
   * @param {string} sliceKey - Unique key for the slice (e.g., "itemId:axial:42")
   * @param {Blob} blob - Current mask blob
   */
  const saveState = useCallback((sliceKey, blob) => {
    if (!blob) return;

    const entry = history.current.get(sliceKey);

    if (!entry) {
      // First save for this slice
      history.current.set(sliceKey, {
        states: [blob],
        index: 0,
      });
      return;
    }

    // Remove any "future" states if we're not at the end (after undo)
    const newStates = entry.states.slice(0, entry.index + 1);

    // Add new state
    newStates.push(blob);

    // Limit history size (keep most recent)
    if (newStates.length > MAX_HISTORY) {
      newStates.shift();
    }

    history.current.set(sliceKey, {
      states: newStates,
      index: newStates.length - 1,
    });
  }, []);

  /**
   * Undo to previous state.
   * @param {string} sliceKey - Unique key for the slice
   * @returns {Blob|null} - Previous blob, or null if can't undo
   */
  const undo = useCallback((sliceKey) => {
    const entry = history.current.get(sliceKey);
    if (!entry || entry.index <= 0) return null;

    entry.index--;
    return entry.states[entry.index];
  }, []);

  /**
   * Redo to next state.
   * @param {string} sliceKey - Unique key for the slice
   * @returns {Blob|null} - Next blob, or null if can't redo
   */
  const redo = useCallback((sliceKey) => {
    const entry = history.current.get(sliceKey);
    if (!entry || entry.index >= entry.states.length - 1) return null;

    entry.index++;
    return entry.states[entry.index];
  }, []);

  /**
   * Check if undo is available for a slice.
   * @param {string} sliceKey
   * @returns {boolean}
   */
  const canUndo = useCallback((sliceKey) => {
    const entry = history.current.get(sliceKey);
    return entry ? entry.index > 0 : false;
  }, []);

  /**
   * Check if redo is available for a slice.
   * @param {string} sliceKey
   * @returns {boolean}
   */
  const canRedo = useCallback((sliceKey) => {
    const entry = history.current.get(sliceKey);
    return entry ? entry.index < entry.states.length - 1 : false;
  }, []);

  /**
   * Clear history for a specific slice or all slices.
   * @param {string} [sliceKey] - If provided, clear only this slice. Otherwise clear all.
   */
  const clearHistory = useCallback((sliceKey) => {
    if (sliceKey) {
      history.current.delete(sliceKey);
    } else {
      history.current.clear();
    }
  }, []);

  return {
    saveState,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
  };
}