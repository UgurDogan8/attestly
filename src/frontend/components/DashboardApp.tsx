import React, { useState } from 'react';
import { Dashboard } from './Dashboard';
import { PageDetail } from './PageDetail';

/**
 * Composes the T9 dashboard list with the T10 drill-down (docs/04 §3.2:
 * "Row click -> drill-down"). A client-side view switch, not a Confluence
 * route change -- there is only one globalPage resource; Dashboard and
 * PageDetail each stay focused on their own list/detail concern and know
 * nothing about how they're composed.
 */
export function DashboardApp(): React.JSX.Element {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  if (selectedPageId) {
    return <PageDetail pageId={selectedPageId} onBack={() => setSelectedPageId(null)} />;
  }

  return <Dashboard onOpenPage={setSelectedPageId} />;
}
