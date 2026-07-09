import React from 'react';
import ForgeReconciler, { Text } from '@forge/react';

/**
 * Reader states R1–R7 land in T6 (docs/04 §2.1, docs/07 §4.1). T1 only proves
 * the resource renders under `render: native`.
 */
const Macro = () => {
  return <Text>Read confirmation — macro (T1 scaffold)</Text>;
};

ForgeReconciler.render(<Macro />);
