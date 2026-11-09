import { prisma } from '../src/config/prisma.js';
export async function seedAssessmentScenarios() {
  const role = await prisma.jobRole.findUnique({ where: { title: 'Mechatronics Engineer' } });
  if (!role) return;
  const blueprint = await prisma.assessmentBlueprint.findUnique({
    where: { jobRoleId_version: { jobRoleId: role.id, version: 1 } },
  });
  if (!blueprint) return;
  const scenarios = [
    {
      code: 'MECHA-DEV-SYSTEMS',
      competencyCode: '3-COMP-1',
      title: 'Conveyor sensing and control',
      prompt:
        'A training conveyor uses a motor, a controller and a position sensor. The sensor indicator changes as a component passes, but the conveyor sometimes fails to move. Explain the relationship between the mechanical, electrical and control parts. What information would you gather to distinguish a sensor problem from a controller or drive problem? State your assumptions and the safety precautions that bound your investigation.',
      evaluationCriteria:
        'Evaluate accurate input-control-output and feedback reasoning, distinction between signal and power paths, explicit assumptions, useful measurements and units, and a safe investigation without bypassing protective interlocks. Award only demonstrated technical understanding; do not score communication style or accent.',
    },
    {
      code: 'MECHA-DEV-DIAGNOSIS',
      competencyCode: '3-COMP-2',
      title: 'Intermittent production stoppage',
      prompt:
        'A simulated automated assembly station stops intermittently after a maintenance change. Restarting temporarily restores production. You have access to event logs, approved drawings and maintenance records. Describe a structured diagnostic plan, the evidence you would collect, how you would test competing explanations safely, and how you would establish that the root cause was resolved.',
      evaluationCriteria:
        'Evaluate hypotheses linked to evidence, systematic isolation rather than random replacement, use of logs and change history, controlled tests with observable outcomes, and verification of the repair. Do not reward unsupported certainty or unsafe live work.',
    },
    {
      code: 'MECHA-DEV-SAFETY',
      competencyCode: '3-COMP-3',
      title: 'Safe return to service',
      prompt:
        'A training production machine has been repaired and a colleague suggests bypassing a guard sensor to finish a trial quickly. Explain how you would respond, what approvals and risk controls are needed before testing, and what evidence and documentation you would require before returning the machine to service.',
      evaluationCriteria:
        'Evaluate refusal to bypass safeguards, appropriate isolation and authorisation, risk assessment and escalation, approved verification of protective functions, communication of residual risks, and documented return-to-service decisions. Do not infer competence from confident wording alone.',
    },
  ];
  for (const [position, item] of scenarios.entries()) {
    const competency = await prisma.competency.findUnique({ where: { code: item.competencyCode } });
    if (!competency) continue;
    const { competencyCode: _code, ...definition } = item;
    const scenario = await prisma.assessmentScenario.upsert({
      where: { code_version: { code: item.code, version: 1 } },
      create: {
        ...definition,
        version: 1,
        competencyIds: [competency.id],
        maxFollowups: 1,
        approved: true,
      },
      update: {},
    });
    const positionUsed = await prisma.blueprintScenario.findUnique({
      where: { blueprintId_position: { blueprintId: blueprint.id, position } },
    });
    if (!positionUsed)
      await prisma.blueprintScenario.upsert({
        where: { blueprintId_scenarioId: { blueprintId: blueprint.id, scenarioId: scenario.id } },
        create: { blueprintId: blueprint.id, scenarioId: scenario.id, position },
        update: {},
      });
  }
}
