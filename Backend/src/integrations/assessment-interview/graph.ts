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
  messages: InterviewMessage[];
  response: { id: string; text: string } | null;
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
    const output = await interviewRunnable.invoke({
      scenario,
      followups: w.followups,
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
    const messages = [
      ...w.messages,
      message('APPLICANT', w.response!.text, w.cursor),
      message('AI', output.message, w.cursor),
    ];
    const processed = [...w.processed, w.response!.id];
    if (output.action === 'FOLLOW_UP')
      return { workflow: { ...w, messages, processed, followups: w.followups + 1, output: null } };
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
        evaluation: [...w.evaluation, ...output.evaluations],
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
