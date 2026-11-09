import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  writesSortKey,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type CheckpointListOptions,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { prisma } from '../../config/prisma.js';
import { z } from 'zod';
const address = (config: RunnableConfig) => ({
  sessionId: z.uuid().parse(config.configurable?.thread_id),
  namespace: String(config.configurable?.checkpoint_ns ?? ''),
});
const configuration = (
  sessionId: string,
  namespace: string,
  checkpointId: string,
): RunnableConfig => ({
  configurable: { thread_id: sessionId, checkpoint_ns: namespace, checkpoint_id: checkpointId },
});
export class PrismaCheckpointSaver extends BaseCheckpointSaver {
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const key = address(config);
    const row = await prisma.assessmentGraphCheckpoint.findFirst({
      where: {
        ...key,
        ...(config.configurable?.checkpoint_id
          ? { checkpointId: String(config.configurable.checkpoint_id) }
          : {}),
      },
      orderBy: { checkpointId: 'desc' },
    });
    if (!row) return undefined;
    const writes = await prisma.assessmentGraphWrite.findMany({
      where: { ...key, checkpointId: row.checkpointId },
    });
    writes.sort((a, b) =>
      compareWritesSortKeys(
        writesSortKey(a.taskPath, a.taskId, a.idx),
        writesSortKey(b.taskPath, b.taskId, b.idx),
      ),
    );
    return {
      config: configuration(row.sessionId, row.namespace, row.checkpointId),
      checkpoint: (await this.serde.loadsTyped(row.type, row.data)) as Checkpoint,
      metadata: (await this.serde.loadsTyped(row.metadataType, row.metadata)) as CheckpointMetadata,
      ...(row.parentId
        ? { parentConfig: configuration(row.sessionId, row.namespace, row.parentId) }
        : {}),
      pendingWrites: await Promise.all(
        writes.map(
          async (w) =>
            [w.taskId, w.channel, await this.serde.loadsTyped(w.type, w.data)] as [
              string,
              string,
              unknown,
            ],
        ),
      ),
    };
  }
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const rows = await prisma.assessmentGraphCheckpoint.findMany({
      where: {
        ...address(config),
        ...(options?.before?.configurable?.checkpoint_id
          ? { checkpointId: { lt: String(options.before.configurable.checkpoint_id) } }
          : {}),
      },
      orderBy: { checkpointId: 'desc' },
      take: Math.min(options?.limit ?? 100, 1000),
    });
    for (const row of rows) {
      const tuple = await this.getTuple(
        configuration(row.sessionId, row.namespace, row.checkpointId),
      );
      if (
        tuple &&
        (!options?.filter ||
          Object.entries(options.filter).every(
            ([key, value]) =>
              (tuple.metadata as unknown as Record<string, unknown>)?.[key] === value,
          ))
      )
        yield tuple;
    }
  }
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const key = { ...address(config), checkpointId: checkpoint.id };
    const [type, data] = await this.serde.dumpsTyped(checkpoint),
      [metadataType, meta] = await this.serde.dumpsTyped(metadata);
    const payload = {
      type,
      data: new Uint8Array(data),
      metadataType,
      metadata: new Uint8Array(meta),
      parentId: config.configurable?.checkpoint_id
        ? String(config.configurable.checkpoint_id)
        : null,
    };
    await prisma.assessmentGraphCheckpoint.upsert({
      where: { sessionId_namespace_checkpointId: key },
      create: { ...key, ...payload },
      update: payload,
    });
    return configuration(key.sessionId, key.namespace, key.checkpointId);
  }
  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string, taskPath = '') {
    for (const [index, [channel, value]] of writes.entries()) {
      const key = {
        ...address(config),
        checkpointId: String(config.configurable?.checkpoint_id),
        taskId,
        idx: WRITES_IDX_MAP[channel] ?? index,
      };
      const [type, data] = await this.serde.dumpsTyped(value);
      await prisma.assessmentGraphWrite.upsert({
        where: { sessionId_namespace_checkpointId_taskId_idx: key },
        create: { ...key, channel, type, data: new Uint8Array(data), taskPath },
        update: key.idx < 0 ? { channel, type, data: new Uint8Array(data), taskPath } : {},
      });
    }
  }
  async deleteThread(threadId: string) {
    const sessionId = z.uuid().parse(threadId);
    await prisma.$transaction([
      prisma.assessmentGraphWrite.deleteMany({ where: { sessionId } }),
      prisma.assessmentGraphCheckpoint.deleteMany({ where: { sessionId } }),
    ]);
  }
}
