import React from 'react';
import ForgeReconciler, { Text } from '@forge/react';

/**
 * Chip + dialog states land in T8 (docs/04 §2.2, docs/07 §4.2). T1 only
 * proves the resource renders under `render: native` and that a `resolver`
 * property is accepted here (docs/02 flagged this as unverified for Custom
 * UI; the prior UI-Kit Attestly build used resolver + render:native
 * successfully for this exact module type — see docs/07 §10 residual).
 */
const Byline = () => {
  return <Text>Read confirmation — byline (T1 scaffold)</Text>;
};

ForgeReconciler.render(<Byline />);
