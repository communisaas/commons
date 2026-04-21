import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const join = mutation({
  args: {
    email: v.string(),
    emailHash: v.string(),
    userId: v.optional(v.id("users")),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_emailHash", (q) => q.eq("emailHash", args.emailHash))
      .first();

    if (existing) {
      // Link authenticated user if not already linked
      if (args.userId && !existing.userId) {
        await ctx.db.patch(existing._id, {
          userId: args.userId,
          updatedAt: Date.now(),
        });
      }
      return { status: "exists" as const };
    }

    await ctx.db.insert("waitlist", {
      email: args.email,
      emailHash: args.emailHash,
      userId: args.userId,
      source: args.source,
      status: "waiting",
      updatedAt: Date.now(),
    });

    return { status: "created" as const };
  },
});
