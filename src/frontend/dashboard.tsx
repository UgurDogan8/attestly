import React from 'react';
import ForgeReconciler, { Text } from '@forge/react';

/**
 * List + filters + drill-down + export dialog land in T9–T12
 * (docs/04 §3.2–3.4, docs/07 §4.4). T1 only proves the globalPage resource
 * renders under `render: native` with its `route`.
 */
const Dashboard = () => {
  return <Text>Read confirmations — dashboard (T1 scaffold)</Text>;
};

ForgeReconciler.render(<Dashboard />);
