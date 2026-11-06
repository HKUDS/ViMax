import { initTRPC, TRPCError } from "@trpc/server";
import * as authService from "../domain/auth/auth.service.js";

export type TrpcContext = {
  user: { id: string; email: string; name: string; avatarUrl: string | null } | null;
};

export async function createContext(opts: {
  req: Request;
}): Promise<TrpcContext> {
  const authHeader = opts.req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null };
  }

  const token = authHeader.slice(7);
  const user = await authService.getUserFromToken(token);
  return { user };
}

const t = initTRPC.context<TrpcContext>().create();

// Base procedures
export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

// Auth middleware
const isAuthed = t.middleware((opts) => {
  const { ctx } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }
  return opts.next({
    ctx: {
      ...ctx,
      user: ctx.user, // Narrowed to non-null
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);
