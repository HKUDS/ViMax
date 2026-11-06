"use client";

import { QueryCache, MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { toast } from "sonner";
import { useState, type ReactNode } from "react";
import { trpc } from "./client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/trpc";
const KEY_ACCESS = "vimax-access-token";

// ── Global tRPC error handler ────────────────────────────────────────

let unauthorizedToastShown = false;

function handleTRPCError(error: Error) {
  // tRPC errors from @trpc/client have a .shape property
  const trpcError = error as {
    shape?: { data?: { code?: string }; message?: string };
  };

  if (trpcError.shape?.data?.code === "UNAUTHORIZED") {
    if (unauthorizedToastShown) return;
    unauthorizedToastShown = true;

    toast.error("请先登录", {
      description: "登录后即可使用此功能",
      action: {
        label: "去登录",
        onClick: () => {
          unauthorizedToastShown = false;
          window.location.href = "/login";
        },
      },
      duration: 5000,
      onDismiss: () => {
        unauthorizedToastShown = false;
      },
    });
    return;
  }

  // Generic error toast for other failures
  const message = trpcError.shape?.message ?? error.message ?? "操作失败";
  toast.error(message, { duration: 4000 });
}

// ── Provider ─────────────────────────────────────────────────────────

export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError(error) {
            handleTRPCError(error);
          },
        }),
        mutationCache: new MutationCache({
          onError(error) {
            handleTRPCError(error);
          },
        }),
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: API_URL,
          headers() {
            const token =
              typeof window !== "undefined"
                ? localStorage.getItem(KEY_ACCESS)
                : null;
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
