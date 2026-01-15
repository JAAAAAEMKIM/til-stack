import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./trpc.js";
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  verifyGoogleToken,
  getOrCreateUser,
  createSessionToken,
  deleteUserAndData,
} from "../lib/auth.js";
import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

// Schema for migrating local data
const migrateDataSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      content: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
  ),
  skipDays: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      value: z.string(),
      createdAt: z.string(),
    })
  ),
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      content: z.string(),
      isDefault: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
  ),
});

export const authRouter = router({
  // Get Google OAuth URL for login
  getGoogleAuthUrl: publicProcedure.query(() => {
    return { url: getGoogleAuthUrl() };
  }),

  // Handle OAuth callback - exchange code for session
  handleCallback: publicProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ input }) => {
      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(input.code);

      // Verify the ID token and get user info
      const { googleId } = await verifyGoogleToken(tokens.id_token);

      // Get or create user
      const { user, isNewUser } = await getOrCreateUser(googleId);

      // Create session token
      const sessionToken = await createSessionToken(user);

      return {
        success: true,
        sessionToken,
        isNewUser,
        user: {
          id: user.id,
          googleId: user.googleId,
        },
      };
    }),

  // Get current user
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) {
      return null;
    }
    return {
      id: ctx.user.id,
      googleId: ctx.user.googleId,
    };
  }),

  // Logout - just returns success, cookie clearing happens in Hono middleware
  logout: protectedProcedure.mutation(() => {
    return { success: true };
  }),

  // Delete account and all data
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    await deleteUserAndData(ctx.user.id);
    return { success: true };
  }),

  // Migrate local data to server
  migrateData: protectedProcedure
    .input(migrateDataSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      let entriesMigrated = 0;
      let skipDaysMigrated = 0;
      let templatesMigrated = 0;

      // Migrate entries (upsert by date for this user)
      for (const entry of input.entries) {
        const existing = await db
          .select()
          .from(schema.entries)
          .where(
            and(
              eq(schema.entries.date, entry.date),
              eq(schema.entries.userId, userId)
            )
          )
          .get();

        if (existing) {
          // Update if local is newer
          if (entry.updatedAt > existing.updatedAt) {
            await db
              .update(schema.entries)
              .set({
                content: entry.content,
                updatedAt: entry.updatedAt,
              })
              .where(eq(schema.entries.id, existing.id));
            entriesMigrated++;
          }
        } else {
          // Insert new entry
          await db.insert(schema.entries).values({
            id: nanoid(),
            date: entry.date,
            content: entry.content,
            userId,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          });
          entriesMigrated++;
        }
      }

      // Migrate skip days (check for duplicates)
      for (const skipDay of input.skipDays) {
        const existing = await db
          .select()
          .from(schema.skipDays)
          .where(
            and(
              eq(schema.skipDays.type, skipDay.type),
              eq(schema.skipDays.value, skipDay.value),
              eq(schema.skipDays.userId, userId)
            )
          )
          .get();

        if (!existing) {
          await db.insert(schema.skipDays).values({
            id: nanoid(),
            type: skipDay.type,
            value: skipDay.value,
            userId,
            createdAt: skipDay.createdAt,
          });
          skipDaysMigrated++;
        }
      }

      // Migrate templates (check for name duplicates)
      for (const template of input.templates) {
        const existing = await db
          .select()
          .from(schema.templates)
          .where(
            and(
              eq(schema.templates.name, template.name),
              eq(schema.templates.userId, userId)
            )
          )
          .get();

        if (!existing) {
          await db.insert(schema.templates).values({
            id: nanoid(),
            name: template.name,
            content: template.content,
            isDefault: template.isDefault,
            userId,
            createdAt: template.createdAt,
            updatedAt: template.updatedAt,
          });
          templatesMigrated++;
        }
      }

      return {
        success: true,
        migrated: {
          entries: entriesMigrated,
          skipDays: skipDaysMigrated,
          templates: templatesMigrated,
        },
      };
    }),
});
