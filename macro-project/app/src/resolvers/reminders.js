import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import {
  accessResultsFromAssignment,
  assignmentKey,
  getAllAcknowledgementRecords,
  getAllAssignmentRecords,
  getPage,
} from './index';

// Reminders start going out this many days before the due date, and repeat daily (at most
// once per day per page, via lastReminderDate) for as long as readers remain pending.
const REMINDER_LEAD_DAYS = 3;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

// Builds an ADF document that @mentions every pending reader, which makes Confluence send
// its own native email notification to each of them — no external email service needed.
function buildReminderCommentBody(pendingAccountIds, dueDate) {
  const mentionNodes = pendingAccountIds.flatMap((accountId) => [
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
            text: `Reminder: you need to read and acknowledge this page by ${dueDate}. `,
          },
          ...mentionNodes,
        ],
      },
    ],
  };
}

async function postReminderComment(contentId, pendingAccountIds, dueDate) {
  const body = buildReminderCommentBody(pendingAccountIds, dueDate);

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
      `Could not post reminder comment (page ${contentId}, HTTP ${response.status}): ${responseBody}`
    );
  }
}

// Scans every reader assignment and posts an @mention reminder comment on pages whose due
// date is approaching or has passed, as long as someone assigned still hasn't acknowledged
// the current version. Safe to call multiple times per day: lastReminderDate guards against
// posting more than one reminder comment per page per day.
export async function sendReminders() {
  const [ackRecords, assignments] = await Promise.all([
    getAllAcknowledgementRecords(),
    getAllAssignmentRecords(),
  ]);

  const ackRecordsByPage = new Map();
  for (const record of ackRecords) {
    if (!ackRecordsByPage.has(record.contentId)) {
      ackRecordsByPage.set(record.contentId, []);
    }
    ackRecordsByPage.get(record.contentId).push(record);
  }

  const today = new Date();
  const todayString = todayDateString();
  let remindersSent = 0;
  let skippedInaccessibleReaders = 0;
  let skippedUnavailablePages = 0;

  for (const assignment of assignments) {
    if (!assignment.dueDate || assignment.lastReminderDate === todayString) {
      continue;
    }

    const reminderWindowStart = new Date(
      new Date(`${assignment.dueDate}T00:00:00Z`).getTime() - REMINDER_LEAD_DAYS * DAY_IN_MS
    );
    if (today < reminderWindowStart) {
      continue;
    }

    let page;
    try {
      page = await getPage(assignment.contentId);
    } catch (error) {
      skippedUnavailablePages += 1;
      continue;
    }

    const pageAckRecords = ackRecordsByPage.get(assignment.contentId) || [];
    const acknowledgedAccountIds = new Set(
      pageAckRecords
        .filter((record) => record.pageVersion === page.version.number)
        .map((record) => record.accountId)
    );

    const pendingAccountIds = assignment.accountIds.filter((id) => !acknowledgedAccountIds.has(id));
    const inaccessibleAccountIds = new Set(
      accessResultsFromAssignment(assignment)
        .filter((result) => result.hasReadAccess === false)
        .map((result) => result.accountId)
    );
    const remindableAccountIds = pendingAccountIds.filter((id) => !inaccessibleAccountIds.has(id));

    skippedInaccessibleReaders += pendingAccountIds.length - remindableAccountIds.length;
    if (remindableAccountIds.length === 0) {
      continue;
    }

    await postReminderComment(assignment.contentId, remindableAccountIds, assignment.dueDate);

    await kvs.set(assignmentKey(assignment.contentId), {
      ...assignment,
      lastReminderDate: todayString,
    });
    remindersSent += 1;
  }

  return { remindersSent, skippedInaccessibleReaders, skippedUnavailablePages };
}
