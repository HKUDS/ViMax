import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { config } from "../../config/env.js";
import * as authService from "../../domain/auth/auth.service.js";
import { publicProcedure, router } from "../trpc.js";

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(6, "Password must be at least 6 characters"),
        name: z.string().min(1, "Name is required"),
        inviteCode: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const expectedInviteCode = config.registrationInviteCode();
      if (expectedInviteCode && input.inviteCode !== expectedInviteCode) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Invalid registration invite code" });
      }
      const result = await authService.registerUser(input.email, input.password, input.name);
      return result;
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await authService.loginUser(input.email, input.password);
      return result;
    }),

  refresh: publicProcedure
    .input(
      z.object({
        refreshToken: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const tokens = await authService.refreshSession(input.refreshToken);
      return tokens;
    }),

  logout: publicProcedure
    .input(
      z.object({
        refreshToken: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      await authService.logoutSession(input.refreshToken);
      return { ok: true };
    }),

  me: publicProcedure
    .input(
      z.object({
        accessToken: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const user = await authService.getUserFromToken(input.accessToken);
      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired token" });
      }
      return { user };
    }),
});
