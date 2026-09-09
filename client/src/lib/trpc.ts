import type { StowVoyage } from "@/lib/prestow/types";

type ParseResult = { available: false } | { available: true; voyage: StowVoyage; unresolved: string[] };

export const trpc = {
  prestow: {
    aiStatus: { useQuery: (_input?: undefined, _opts?: unknown) => ({ data: { available: false as const }, isLoading: false, isError: false }) },
    parseScenario: {
      useMutation: () => ({
        mutateAsync: async (_input: { text: string }): Promise<ParseResult> => ({ available: false }),
        isPending: false,
      }),
    },
  },
  useUtils: () => ({
    chem: {
      detail: {
        fetch: async (_input: { productId: number | null }): Promise<{
          product: { boilPoint: string | null; meltPoint: string | null; polyRemark: string | null } | null;
        }> => ({ product: null }),
      },
    },
  }),
};
