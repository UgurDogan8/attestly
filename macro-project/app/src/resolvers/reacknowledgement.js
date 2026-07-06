import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { getAllAcknowledgementRecords, getPage } from './index';

const notifiedVersionKey = (contentId) => `reack-notified:${contentId}`;

// Confirmed via forge logs against a real avi:confluence:updated:page event: the page ID is
// at event.content.id. The other fallbacks are kept in case Atlassian changes the payload shape.
function extractContentId(event) {
  return (
    event?.content?.id ??
    event?.page?.id ??
    event?.contentId ??
    event?.data?.content?.id ??
    null
  );
}

// Builds an ADF document that @mentions every reader whose acknowledgement just went stale,
// which makes Confluence send its own native email notification to each of them.
function buildReacknowledgementCommentBody(accountIds, version) {
  const mentionNodes = accountIds.flatMap((accountId) => [
    { type: 'mention', attrs: { id: accountId, text: '@user' } },
    { type: 'text', text: ' ' },
  ]);

  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `This page was updated (version ${version}). Your previous acknowledgement is no longer valid — please read and acknowledge it again. `,
          },
          ...mentionNodes,
        ],
      },
    ],
  };
}

async function postReacknowledgementComment(contentId, accountIds, version) {
  const body = buildReacknowledgementCommentBody(accountIds, version);

  const response = await api.asApp().requestConfluence(route`/wiki/api/v2/footer-comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pageId: contentId,
      body: {
        representation: 'atlas_doc_format',
        value: JSON.stringify(body),
      },
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Could not post re-acknowledgement notification (page ${contentId}, HTTP ${response.status}): ${responseBody}`
    );
  }
}

// Fires when a Confluence page is updated. Finds everyone whose acknowledgement was recorded
// against an older version of the page (i.e. it just became stale) and @mentions them in a
// comment asking for re-acknowledgement. Guards against duplicate comments for the same
// version via a stored "last notified version" per page (Confluence can fire more than one
// update event for what is effectively the same version, e.g. autosave).
export async function handlePageUpdated(event) {
  const contentId = extractContentId(event);
  if (!contentId) {
    return;
  }

  const page = await getPage(contentId);
  const currentVersion = page.version.number;

  const alreadyNotifiedVersion = await kvs.get(notifiedVersionKey(contentId));
  if (alreadyNotifiedVersion === currentVersion) {
    return;
  }

  const ackRecords = await getAllAcknowledgementRecords();
  const staleAccountIds = ackRecords
    .filter((record) => record.contentId === contentId && record.pageVersion < currentVersion)
    .map((record) => record.accountId);

  if (staleAccountIds.length > 0) {
    await postReacknowledgementComment(contentId, staleAccountIds, currentVersion);
  }

  await kvs.set(notifiedVersionKey(contentId), currentVersion);
}
