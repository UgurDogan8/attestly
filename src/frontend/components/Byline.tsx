import React from 'react';
import { useReaderState } from './useReaderState';
import { ConfirmBlock } from './ConfirmBlock';
import { ReaderPhaseView } from './ReaderPhaseView';

/**
 * The byline dialog (docs/06 T8, UX doc §2.2): "Dialog shows the user's
 * status detail and, when outstanding, the same confirm action as the
 * macro." Reuses useReaderState + ConfirmBlock verbatim — the only
 * difference from Macro.tsx is that there is no Configure button/modal
 * here (UX doc §2.2 never mentions one for the dialog; configuring stays a
 * macro/dashboard action).
 *
 * A confirm from this dialog writes through the exact same `confirm`
 * resolver as the macro (T8 accept criteria) — true by construction, since
 * both surfaces share useReaderState's handleConfirm, not by any dialog-
 * specific code here.
 *
 * The byline *chip* (title/tooltip shown in the byline list before the
 * dialog opens) is a completely separate mechanism —
 * src/resolvers/bylineProps.ts, a manifest `dynamicProperties` function,
 * not this UI Kit resource. See that file's docstring for the chip's own
 * states and platform-behavior notes (including "chip refreshes after
 * dialog close").
 */
export function Byline(): React.JSX.Element | null {
  const { phase, confirmError, confirming, reloading, handleConfirm, handleReload } = useReaderState();

  return (
    <ReaderPhaseView
      phase={phase}
      reloading={reloading}
      handleReload={handleReload}
      renderReady={(readyPhase) => (
        <ConfirmBlock status={readyPhase.status} onConfirm={handleConfirm} confirming={confirming} confirmError={confirmError} />
      )}
    />
  );
}
