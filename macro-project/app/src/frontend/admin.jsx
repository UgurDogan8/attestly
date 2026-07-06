import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  DatePicker,
  DynamicTable,
  Heading,
  Inline,
  Link,
  List,
  ListItem,
  LoadingButton,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  Radio,
  RadioGroup,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  TextArea,
  Textfield,
  User,
  UserPicker,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const CARD_XCSS = {
  borderRadius: 'radius.medium',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
};

// Some UI Kit field onChange handlers pass the raw value, others pass an event-like object
// depending on the component/runtime version; normalize defensively so a shape mismatch
// never throws mid-render (which would crash the whole panel).
const extractText = (value) => (typeof value === 'string' ? value : value?.target?.value ?? '');

const MAX_QUIZ_QUESTIONS = 3;
const MIN_QUIZ_OPTIONS = 2;
const MAX_QUIZ_OPTIONS = 4;

const emptyQuizQuestion = () => ({ text: '', options: ['', ''], correctIndex: 0 });

// True if any configured question is missing text or has an empty option — used to disable
// the parent form's submit button, so we never need to filter blank slots out at submit time
// (which would risk shifting correctIndex off by one).
const isQuizIncomplete = (questions) =>
  questions.some(
    (question) =>
      !question.text.trim() ||
      question.options.length < MIN_QUIZ_OPTIONS ||
      question.options.some((option) => !option.trim())
  );

// A repeatable, structured editor for up to MAX_QUIZ_QUESTIONS multiple-choice questions.
// Shared by both the "Assign readers" and "Create campaign" forms rather than duplicated,
// since this is genuinely new array-of-array state complexity not used anywhere else here.
const QuizQuestionsEditor = ({ questions, onChange }) => {
  const updateQuestionText = (qIndex, text) =>
    onChange(questions.map((q, i) => (i === qIndex ? { ...q, text } : q)));

  const updateOptionText = (qIndex, oIndex, value) =>
    onChange(
      questions.map((q, i) =>
        i === qIndex
          ? { ...q, options: q.options.map((o, j) => (j === oIndex ? value : o)) }
          : q
      )
    );

  const updateCorrectIndex = (qIndex, correctIndex) =>
    onChange(questions.map((q, i) => (i === qIndex ? { ...q, correctIndex } : q)));

  const addOption = (qIndex) =>
    onChange(
      questions.map((q, i) =>
        i === qIndex && q.options.length < MAX_QUIZ_OPTIONS
          ? { ...q, options: [...q.options, ''] }
          : q
      )
    );

  const removeOption = (qIndex, oIndex) =>
    onChange(
      questions.map((q, i) => {
        if (i !== qIndex || q.options.length <= MIN_QUIZ_OPTIONS) {
          return q;
        }
        const options = q.options.filter((_, j) => j !== oIndex);
        // Clamp correctIndex so it still points at a valid remaining option.
        const correctIndex =
          q.correctIndex === oIndex ? 0 : q.correctIndex > oIndex ? q.correctIndex - 1 : q.correctIndex;
        return { ...q, options, correctIndex };
      })
    );

  const addQuestion = () =>
    questions.length < MAX_QUIZ_QUESTIONS && onChange([...questions, emptyQuizQuestion()]);

  const removeQuestion = (qIndex) => onChange(questions.filter((_, i) => i !== qIndex));

  return (
    <Stack space="space.150">
      <Text>
        {`Optional comprehension check (up to ${MAX_QUIZ_QUESTIONS} multiple-choice questions). Leave empty to skip — the reader will just see the plain acknowledge button.`}
      </Text>
      {questions.map((question, qIndex) => (
        <Box key={qIndex} padding="space.150" xcss={CARD_XCSS}>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center" spread="space-between">
              <Text weight="bold">{`Question ${qIndex + 1}`}</Text>
              <Button appearance="subtle" onClick={() => removeQuestion(qIndex)}>
                Remove question
              </Button>
            </Inline>
            <Textfield
              label="Question text"
              placeholder="What is the maximum password age?"
              onChange={(value) => updateQuestionText(qIndex, extractText(value))}
            />
            {question.options.map((optionText, oIndex) => (
              <Inline key={oIndex} space="space.100" alignBlock="center">
                <Textfield
                  label={oIndex === 0 ? 'Answer options' : undefined}
                  placeholder={`Option ${oIndex + 1}`}
                  onChange={(value) => updateOptionText(qIndex, oIndex, extractText(value))}
                />
                {question.options.length > MIN_QUIZ_OPTIONS && (
                  <Button appearance="subtle" onClick={() => removeOption(qIndex, oIndex)}>
                    Remove option
                  </Button>
                )}
              </Inline>
            ))}
            {question.options.length < MAX_QUIZ_OPTIONS && (
              <Inline>
                <Button onClick={() => addOption(qIndex)}>Add option</Button>
              </Inline>
            )}
            <RadioGroup
              key={`correct-${qIndex}-${question.options.length}-${question.correctIndex}`}
              name={`correct-answer-${qIndex}`}
              label="Correct answer"
              onChange={(value) => updateCorrectIndex(qIndex, Number(value))}
            >
              {question.options.map((optionText, oIndex) => (
                <Radio
                  key={oIndex}
                  label={optionText.trim() || `Option ${oIndex + 1}`}
                  value={String(oIndex)}
                  defaultChecked={question.correctIndex === oIndex}
                />
              ))}
            </RadioGroup>
          </Stack>
        </Box>
      ))}
      {questions.length < MAX_QUIZ_QUESTIONS && (
        <Inline>
          <Button onClick={addQuestion}>Add question</Button>
        </Inline>
      )}
    </Stack>
  );
};

const AdminApp = () => {
  const [pages, setPages] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [selectedPage, setSelectedPage] = useState(null);
  const [csvExportUrl, setCsvExportUrl] = useState(null);
  const [pdfExportUrl, setPdfExportUrl] = useState(null);
  const [reminderLoading, setReminderLoading] = useState(false);

  const [assignFormKey, setAssignFormKey] = useState(0);
  const [assignContentId, setAssignContentId] = useState('');
  const [assignReadersValue, setAssignReadersValue] = useState([]);
  const [assignDueDate, setAssignDueDate] = useState('');
  const [assignAttestationText, setAssignAttestationText] = useState('');
  const [assignQuestions, setAssignQuestions] = useState([]);
  const [assignLoading, setAssignLoading] = useState(false);

  const [campaignFormKey, setCampaignFormKey] = useState(0);
  const [campaignName, setCampaignName] = useState('');
  const [campaignContentIdsText, setCampaignContentIdsText] = useState('');
  const [campaignReadersValue, setCampaignReadersValue] = useState([]);
  const [campaignDueDate, setCampaignDueDate] = useState('');
  const [campaignAttestationText, setCampaignAttestationText] = useState('');
  const [campaignQuestions, setCampaignQuestions] = useState([]);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  const loadOverview = () => invoke('getAdminOverview').then(setPages);

  useEffect(() => {
    loadOverview().catch(() => setError('Could not load data. Please refresh the page.'));
    Promise.all([invoke('getCsvExportUrl'), invoke('getPdfExportUrl')])
      .then(([csvUrl, pdfUrl]) => {
        setCsvExportUrl(csvUrl);
        setPdfExportUrl(pdfUrl);
      })
      .catch(() => setError('Could not prepare export downloads. Please refresh the page.'));
  }, []);

  const handleAssign = async () => {
    setMessage(null);
    setError(null);
    setAssignLoading(true);
    try {
      const accountIds = assignReadersValue.map((reader) => reader.id);
      await invoke('assignReaders', {
        contentId: (assignContentId || '').trim(),
        accountIds,
        dueDate: assignDueDate || null,
        attestationText: (assignAttestationText || '').trim() || null,
        questions: assignQuestions,
      });
      await loadOverview();
      setMessage('Reader assignment saved.');
      setAssignContentId('');
      setAssignReadersValue([]);
      setAssignDueDate('');
      setAssignAttestationText('');
      setAssignQuestions([]);
      setAssignFormKey((key) => key + 1);
    } catch (err) {
      setError(err?.message || 'Could not save the assignment. Check that the page ID is correct.');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleCreateCampaign = async () => {
    setMessage(null);
    setError(null);
    setCampaignLoading(true);
    try {
      const contentIds = campaignContentIdsText
        .split(/[\n,]+/)
        .map((id) => id.trim())
        .filter(Boolean);
      const accountIds = campaignReadersValue.map((reader) => reader.id);
      await invoke('createCampaign', {
        name: (campaignName || '').trim(),
        contentIds,
        accountIds,
        dueDate: campaignDueDate || null,
        attestationText: (campaignAttestationText || '').trim() || null,
        questions: campaignQuestions,
      });
      await loadOverview();
      setMessage('Campaign created.');
      setCampaignName('');
      setCampaignContentIdsText('');
      setCampaignReadersValue([]);
      setCampaignDueDate('');
      setCampaignAttestationText('');
      setCampaignQuestions([]);
      setCampaignFormKey((key) => key + 1);
    } catch (err) {
      setError(err?.message || 'Could not create the campaign. Check the page IDs.');
    } finally {
      setCampaignLoading(false);
    }
  };

  const handleRunRemindersNow = async () => {
    setReminderLoading(true);
    setMessage(null);
    setError(null);
    try {
      const {
        remindersSent,
        skippedInaccessibleReaders = 0,
        skippedUnavailablePages = 0,
      } = await invoke('runReminderCheckNow');
      const skippedMessage =
        skippedInaccessibleReaders > 0
          ? ` Skipped ${skippedInaccessibleReaders} reader(s) without page access.`
          : '';
      const unavailableMessage =
        skippedUnavailablePages > 0
          ? ` Skipped ${skippedUnavailablePages} unavailable page(s).`
          : '';
      setMessage(
        `Reminder check complete: posted a reminder comment on ${remindersSent} page(s).${skippedMessage}${unavailableMessage}`
      );
      await loadOverview();
    } catch (err) {
      setError(err?.message || 'Could not send reminders.');
    } finally {
      setReminderLoading(false);
    }
  };

  if (!pages) {
    return error ? (
      <SectionMessage appearance="error">
        <Text>{error}</Text>
      </SectionMessage>
    ) : (
      <Spinner size="medium" />
    );
  }

  const head = {
    cells: [
      { key: 'title', content: 'Page' },
      { key: 'version', content: 'Current version' },
      { key: 'count', content: 'Acknowledged count' },
      { key: 'completion', content: 'Completion' },
      { key: 'access', content: 'Access' },
      { key: 'dueDate', content: 'Due date' },
      { key: 'campaign', content: 'Campaign' },
      { key: 'quiz', content: 'Quiz' },
      { key: 'actions', content: '' },
    ],
  };

  const rows = pages.map((page) => ({
    key: page.contentId,
    cells: [
      { key: 'title', content: <Text>{page.title}</Text> },
      { key: 'version', content: <Text>{page.currentVersion || '-'}</Text> },
      { key: 'count', content: <Text>{page.acknowledgedCount}</Text> },
      {
        key: 'completion',
        content:
          page.completionPercent === null ? (
            <Text>No assignment</Text>
          ) : (
            <Lozenge appearance={page.completionPercent === 100 ? 'success' : 'inprogress'}>
              {`${page.completionPercent}% (${page.pendingAccountIds.length} pending)`}
            </Lozenge>
          ),
      },
      {
        key: 'access',
        content: page.pageAccessIssue ? (
          <Lozenge appearance="removed">Page unavailable</Lozenge>
        ) : page.inaccessibleAccountIds.length > 0 ? (
          <Lozenge appearance="removed">{`${page.inaccessibleAccountIds.length} no access`}</Lozenge>
        ) : page.unknownAccessAccountIds.length > 0 ? (
          <Lozenge appearance="inprogress">{`${page.unknownAccessAccountIds.length} unchecked`}</Lozenge>
        ) : page.assignedAccountIds.length > 0 ? (
          <Lozenge appearance="success">OK</Lozenge>
        ) : (
          <Text>-</Text>
        ),
      },
      { key: 'dueDate', content: <Text>{page.dueDate || '-'}</Text> },
      { key: 'campaign', content: <Text>{page.campaignName || '-'}</Text> },
      {
        key: 'quiz',
        content:
          page.quizQuestionCount > 0 ? (
            <Lozenge appearance="new">{`${page.quizQuestionCount} question(s)`}</Lozenge>
          ) : (
            <Text>-</Text>
          ),
      },
      {
        key: 'actions',
        content: <Button onClick={() => setSelectedPage(page)}>View who acknowledged</Button>,
      },
    ],
  }));

  const campaignsById = new Map();
  for (const page of pages) {
    if (!page.campaignId) {
      continue;
    }
    if (!campaignsById.has(page.campaignId)) {
      campaignsById.set(page.campaignId, {
        campaignId: page.campaignId,
        name: page.campaignName,
        dueDate: page.dueDate,
        pages: [],
      });
    }
    campaignsById.get(page.campaignId).pages.push(page);
  }

  const campaigns = Array.from(campaignsById.values()).map((campaign) => {
    const totalAssigned = campaign.pages.reduce((sum, p) => sum + p.assignedAccountIds.length, 0);
    const totalPending = campaign.pages.reduce((sum, p) => sum + p.pendingAccountIds.length, 0);
    const completionPercent =
      totalAssigned > 0 ? Math.round(((totalAssigned - totalPending) / totalAssigned) * 100) : null;
    return { ...campaign, completionPercent, totalPending };
  });

  const campaignHead = {
    cells: [
      { key: 'name', content: 'Campaign' },
      { key: 'pageCount', content: 'Page count' },
      { key: 'completion', content: 'Completion' },
      { key: 'dueDate', content: 'Due date' },
      { key: 'actions', content: '' },
    ],
  };

  const campaignRows = campaigns.map((campaign) => ({
    key: campaign.campaignId,
    cells: [
      { key: 'name', content: <Text>{campaign.name}</Text> },
      { key: 'pageCount', content: <Text>{campaign.pages.length}</Text> },
      {
        key: 'completion',
        content:
          campaign.completionPercent === null ? (
            <Text>-</Text>
          ) : (
            <Lozenge appearance={campaign.completionPercent === 100 ? 'success' : 'inprogress'}>
              {`${campaign.completionPercent}% (${campaign.totalPending} pending)`}
            </Lozenge>
          ),
      },
      { key: 'dueDate', content: <Text>{campaign.dueDate || '-'}</Text> },
      {
        key: 'actions',
        content: <Button onClick={() => setSelectedCampaign(campaign)}>View campaign pages</Button>,
      },
    ],
  }));

  return (
    <Stack space="space.300">
      <Heading size="large">Acknowledgement Dashboard</Heading>

      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      {message && (
        <SectionMessage appearance="confirmation">
          <Text>{message}</Text>
        </SectionMessage>
      )}

      <Box backgroundColor="elevation.surface.raised" padding="space.300" xcss={CARD_XCSS}>
        <Stack key={assignFormKey} space="space.150">
          <Heading size="medium">Assign readers</Heading>
          <Text>Assign a page as a reading task to specific users.</Text>
          <Textfield
            name="contentId"
            label="Page ID"
            placeholder="Page ID"
            description="The ID of the page that needs to be acknowledged — the number after .../pages/ in the browser address bar when you open the page in Confluence"
            isRequired
            onChange={(value) => setAssignContentId(extractText(value))}
          />
          <UserPicker
            name="readers"
            label="Readers"
            placeholder="Search by name or email..."
            description="Choose the people who need to read and acknowledge this page"
            isMulti
            isRequired
            onChange={(value) => setAssignReadersValue(Array.isArray(value) ? value : value ? [value] : [])}
          />
          <DatePicker
            name="dueDate"
            label="Due date (optional)"
            placeholder="MM-DD-YYYY"
            description="Selected readers are expected to acknowledge the page by this date; leave blank to skip due-date tracking and reminders"
            onChange={(value) => setAssignDueDate(extractText(value))}
          />
          <TextArea
            name="attestationText"
            label="Custom attestation statement (optional)"
            placeholder="I acknowledge and will comply with this policy."
            description={`What the reader is confirming when they click the button. Leave blank to use the default: "You need to confirm that you've read and understood this page."`}
            onChange={(value) => setAssignAttestationText(extractText(value))}
          />
          <QuizQuestionsEditor questions={assignQuestions} onChange={setAssignQuestions} />
          <Inline>
            <LoadingButton
              appearance="primary"
              isLoading={assignLoading}
              isDisabled={
                !(assignContentId || '').trim() ||
                assignReadersValue.length === 0 ||
                isQuizIncomplete(assignQuestions)
              }
              onClick={handleAssign}
            >
              Assign readers
            </LoadingButton>
          </Inline>
        </Stack>
      </Box>

      <Box backgroundColor="elevation.surface.raised" padding="space.300" xcss={CARD_XCSS}>
        <Stack key={campaignFormKey} space="space.150">
          <Heading size="medium">Create campaign</Heading>
          <Text>Group multiple pages under a single name, reader list, and due date.</Text>
          <Textfield
            name="campaignName"
            label="Campaign name"
            placeholder="E.g. Q3 2026 Security Policy Review"
            description="A name you'll recognize in the admin panel — for display purposes only"
            isRequired
            onChange={(value) => setCampaignName(extractText(value))}
          />
          <TextArea
            name="campaignContentIds"
            label="Page IDs"
            placeholder={'131073\n360450'}
            description="The IDs of the pages to include in the campaign — one per line, or comma-separated"
            isMonospaced
            onChange={(value) => setCampaignContentIdsText(extractText(value))}
          />
          <UserPicker
            name="campaignReaders"
            label="Readers"
            placeholder="Search by name or email..."
            description="People who need to read and acknowledge ALL of the pages above — the same reader list applies to everyone"
            isMulti
            isRequired
            onChange={(value) =>
              setCampaignReadersValue(Array.isArray(value) ? value : value ? [value] : [])
            }
          />
          <DatePicker
            name="campaignDueDate"
            label="Due date (optional)"
            placeholder="MM-DD-YYYY"
            description="Shared due date for every page in the campaign; leave blank to skip reminders"
            onChange={(value) => setCampaignDueDate(extractText(value))}
          />
          <TextArea
            name="campaignAttestationText"
            label="Custom attestation statement (optional)"
            placeholder="I acknowledge and will comply with this policy."
            description={`What the reader is confirming when they click the button, applied to every page in this campaign. Leave blank to use the default: "You need to confirm that you've read and understood this page."`}
            onChange={(value) => setCampaignAttestationText(extractText(value))}
          />
          <QuizQuestionsEditor questions={campaignQuestions} onChange={setCampaignQuestions} />
          <Inline>
            <LoadingButton
              appearance="primary"
              isLoading={campaignLoading}
              isDisabled={
                !(campaignName || '').trim() ||
                !(campaignContentIdsText || '').trim() ||
                campaignReadersValue.length === 0 ||
                isQuizIncomplete(campaignQuestions)
              }
              onClick={handleCreateCampaign}
            >
              Create campaign
            </LoadingButton>
          </Inline>
        </Stack>
      </Box>

      <Box backgroundColor="elevation.surface.raised" padding="space.300" xcss={CARD_XCSS}>
        <Stack space="space.150">
          <Heading size="medium">Audit & reminders</Heading>
          <Text>
            Download every acknowledgement record as a CSV for audit purposes, or send an
            immediate reminder comment and notification to pending readers on assignments whose
            due date is approaching or has passed (this normally runs automatically every day).
          </Text>
          <ButtonGroup>
            {csvExportUrl ? (
              <Link href={csvExportUrl} openNewTab appearance="button">
                Download audit CSV
              </Link>
            ) : (
              <Button isDisabled>Download audit CSV</Button>
            )}
            {pdfExportUrl ? (
              <Link href={pdfExportUrl} openNewTab appearance="button">
                Download audit PDF
              </Link>
            ) : (
              <Button isDisabled>Download audit PDF</Button>
            )}
            <LoadingButton isLoading={reminderLoading} onClick={handleRunRemindersNow}>
              Send reminder to pending readers now
            </LoadingButton>
          </ButtonGroup>
        </Stack>
      </Box>

      {campaigns.length > 0 && (
        <Stack space="space.150">
          <Heading size="medium">Campaigns</Heading>
          <Text>Combined acknowledgement status for campaigns spanning multiple pages.</Text>
          <DynamicTable head={campaignHead} rows={campaignRows} />
        </Stack>
      )}

      <Stack space="space.150">
        <Heading size="medium">Acknowledgement status by page</Heading>
        <Text>Current status of every page that has an acknowledgement record or reader assignment.</Text>
        {pages.length === 0 ? (
          <Text>No pages have acknowledgement records or assignments yet.</Text>
        ) : (
          <DynamicTable head={head} rows={rows} />
        )}
      </Stack>

      <ModalTransition>
        {selectedCampaign && (
          <Modal onClose={() => setSelectedCampaign(null)}>
            <ModalHeader>
              <ModalTitle>{selectedCampaign.name}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <List>
                {selectedCampaign.pages.map((page) => (
                  <ListItem key={page.contentId}>
                    <Inline space="space.100" alignBlock="center">
                      <Text>{page.title}</Text>
                      {page.completionPercent === null ? (
                        <Text>No assignment</Text>
                      ) : (
                        <Lozenge appearance={page.completionPercent === 100 ? 'success' : 'inprogress'}>
                          {`${page.completionPercent}% (${page.pendingAccountIds.length} pending)`}
                        </Lozenge>
                      )}
                      {page.inaccessibleAccountIds.length > 0 && (
                        <Lozenge appearance="removed">
                          {`${page.inaccessibleAccountIds.length} no access`}
                        </Lozenge>
                      )}
                      {page.unknownAccessAccountIds.length > 0 && (
                        <Lozenge appearance="inprogress">
                          {`${page.unknownAccessAccountIds.length} unchecked`}
                        </Lozenge>
                      )}
                    </Inline>
                  </ListItem>
                ))}
              </List>
            </ModalBody>
            <ModalFooter>
              <Button onClick={() => setSelectedCampaign(null)}>Close</Button>
            </ModalFooter>
          </Modal>
        )}
        {selectedPage && (
          <Modal onClose={() => setSelectedPage(null)}>
            <ModalHeader>
              <ModalTitle>{selectedPage.title}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.200">
                {selectedPage.pageAccessIssue && (
                  <SectionMessage appearance="warning">
                    <Text>
                      The app could not load this page. It may have been deleted, restricted, or
                      moved outside the app's current access.
                    </Text>
                  </SectionMessage>
                )}
                {selectedPage.attestationText && (
                  <Stack space="space.050">
                    <Heading size="small">Attestation statement</Heading>
                    <Text>{selectedPage.attestationText}</Text>
                  </Stack>
                )}
                <Stack space="space.050">
                  <Heading size="small">Acknowledged by</Heading>
                  {selectedPage.acknowledgedUsers.length === 0 ? (
                    <Text>No one has acknowledged the current version of this page yet.</Text>
                  ) : (
                    <List>
                      {selectedPage.acknowledgedUsers.map((entry) => (
                        <ListItem key={entry.accountId}>
                          <Inline space="space.100" alignBlock="center">
                            <User accountId={entry.accountId} />
                            <Text>{new Date(entry.timestamp).toLocaleString('en-US')}</Text>
                          </Inline>
                        </ListItem>
                      ))}
                    </List>
                  )}
                </Stack>
                {selectedPage.assignedAccountIds.length > 0 && (
                  <Stack space="space.050">
                    <Heading size="small">Assigned but not yet acknowledged</Heading>
                    {selectedPage.pendingAccountIds.length === 0 ? (
                      <Text>Everyone assigned has acknowledged.</Text>
                    ) : (
                      <List>
                        {selectedPage.pendingAccountIds.map((accountId) => (
                          <ListItem key={accountId}>
                            <User accountId={accountId} />
                          </ListItem>
                        ))}
                      </List>
                    )}
                  </Stack>
                )}
                {selectedPage.assignedAccountIds.length > 0 && (
                  <Stack space="space.050">
                    <Heading size="small">Access check</Heading>
                    {selectedPage.accessCheck?.checkedAt && (
                      <Text>
                        {`Last checked ${new Date(selectedPage.accessCheck.checkedAt).toLocaleString('en-US')}.`}
                      </Text>
                    )}
                    {selectedPage.inaccessibleAccountIds.length === 0 &&
                    selectedPage.unknownAccessAccountIds.length === 0 ? (
                      <Text>All assigned readers had page access when this assignment was saved.</Text>
                    ) : (
                      <Stack space="space.100">
                        {selectedPage.inaccessibleAccountIds.length > 0 && (
                          <Stack space="space.050">
                            <Text>Assigned but cannot access this page:</Text>
                            <List>
                              {selectedPage.inaccessibleAccountIds.map((accountId) => (
                                <ListItem key={accountId}>
                                  <User accountId={accountId} />
                                </ListItem>
                              ))}
                            </List>
                          </Stack>
                        )}
                        {selectedPage.unknownAccessAccountIds.length > 0 && (
                          <Stack space="space.050">
                            <Text>Access could not be verified for these readers:</Text>
                            <List>
                              {selectedPage.unknownAccessAccountIds.map((accountId) => (
                                <ListItem key={accountId}>
                                  <User accountId={accountId} />
                                </ListItem>
                              ))}
                            </List>
                          </Stack>
                        )}
                      </Stack>
                    )}
                  </Stack>
                )}
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button onClick={() => setSelectedPage(null)}>Close</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
