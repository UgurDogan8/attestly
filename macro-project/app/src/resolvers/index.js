import Resolver from '@forge/resolver';
import api, { route, webTrigger } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { sendReminders } from './reminders';

const resolver = new Resolver();

const CSV_EXPORT_WEB_TRIGGER_KEY = 'csv-export-trigger';
const PDF_EXPORT_WEB_TRIGGER_KEY = 'pdf-export-trigger';
const SUPPORTED_CONTENT_TYPE = 'page';
const ACCESS_CHECK_CONCURRENCY = 5;

// Storage key groups acknowledgements by page and by the user who acknowledged them.
export const acknowledgementKey = (contentId, accountId) => `ack:${contentId}:${accountId}`;

// Storage key for the reader assignment of a page (who must read it, and by when).
export const assignmentKey = (contentId) => `assignment:${contentId}`;

// Storage key for a campaign (a named group of page assignments sharing readers/due date).
const campaignKey = (campaignId) => `campaign:${campaignId}`;

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function normalizeConvertedContentType(value) {
  if (typeof value === 'string') {
    return value;
  }
  return value?.type || value?.contentType || null;
}

async function getContentType(contentId) {
  const response = await api.asApp().requestConfluence(route`/wiki/api/v2/content/convert-ids-to-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentIds: [contentId] }),
  });

  if (!response.ok) {
    throw new Error(`Could not validate content type for ${contentId}.`);
  }

  const body = await response.json();
  return normalizeConvertedContentType(body?.results?.[contentId]);
}

async function validateSupportedPage(contentId) {
  const contentType = await getContentType(contentId);

  if (!contentType) {
    throw new Error(`Content not found or not visible to the app: ${contentId}`);
  }
  if (contentType !== SUPPORTED_CONTENT_TYPE) {
    throw new Error(
      `Unsupported content type "${contentType}" for ${contentId}. Attestly currently supports Confluence pages only.`
    );
  }

  return getPage(contentId);
}

export function accessResultsFromAssignment(assignment) {
  const results = assignment?.accessCheck?.results;
  return Array.isArray(results) ? results : [];
}

async function checkReaderAccess(contentId, accountIds) {
  const checkedAt = new Date().toISOString();
  const uniqueAccountIds = [...new Set(accountIds)];

  const results = await mapWithConcurrency(uniqueAccountIds, ACCESS_CHECK_CONCURRENCY, async (accountId) => {
    try {
      const response = await api.asUser().requestConfluence(
        route`/wiki/rest/api/content/${contentId}/permission/check`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: { type: 'user', identifier: accountId },
            operation: 'read',
          }),
        }
      );

      if (!response.ok) {
        return {
          accountId,
          hasReadAccess: null,
          errors: [`Permission check unavailable (HTTP ${response.status}).`],
        };
      }

      const body = await response.json();
      return {
        accountId,
        hasReadAccess: Boolean(body.hasPermission),
        errors: (body.errors || []).map((error) => error.translation || String(error)),
      };
    } catch (error) {
      return {
        accountId,
        hasReadAccess: null,
        errors: [error?.message || 'Permission check failed.'],
      };
    }
  });

  return { checkedAt, results };
}

// Fetches the page's current title and version. Used both to detect when a page has been
// edited (so previous acknowledgements no longer count) and to validate a contentId exists.
export async function getPage(contentId) {
  const response = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${contentId}`);
  if (!response.ok) {
    throw new Error(`Page not found: ${contentId}`);
  }
  return response.json();
}

async function getPageVersion(contentId) {
  const page = await getPage(contentId);
  return page.version.number;
}

// Validates admin-submitted quiz question data server-side, regardless of any client-side
// validation already performed. An empty/missing array means "no quiz" (the default, fully
// backward-compatible behavior).
function validateQuizQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return [];
  }
  if (questions.length > 3) {
    throw new Error('A page can have at most 3 quiz questions.');
  }

  return questions.map((question) => {
    const text = (question?.text || '').trim();
    const options = Array.isArray(question?.options)
      ? question.options.map((option) => (option || '').trim()).filter(Boolean)
      : [];
    const correctIndex = Number(question?.correctIndex);

    if (!text) {
      throw new Error('Every quiz question needs question text.');
    }
    if (options.length < 2 || options.length > 4) {
      throw new Error('Every quiz question needs between 2 and 4 answer options.');
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      throw new Error('Every quiz question needs a valid correct answer selected.');
    }

    return { text, options, correctIndex };
  });
}

resolver.define('getAcknowledgementStatus', async (req) => {
  const { contentId } = req.payload;
  const { accountId } = req.context;

  const pageVersion = await getPageVersion(contentId);
  const record = await kvs.get(acknowledgementKey(contentId, accountId));
  const assignment = await kvs.get(assignmentKey(contentId));

  // Only count as acknowledged if the stored record matches the page's current version.
  const acknowledged = Boolean(record) && record.pageVersion === pageVersion;

  return {
    acknowledged,
    pageVersion,
    acknowledgedAt: acknowledged ? record.timestamp : null,
    // The admin can set a custom statement per assignment; fall back to null and let the
    // frontend supply its own default wording when nothing has been configured.
    attestationText: assignment?.attestationText || null,
    // Correct answers are stripped here so the client never receives them before grading.
    questions: (assignment?.questions || []).map(({ text, options }) => ({ text, options })),
  };
});

resolver.define('acknowledgePage', async (req) => {
  const { contentId, answers } = req.payload;
  const { accountId } = req.context;

  const pageVersion = await getPageVersion(contentId);
  const assignment = await kvs.get(assignmentKey(contentId));
  const questions = assignment?.questions || [];

  if (questions.length > 0) {
    const allCorrect =
      Array.isArray(answers) &&
      answers.length === questions.length &&
      questions.every((question, index) => answers[index] === question.correctIndex);

    // Wrong answers are an expected outcome, not a failure — let the reader try again rather
    // than throwing.
    if (!allCorrect) {
      return { acknowledged: false, incorrectAnswers: true };
    }
  }

  const record = {
    accountId,
    contentId,
    pageVersion,
    timestamp: new Date().toISOString(),
  };

  await kvs.set(acknowledgementKey(contentId, accountId), record);

  return {
    acknowledged: true,
    pageVersion,
    acknowledgedAt: record.timestamp,
  };
});

// Loads every stored acknowledgement record by paging through keys prefixed with "ack:".
export async function getAllAcknowledgementRecords() {
  const records = [];
  let cursor;

  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith('ack:')).limit(50);
    if (cursor) {
      query = query.cursor(cursor);
    }
    const page = await query.getMany();
    records.push(...page.results.map((result) => result.value));
    cursor = page.nextCursor;
  } while (cursor);

  return records;
}

// Loads every stored assignment record by paging through keys prefixed with "assignment:".
export async function getAllAssignmentRecords() {
  const records = [];
  let cursor;

  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith('assignment:')).limit(50);
    if (cursor) {
      query = query.cursor(cursor);
    }
    const page = await query.getMany();
    records.push(...page.results.map((result) => result.value));
    cursor = page.nextCursor;
  } while (cursor);

  return records;
}

// Creates or replaces a page's reader assignment. Shared by the standalone "assign one page"
// resolver and by campaigns, which fan out the same shape to every page they cover.
async function upsertAssignment({
  contentId,
  accountIds,
  dueDate,
  campaignId = null,
  attestationText = null,
  questions = [],
  accessCheck = null,
}) {
  const existing = await kvs.get(assignmentKey(contentId));
  const record = {
    contentId,
    contentType: SUPPORTED_CONTENT_TYPE,
    accountIds,
    dueDate: dueDate || null,
    campaignId,
    // Custom wording shown in place of the byline macro's default sentence; null means "use
    // the default text".
    attestationText: attestationText || null,
    // Optional comprehension check gating acknowledgement; [] means no quiz (existing behavior
    // is unchanged when this is empty).
    questions,
    accessCheck,
    // Cleared whenever the assignment changes, so a reminder can go out again under the new terms.
    lastReminderDate: existing ? existing.lastReminderDate : null,
    updatedAt: new Date().toISOString(),
  };

  await kvs.set(assignmentKey(contentId), record);
  return record;
}

resolver.define('assignReaders', async (req) => {
  const { contentId, accountIds, dueDate, attestationText, questions } = req.payload;

  if (!contentId || !Array.isArray(accountIds) || accountIds.length === 0) {
    throw new Error('A page ID and at least one reader are required.');
  }

  await validateSupportedPage(contentId);
  const validatedQuestions = validateQuizQuestions(questions);
  const accessCheck = await checkReaderAccess(contentId, accountIds);

  return upsertAssignment({
    contentId,
    accountIds,
    dueDate,
    attestationText,
    questions: validatedQuestions,
    accessCheck,
  });
});

// Loads every stored campaign record by paging through keys prefixed with "campaign:".
export async function getAllCampaignRecords() {
  const records = [];
  let cursor;

  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith('campaign:')).limit(50);
    if (cursor) {
      query = query.cursor(cursor);
    }
    const page = await query.getMany();
    records.push(...page.results.map((result) => result.value));
    cursor = page.nextCursor;
  } while (cursor);

  return records;
}

resolver.define('createCampaign', async (req) => {
  const { name, contentIds, accountIds, dueDate, attestationText, questions } = req.payload;

  if (!name || !Array.isArray(contentIds) || contentIds.length === 0) {
    throw new Error('A campaign name and at least one page ID are required.');
  }
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    throw new Error('At least one reader is required.');
  }

  // Validate every content ID before creating anything. Attestly currently supports pages only.
  await mapWithConcurrency(contentIds, ACCESS_CHECK_CONCURRENCY, (contentId) =>
    validateSupportedPage(contentId)
  );
  const validatedQuestions = validateQuizQuestions(questions);
  const accessChecks = new Map(
    await mapWithConcurrency(contentIds, ACCESS_CHECK_CONCURRENCY, async (contentId) => [
      contentId,
      await checkReaderAccess(contentId, accountIds),
    ])
  );

  const campaignId = `${Date.now()}`;
  const campaign = {
    campaignId,
    name,
    contentIds,
    accountIds,
    dueDate: dueDate || null,
    attestationText: attestationText || null,
    questions: validatedQuestions,
    createdAt: new Date().toISOString(),
  };
  await kvs.set(campaignKey(campaignId), campaign);

  await Promise.all(
    contentIds.map((contentId) =>
      upsertAssignment({
        contentId,
        accountIds,
        dueDate,
        campaignId,
        attestationText,
        questions: validatedQuestions,
        accessCheck: accessChecks.get(contentId),
      })
    )
  );

  return campaign;
});

resolver.define('getAdminOverview', async () => {
  const [ackRecords, assignmentRecords, campaignRecords] = await Promise.all([
    getAllAcknowledgementRecords(),
    getAllAssignmentRecords(),
    getAllCampaignRecords(),
  ]);

  const ackRecordsByPage = new Map();
  for (const record of ackRecords) {
    if (!ackRecordsByPage.has(record.contentId)) {
      ackRecordsByPage.set(record.contentId, []);
    }
    ackRecordsByPage.get(record.contentId).push(record);
  }

  const assignmentByPage = new Map(assignmentRecords.map((record) => [record.contentId, record]));
  const campaignById = new Map(campaignRecords.map((record) => [record.campaignId, record]));

  const contentIds = new Set([...ackRecordsByPage.keys(), ...assignmentByPage.keys()]);

  const pages = await mapWithConcurrency(
    Array.from(contentIds),
    ACCESS_CHECK_CONCURRENCY,
    async (contentId) => {
      let page = null;
      try {
        page = await getPage(contentId);
      } catch (error) {
        page = null;
      }
      const pageRecords = ackRecordsByPage.get(contentId) || [];
      const currentVersion = page ? page.version.number : null;

      // Only records matching the page's current version still count as valid acknowledgements.
      const currentAcknowledgements = currentVersion
        ? pageRecords.filter((record) => record.pageVersion === currentVersion)
        : [];
      const acknowledgedAccountIds = new Set(currentAcknowledgements.map((record) => record.accountId));

      const assignment = assignmentByPage.get(contentId);
      const assignedAccountIds = assignment ? assignment.accountIds : [];
      const pendingAccountIds = assignedAccountIds.filter((id) => !acknowledgedAccountIds.has(id));
      const accessResults = accessResultsFromAssignment(assignment);
      const inaccessibleAccountIds = accessResults
        .filter((result) => result.hasReadAccess === false)
        .map((result) => result.accountId);
      const unknownAccessAccountIds = accessResults
        .filter((result) => result.hasReadAccess === null)
        .map((result) => result.accountId);
      const completionPercent =
        assignedAccountIds.length > 0
          ? Math.round(
              ((assignedAccountIds.length - pendingAccountIds.length) / assignedAccountIds.length) * 100
            )
          : null;

      const campaign = assignment?.campaignId ? campaignById.get(assignment.campaignId) : null;

      return {
        contentId,
        title: page ? page.title : 'Restricted or unavailable page',
        currentVersion,
        pageAccessIssue: !page,
        acknowledgedCount: currentAcknowledgements.length,
        acknowledgedUsers: currentAcknowledgements.map((record) => ({
          accountId: record.accountId,
          timestamp: record.timestamp,
        })),
        assignedAccountIds,
        pendingAccountIds,
        inaccessibleAccountIds,
        unknownAccessAccountIds,
        accessCheck: assignment ? assignment.accessCheck || null : null,
        completionPercent,
        dueDate: assignment ? assignment.dueDate : null,
        campaignId: campaign ? campaign.campaignId : null,
        campaignName: campaign ? campaign.name : null,
        attestationText: assignment ? assignment.attestationText : null,
        quizQuestionCount: (assignment?.questions || []).length,
      };
    }
  );

  return pages;
});

// A personal, per-user mirror of getAdminOverview: what has THIS reader been assigned, and
// have they acknowledged the current version. Deliberately avoids getAllAcknowledgementRecords()
// (a full system-wide scan) — only a targeted kvs.get per page this user is actually assigned
// to, and getPage only for those same pages, so it stays cheap regardless of site size.
resolver.define('getMyReadsOverview', async (req) => {
  const { accountId } = req.context;

  const [allAssignments, campaignRecords] = await Promise.all([
    getAllAssignmentRecords(),
    getAllCampaignRecords(),
  ]);

  const myAssignments = allAssignments.filter((assignment) => assignment.accountIds.includes(accountId));
  const campaignById = new Map(campaignRecords.map((campaign) => [campaign.campaignId, campaign]));

  return mapWithConcurrency(
    myAssignments,
    ACCESS_CHECK_CONCURRENCY,
    async (assignment) => {
      const pageResponse = await api.asUser().requestConfluence(
        route`/wiki/api/v2/pages/${assignment.contentId}`
      );
      const page = pageResponse.ok ? await pageResponse.json() : null;
      const ackRecord = await kvs.get(acknowledgementKey(assignment.contentId, accountId));
      const acknowledged = Boolean(page) && Boolean(ackRecord) && ackRecord.pageVersion === page.version.number;
      const campaign = assignment.campaignId ? campaignById.get(assignment.campaignId) : null;

      return {
        contentId: assignment.contentId,
        title: page ? page.title : 'Restricted or unavailable page',
        currentVersion: page ? page.version.number : null,
        acknowledged,
        acknowledgedAt: acknowledged ? ackRecord.timestamp : null,
        dueDate: assignment.dueDate,
        campaignName: campaign ? campaign.name : null,
        attestationText: assignment.attestationText || null,
        hasQuiz: (assignment.questions || []).length > 0,
        accessIssue: !page,
      };
    }
  );
});

// Wraps a CSV field in quotes and escapes embedded quotes, per RFC 4180.
function csvField(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

// Timestamps are stored as UTC ISO strings; format them as UTC for exports so the displayed
// time is unambiguous regardless of which time zone the reviewer opening the export is in.
export function formatTimestampForDisplay(isoTimestamp) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(isoTimestamp)) + ' UTC';
}

export async function resolveRecordsWithTitles() {
  const records = await getAllAcknowledgementRecords();
  const pageTitleCache = new Map();

  return Promise.all(
    records.map(async (record) => {
      if (!pageTitleCache.has(record.contentId)) {
        const page = await getPage(record.contentId);
        pageTitleCache.set(record.contentId, page.title);
      }

      return {
        ...record,
        pageTitle: pageTitleCache.get(record.contentId),
      };
    })
  );
}

// Builds the full audit CSV. A UTF-8 BOM is prepended so Excel detects the encoding and
// renders non-ASCII page titles/names correctly instead of as mojibake.
export async function buildAcknowledgementsCsv() {
  const records = await resolveRecordsWithTitles();

  const rows = records.map((record) =>
    [
        record.pageTitle,
        record.contentId,
        record.pageVersion,
        record.accountId,
        formatTimestampForDisplay(record.timestamp),
      ]
        .map(csvField)
        .join(',')
  );

  const header = ['Page', 'Page ID', 'Page version', 'User (accountId)', 'Acknowledged at (UTC)']
    .map(csvField)
    .join(',');

  const UTF8_BOM = '﻿';
  return UTF8_BOM + [header, ...rows].join('\r\n');
}

resolver.define('getCsvExportUrl', async () => {
  const baseUrl = await webTrigger.getUrl(CSV_EXPORT_WEB_TRIGGER_KEY);
  const token = process.env.CSV_EXPORT_TOKEN;
  return `${baseUrl}?token=${encodeURIComponent(token)}`;
});

resolver.define('getPdfExportUrl', async () => {
  const baseUrl = await webTrigger.getUrl(PDF_EXPORT_WEB_TRIGGER_KEY);
  // Reuses the same shared secret as the CSV export — functionally the same "admin panel
  // export" concern, not worth a second `forge variables set --encrypt` per environment.
  const token = process.env.CSV_EXPORT_TOKEN;
  return `${baseUrl}?token=${encodeURIComponent(token)}`;
});

// Lets an admin trigger the reminder scan on demand (e.g. to test it) instead of waiting for
// the daily scheduledTrigger to fire.
resolver.define('runReminderCheckNow', async () => {
  return sendReminders();
});

export const handler = resolver.getDefinitions();
