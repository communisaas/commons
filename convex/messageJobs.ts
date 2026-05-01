import {
	internalMutationGeneric as internalMutation,
	mutationGeneric as mutation,
	queryGeneric as query
} from 'convex/server';
import { v } from 'convex/values';
import { requireAuth } from './_authHelpers';

const publicMutation = mutation as any;
const publicQuery = query as any;
const privateMutation = internalMutation as any;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'expired']);

function isExpired(job: any) {
	return job.expiresAt <= Date.now() && !TERMINAL_STATUSES.has(job.status);
}

function publicJob(job: any) {
	const status = isExpired(job) ? 'expired' : job.status;

	return {
		jobId: job.jobId,
		inputHash: job.inputHash,
		status,
		phase: job.phase ?? null,
		encryptedResult: job.encryptedResult ?? null,
		encryptionMeta: job.encryptionMeta ?? null,
		errorCode: job.errorCode ?? null,
		errorMessage: job.errorMessage ?? null,
		attempts: job.attempts,
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
		expiresAt: job.expiresAt
	};
}

async function expireJob(ctx: any, job: any) {
	if (!isExpired(job)) return publicJob(job);
	await ctx.db.patch(job._id, {
		status: 'expired',
		updatedAt: Date.now()
	});
	const updated = await ctx.db.get(job._id);
	if (!updated) {
		throw new Error('Message generation job unavailable');
	}
	return publicJob(updated);
}

async function loadOwnedJob(ctx: any, jobId: string) {
	const { userId } = await requireAuth(ctx);
	const job = await ctx.db
		.query('messageGenerationJobs')
		.withIndex('by_jobId', (q: any) => q.eq('jobId', jobId))
		.unique();

	if (!job) return { userId, job: null };
	if (job.userId !== userId) {
		throw new Error('Message generation job not found');
	}
	return { userId, job };
}

export const startOrGet = publicMutation({
	args: {
		jobId: v.string(),
		inputHash: v.string(),
		recoveryPublicKeyJwk: v.any(),
		expiresAt: v.number()
	},
	handler: async (ctx: any, args: any) => {
		const { userId } = await requireAuth(ctx);
		const existing = await ctx.db
			.query('messageGenerationJobs')
			.withIndex('by_jobId', (q: any) => q.eq('jobId', args.jobId))
			.unique();

		if (existing) {
			if (existing.userId !== userId) {
				throw new Error('Message generation job not found');
			}
			if (existing.inputHash !== args.inputHash) {
				throw new Error('Message generation job input mismatch');
			}
			if (isExpired(existing)) {
				return { created: false, job: await expireJob(ctx, existing) };
			}
			return { created: false, job: publicJob(existing) };
		}

		const now = Date.now();
		const id = await ctx.db.insert('messageGenerationJobs', {
			jobId: args.jobId,
			userId,
			inputHash: args.inputHash,
			status: 'pending',
			phase: 'sources',
			recoveryPublicKeyJwk: args.recoveryPublicKeyJwk,
			attempts: 0,
			createdAt: now,
			updatedAt: now,
			expiresAt: args.expiresAt
		});

		const job = await ctx.db.get(id);
		if (!job) {
			throw new Error('Message generation job unavailable');
		}
		return { created: true, job: publicJob(job) };
	}
});

export const getForUser = publicQuery({
	args: { jobId: v.string() },
	handler: async (ctx: any, args: any) => {
		const { job } = await loadOwnedJob(ctx, args.jobId);
		return job ? publicJob(job) : null;
	}
});

export const markRunning = publicMutation({
	args: { jobId: v.string(), phase: v.optional(v.string()) },
	handler: async (ctx: any, args: any) => {
		const { job } = await loadOwnedJob(ctx, args.jobId);
		if (!job) return null;
		if (isExpired(job)) return expireJob(ctx, job);
		if (TERMINAL_STATUSES.has(job.status)) return publicJob(job);

		await ctx.db.patch(job._id, {
			status: 'running',
			phase: args.phase ?? job.phase ?? 'sources',
			attempts: job.status === 'pending' ? job.attempts + 1 : job.attempts,
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(job._id);
		return publicJob(updated);
	}
});

export const checkpointPhase = publicMutation({
	args: {
		jobId: v.string(),
		phase: v.string()
	},
	handler: async (ctx: any, args: any) => {
		const { job } = await loadOwnedJob(ctx, args.jobId);
		if (!job) return null;
		if (isExpired(job)) return expireJob(ctx, job);
		if (TERMINAL_STATUSES.has(job.status)) return publicJob(job);

		await ctx.db.patch(job._id, {
			status: job.status === 'pending' ? 'running' : job.status,
			phase: args.phase,
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(job._id);
		return publicJob(updated);
	}
});

export const completeEncrypted = publicMutation({
	args: {
		jobId: v.string(),
		encryptedResult: v.any(),
		encryptionMeta: v.any()
	},
	handler: async (ctx: any, args: any) => {
		const { job } = await loadOwnedJob(ctx, args.jobId);
		if (!job) return null;
		if (isExpired(job)) return expireJob(ctx, job);
		if (job.status === 'completed') return publicJob(job);
		if (job.status === 'expired') return publicJob(job);

		await ctx.db.patch(job._id, {
			status: 'completed',
			phase: 'complete',
			encryptedResult: args.encryptedResult,
			encryptionMeta: args.encryptionMeta,
			errorCode: undefined,
			errorMessage: undefined,
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(job._id);
		return publicJob(updated);
	}
});

export const fail = publicMutation({
	args: {
		jobId: v.string(),
		errorCode: v.optional(v.string()),
		errorMessage: v.string()
	},
	handler: async (ctx: any, args: any) => {
		const { job } = await loadOwnedJob(ctx, args.jobId);
		if (!job) return null;
		if (isExpired(job)) return expireJob(ctx, job);
		if (job.status === 'completed') return publicJob(job);

		await ctx.db.patch(job._id, {
			status: 'failed',
			errorCode: args.errorCode ?? 'GENERATION_FAILED',
			errorMessage: args.errorMessage,
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(job._id);
		return publicJob(updated);
	}
});

export const cleanupExpired = privateMutation({
	args: {},
	handler: async (ctx: any) => {
		const now = Date.now();
		const expired = await ctx.db
			.query('messageGenerationJobs')
			.withIndex('by_expiresAt', (q: any) => q.lt('expiresAt', now))
			.take(100);

		for (const job of expired) {
			await ctx.db.delete(job._id);
		}

		return { deleted: expired.length };
	}
});
