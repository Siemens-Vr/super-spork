import { randomUUID } from 'node:crypto';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { PrismaCheckpointSaver } from './checkpointer.js';
import { interviewRunnable, type InterviewOutput } from './provider.js';
import type { FrozenScenario } from '../../validators/assessment-interaction.schema.js';
export interface InterviewMessage {
  id: string;
  role: 'AI' | 'APPLICANT';
  text: string;
  scenarioIndex: number;
}
export interface Workflow {
  scenarios: FrozenScenario[];
  requirements: {
    id: string;
    competencyId: string;
    name: string;
    description: string;
    requiredScore: number;
    weight: number;
  }[];
  context: unknown;
  cursor: number;
  followups: number;
  clarificationUsed?: boolean;
  relevantSeen?: boolean;
  messages: InterviewMessage[];
  response: { id: string; text: string; skip?: boolean } | null;
  processed: string[];
  evaluation: { competencyId: string; score: number; evidence: string }[];
  output: InterviewOutput | null;
  finished: boolean;
}
const state = Annotation.Root({ workflow: Annotation<Workflow>() });
const message = (
  role: 'AI' | 'APPLICANT',
  text: string,
  scenarioIndex: number,
): InterviewMessage => ({ id: randomUUID(), role, text, scenarioIndex });
export const assessmentGraph = new StateGraph(state)
  .addNode('present_scenario', ({ workflow: w }) => ({
    workflow: {
      ...w,
      messages: [
        message(
          'AI',
          `Welcome. This assessment evaluates your technical reasoning and safe engineering practice. You may answer in text or confirm a speech transcript.\n\n${w.scenarios[0]!.prompt}`,
          0,
        ),
      ],
    },
  }))
  .addNode('ai_interviewer', async ({ workflow: w }) => {
    const scenario = w.scenarios[w.cursor]!;
    const requirements = w.requirements.filter((r) =>
      scenario.competencyIds.includes(r.competencyId),
    );
    const priorRelevant =
      w.relevantSeen ??
      w.messages.some((m) => m.role === 'APPLICANT' && m.scenarioIndex === w.cursor);
    if (w.response?.skip && !priorRelevant)
      return {
        workflow: {
          ...w,
          output: {
            action: 'COMPLETE' as const,
            responseKind: 'DECLINED' as const,
            message: 'This scenario has been skipped.',
            evaluations: requirements.map((r) => ({
              competencyId: r.competencyId,
              score: 0,
              evidence:
                'Insufficient evidence: the applicant explicitly skipped this scenario. Human assessor review is required.',
            })),
          },
        },
      };
    const output = await interviewRunnable.invoke({
      scenario,
      followups: w.followups,
      clarificationUsed: w.clarificationUsed ?? false,
      forceComplete: !!w.response?.skip,
      requirements: w.requirements.filter((r) => scenario.competencyIds.includes(r.competencyId)),
      context: w.context,
      conversation: [
        ...w.messages
          .filter((m) => m.scenarioIndex === w.cursor)
          .map((m) => ({ role: m.role, text: m.text })),
        { role: 'APPLICANT', text: w.response!.text },
      ],
    });
    return { workflow: { ...w, output } };
  })
  .addNode('followup_or_next_scenario', ({ workflow: w }) => {
    const output = w.output!;
    const kind = w.response?.skip ? 'DECLINED' : (output.responseKind ?? 'RELEVANT');
    const unclear = kind === 'UNRELATED' || kind === 'PROCESS_QUESTION';
    const canClarify = unclear && !w.clarificationUsed;
    const relevantSeen =
      (w.relevantSeen ??
        w.messages.some((m) => m.role === 'APPLICANT' && m.scenarioIndex === w.cursor)) ||
      kind === 'RELEVANT';
    if (canClarify)
      return {
        workflow: {
          ...w,
          messages: [
            ...w.messages,
            message('APPLICANT', w.response!.text, w.cursor),
            message(
              'AI',
              kind === 'PROCESS_QUESTION'
                ? 'I asked again because your previous response did not provide enough information about this scenario. Please describe your approach, or choose “I don’t know / Skip this scenario” to continue.'
                : 'Your response does not appear to address this scenario. Please describe your approach, or choose “I don’t know / Skip this scenario” to continue.',
              w.cursor,
            ),
          ],
          processed: [...w.processed, w.response!.id],
          clarificationUsed: true,
          relevantSeen,
          output: null,
        },
      };
    const complete =
      kind === 'DECLINED' || (unclear && !!w.clarificationUsed) || output.action === 'COMPLETE';
    const evaluations =
      complete && !relevantSeen
        ? w.requirements
            .filter((r) => w.scenarios[w.cursor]!.competencyIds.includes(r.competencyId))
            .map((r) => ({
              competencyId: r.competencyId,
              score: 0,
              evidence:
                'Insufficient evidence: no relevant technical response was provided after the clarification opportunity or explicit skip. Human assessor review is required.',
            }))
        : output.evaluations;
    const messages = [
      ...w.messages,
      message('APPLICANT', w.response!.text, w.cursor),
      ...(!complete ? [message('AI', output.message, w.cursor)] : []),
    ];
    const processed = [...w.processed, w.response!.id];
    if (!complete)
      return {
        workflow: {
          ...w,
          messages,
          processed,
          followups: w.followups + 1,
          relevantSeen,
          output: null,
        },
      };
    const cursor = w.cursor + 1,
      finished = cursor >= w.scenarios.length;
    messages.push(
      message(
        'AI',
        finished
          ? 'You have completed all scenarios. Your evidence will be reviewed before your final competency report is issued.'
          : w.scenarios[cursor]!.prompt,
        cursor,
      ),
    );
    return {
      workflow: {
        ...w,
        messages,
        processed,
        cursor,
        finished,
        followups: 0,
        clarificationUsed: false,
        relevantSeen: false,
        evaluation: [...w.evaluation, ...evaluations],
        output: null,
      },
    };
  })
  .addConditionalEdges(START, ({ workflow: w }) =>
    !w.messages.length
      ? 'present_scenario'
      : w.response && !w.processed.includes(w.response.id)
        ? 'ai_interviewer'
        : END,
  )
  .addEdge('present_scenario', END)
  .addEdge('ai_interviewer', 'followup_or_next_scenario')
  .addEdge('followup_or_next_scenario', END)
  .compile({ checkpointer: new PrismaCheckpointSaver() });
export const graphConfig = (sessionId: string) => ({
  configurable: { thread_id: sessionId },
  durability: 'sync' as const,
});
