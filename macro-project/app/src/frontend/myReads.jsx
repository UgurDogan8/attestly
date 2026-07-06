import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  DynamicTable,
  Heading,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const buildHead = () => ({
  cells: [
    { key: 'title', content: 'Page' },
    { key: 'campaign', content: 'Campaign' },
    { key: 'dueDate', content: 'Due date' },
    { key: 'status', content: 'Status' },
  ],
});

const buildRows = (items) =>
  items.map((item) => ({
    key: item.contentId,
    cells: [
      { key: 'title', content: <Text>{item.title}</Text> },
      { key: 'campaign', content: <Text>{item.campaignName || '-'}</Text> },
      { key: 'dueDate', content: <Text>{item.dueDate || '-'}</Text> },
      {
        key: 'status',
        content: item.accessIssue ? (
          <Lozenge appearance="removed">No access</Lozenge>
        ) : item.acknowledged ? (
          <Lozenge appearance="success">Acknowledged</Lozenge>
        ) : (
          <Lozenge appearance="removed">Pending</Lozenge>
        ),
      },
    ],
  }));

const MyReadsApp = () => {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    invoke('getMyReadsOverview')
      .then(setItems)
      .catch(() => setError('Could not load your reading list. Please refresh the page.'));
  }, []);

  if (!items) {
    return error ? (
      <SectionMessage appearance="error">
        <Text>{error}</Text>
      </SectionMessage>
    ) : (
      <Spinner size="medium" />
    );
  }

  if (items.length === 0) {
    return (
      <Stack space="space.200">
        <Heading size="large">My Reads</Heading>
        <Text>You have no pages assigned to you.</Text>
      </Stack>
    );
  }

  const pending = items.filter((item) => !item.acknowledged);
  const completed = items.filter((item) => item.acknowledged);
  const hasAccessIssues = pending.some((item) => item.accessIssue);

  return (
    <Stack space="space.300">
      <Heading size="large">My Reads</Heading>
      <Text>Pages you've been assigned to read and acknowledge, across the whole site.</Text>
      {hasAccessIssues && (
        <SectionMessage appearance="warning">
          <Text>
            Some assigned pages are restricted or unavailable to you. Ask a Confluence admin to
            grant page access before you can acknowledge them.
          </Text>
        </SectionMessage>
      )}

      <Box>
        <Stack space="space.150">
          <Heading size="medium">Pending</Heading>
          {pending.length === 0 ? (
            <Text>Nothing pending — you're all caught up.</Text>
          ) : (
            <DynamicTable head={buildHead()} rows={buildRows(pending)} />
          )}
        </Stack>
      </Box>

      <Box>
        <Stack space="space.150">
          <Heading size="medium">Completed</Heading>
          {completed.length === 0 ? (
            <Text>You haven't acknowledged any assigned pages yet.</Text>
          ) : (
            <DynamicTable head={buildHead()} rows={buildRows(completed)} />
          )}
        </Stack>
      </Box>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <MyReadsApp />
  </React.StrictMode>
);
