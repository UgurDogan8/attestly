import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  LoadingButton,
  Radio,
  RadioGroup,
  SectionMessage,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

const App = () => {
  const [contentId, setContentId] = useState(null);
  const [status, setStatus] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [incorrectAnswers, setIncorrectAnswers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const context = await view.getContext();
        const id = context.extension.content.id;
        setContentId(id);
        const result = await invoke('getAcknowledgementStatus', { contentId: id });
        setStatus(result);
        const questionCount = result.questions ? result.questions.length : 0;
        setAnswers(new Array(questionCount).fill(null));
      } catch (err) {
        setError('Could not load acknowledgement status. Please refresh the page.');
      }
    };
    loadStatus();
  }, []);

  const updateAnswer = (index, value) => {
    setAnswers((previous) => {
      const next = [...previous];
      next[index] = Number(value);
      return next;
    });
  };

  const handleAcknowledge = async () => {
    setSubmitting(true);
    setError(null);
    setIncorrectAnswers(false);
    try {
      const result = await invoke('acknowledgePage', { contentId, answers });
      if (result.incorrectAnswers) {
        setIncorrectAnswers(true);
      } else {
        setStatus(result);
      }
    } catch (err) {
      setError('Could not save your acknowledgement. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (error) {
    return (
      <SectionMessage appearance="error">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  if (!status) {
    return <Spinner size="small" />;
  }

  if (status.acknowledged) {
    const acknowledgedDate = new Date(status.acknowledgedAt).toLocaleString('en-US');
    return (
      <SectionMessage appearance="confirmation">
        <Text>You've read and acknowledged this page ({acknowledgedDate}).</Text>
      </SectionMessage>
    );
  }

  const questions = status.questions || [];
  const hasQuiz = questions.length > 0;
  const allQuestionsAnswered = answers.length === questions.length &&
    answers.every((answer) => answer !== null && answer !== undefined);

  return (
    <Stack space="space.100">
      <Text>
        {status.attestationText || "You need to confirm that you've read and understood this page."}
      </Text>
      {incorrectAnswers && (
        <SectionMessage appearance="warning">
          <Text>Some answers were incorrect. Please review and try again.</Text>
        </SectionMessage>
      )}
      {hasQuiz && (
        <Stack space="space.150">
          {questions.map((question, index) => (
            <RadioGroup
              key={index}
              name={`quiz-question-${index}`}
              label={question.text}
              onChange={(value) => updateAnswer(index, value)}
            >
              {question.options.map((option, optionIndex) => (
                <Radio key={optionIndex} label={option} value={String(optionIndex)} />
              ))}
            </RadioGroup>
          ))}
        </Stack>
      )}
      <LoadingButton
        appearance="primary"
        isLoading={submitting}
        isDisabled={hasQuiz && !allQuestionsAnswered}
        onClick={handleAcknowledge}
      >
        I have read and understood this
      </LoadingButton>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
