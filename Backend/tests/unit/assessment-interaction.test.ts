import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmedResponseSchema,
  browserTranscriptSchema,
  interactionPolicySchema,
  sessionStartSchema,
} from '../../src/validators/assessment-interaction.schema.js';
import { validateWav } from '../../src/integrations/speech/providers.js';
import {
  interviewer,
  type InterviewInput,
} from '../../src/integrations/assessment-interview/provider.js';
import { env } from '../../src/config/env.js';
const competencyId = '11111111-1111-4111-8111-111111111111';
const input: InterviewInput = {
  scenario: {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'UNIT_SCENARIO',
    version: 1,
    title: 'Approved scenario',
    prompt: 'Explain a safe evidence-based diagnostic approach.',
    evaluationCriteria: 'Assess reasoning from evidence, never accent or confidence.',
    competencyIds: [competencyId],
    maxFollowups: 1,
    approved: true,
  },
  followups: 1,
  conversation: [
    { role: 'APPLICANT', text: 'The PLC input is 24 V; the target speed is 1500 rpm.' },
  ],
  requirements: [
    {
      competencyId,
      name: 'Engineering',
      description: 'Apply safe diagnostic reasoning.',
      requiredScore: 70,
    },
  ],
  context: { career: 'Mechatronics Engineer' },
};
const original = env.AI_PROVIDER;
afterEach(() => {
  vi.unstubAllGlobals();
  env.AI_PROVIDER = original;
});
describe('assessment interaction contracts', () => {
  it('requires explicit start and privacy confirmation', () => {
    expect(sessionStartSchema.safeParse({ confirmed: false }).success).toBe(false);
    expect(interactionPolicySchema.parse({}).cameraRequired).toBe(false);
    expect(interactionPolicySchema.safeParse({ cameraRequired: true }).success).toBe(false);
  });
  it('requires final reviewed voice responses and rejects partial transcripts', () => {
    expect(browserTranscriptSchema.safeParse({ text: 'PLC', isFinal: false }).success).toBe(false);
    expect(
      confirmedResponseSchema.safeParse({
        promptId: competencyId,
        origin: 'VOICE',
        confirmed: true,
        text: 'PLC input 24 V',
      }).success,
    ).toBe(false);
    expect(
      confirmedResponseSchema.safeParse({
        promptId: competencyId,
        origin: 'TEXT',
        confirmed: true,
        text: 'PLC input 24 V',
      }).success,
    ).toBe(true);
  });
  it('validates WAV signatures and PCM duration from the actual bytes', () => {
    const b = Buffer.alloc(32044);
    b.write('RIFF');
    b.writeUInt32LE(32036, 4);
    b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(16000, 24);
    b.writeUInt32LE(32000, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write('data', 36);
    b.writeUInt32LE(32000, 40);
    expect(validateWav(b)).toBe(1000);
    expect(() => validateWav(Buffer.from('pretend audio'))).toThrow();
    b.writeUInt32LE(64000, 40);
    expect(() => validateWav(b)).toThrow();
  });
  it('fails closed when no live AI provider is configured', async () => {
    env.AI_PROVIDER = 'disabled';
    await expect(interviewer.invoke(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
  });
  it('uses confirmed technical text and accepts a bounded structured evaluation', async () => {
    env.AI_PROVIDER = 'compatible';
    const response = {
      action: 'COMPLETE',
      message: 'Your technical response has been recorded.',
      evaluations: [
        {
          competencyId,
          score: 75,
          evidence:
            'The confirmed answer correctly identifies a PLC input and specifies voltage and speed units.',
        },
      ],
    };
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }),
        ),
      );
    vi.stubGlobal('fetch', mock);
    expect(await interviewer.invoke(input)).toEqual(response);
    const payload = JSON.parse(mock.mock.calls[0]![1].body as string);
    expect(payload.messages[1].content).toContain('24 V');
    expect(payload.messages[1].content).toContain('1500 rpm');
    expect(payload.messages[0].content).toContain('never assess accent');
    expect(payload.max_tokens).toBe(env.AI_MAX_OUTPUT_TOKENS);
    expect(payload.reasoning_effort).toBe(env.AI_REASONING_EFFORT);
    expect(payload.keep_alive).toBe(env.AI_KEEP_ALIVE);
    expect(JSON.parse(payload.messages[1].content).scenario).not.toHaveProperty('approved');
  });
  it('rejects token-truncated output even if its JSON happens to parse', async () => {
    env.AI_PROVIDER = 'compatible';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'length',
                message: {
                  content: JSON.stringify({
                    action: 'FOLLOW_UP',
                    message: 'Tell me more about the measurements.',
                    evaluations: [],
                  }),
                },
              },
            ],
          }),
        ),
      ),
    );
    await expect(interviewer.invoke(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
    });
  });
  it('rejects unapproved competency IDs and excessive followups', async () => {
    env.AI_PROVIDER = 'compatible';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      action: 'FOLLOW_UP',
                      message: 'One more unrelated question would exceed the approved limit.',
                      evaluations: [],
                    }),
                  },
                },
              ],
            }),
          ),
      ),
    );
    await expect(interviewer.invoke(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    action: 'COMPLETE',
                    message: 'Your response has been recorded.',
                    evaluations: [
                      {
                        competencyId: '33333333-3333-4333-8333-333333333333',
                        score: 80,
                        evidence: 'This is an unsupported competency and must be rejected.',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        ),
      ),
    );
    await expect(interviewer.invoke(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
    });
  });
  it('does not fabricate a response after a transport failure', async () => {
    env.AI_PROVIDER = 'compatible';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection failed')));
    await expect(interviewer.invoke(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
  });
});
