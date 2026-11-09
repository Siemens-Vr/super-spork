import { prisma } from '../src/config/prisma.js';
import { interviewer } from '../src/integrations/assessment-interview/provider.js';
import { frozenScenarioSchema } from '../src/validators/assessment-interaction.schema.js';
import { AppError } from '../src/errors/app-error.js';
const started = Date.now();
try {
  const scenario = frozenScenarioSchema.parse(
    await prisma.assessmentScenario.findUniqueOrThrow({
      where: { code_version: { code: 'MECHA-DEV-DIAGNOSIS', version: 1 } },
    }),
  );
  const competencies = await prisma.competency.findMany({
    where: { id: { in: scenario.competencyIds } },
  });
  console.log(
    'Checking the configured AI provider with an approved development scenario and synthetic evidence. No applicant result will be created.',
  );
  const result = await interviewer.invoke({
    scenario,
    followups: scenario.maxFollowups,
    requirements: competencies.map((c) => ({
      competencyId: c.id,
      name: c.name,
      description: c.description,
      requiredScore: 70,
    })),
    context: { career: 'Mechatronics Engineer', purpose: 'Synthetic provider smoke test' },
    conversation: [
      { role: 'AI', text: scenario.prompt },
      {
        role: 'APPLICANT',
        text: 'I would obtain authorisation and follow the isolation procedure. I would correlate fault timestamps with maintenance changes and approved drawings, compare sensor and controller hypotheses against measured evidence, verify the repair in a controlled authorised trial, and document the outcome.',
      },
    ],
  });
  console.log(
    JSON.stringify({
      live: true,
      action: result.action,
      message: result.message,
      evaluationCount: result.evaluations.length,
      elapsedMs: Date.now() - started,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      live: false,
      code: error instanceof AppError ? error.code : 'PROVIDER_CHECK_FAILED',
      message:
        error instanceof AppError
          ? error.message
          : 'Check provider configuration and database readiness',
      elapsedMs: Date.now() - started,
    }),
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
