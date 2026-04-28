"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiRequestError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Board = { id: string; name: string; privacy: string | null };
type BoardsResponse = {
  data: Board[];
  defaultBoardId: string | null;
};

/**
 * Small select on the Pinterest account card. Lists the user's boards
 * (fetched live from Pinterest via the API proxy) and PATCHes our backend
 * when the selection changes. Without this the user is stuck with whatever
 * board Pinterest happened to return first at OAuth-complete time.
 */
export function PinterestDefaultBoard({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.accounts.pinterestBoards(accountId),
    queryFn: () =>
      apiFetch<BoardsResponse>(`/v1/accounts/${accountId}/pinterest/boards`),
    // Boards rarely change in a single dashboard session; keep stale longer
    // so opening a second card doesn't re-hit Pinterest.
    staleTime: 5 * 60 * 1000,
  });

  const setDefault = useMutation({
    mutationFn: (boardId: string) =>
      apiFetch<{ defaultBoardId: string; defaultBoardName: string }>(
        `/v1/accounts/${accountId}/pinterest/default-board`,
        {
          method: "PATCH",
          body: JSON.stringify({ boardId }),
        },
      ),
    onSuccess: (data) => {
      toast.success(`Default board: ${data.defaultBoardName}`);
      queryClient.invalidateQueries({
        queryKey: queryKeys.accounts.pinterestBoards(accountId),
      });
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof ApiRequestError
          ? err.payload.message
          : err instanceof Error
            ? err.message
            : "Failed to update default board.",
      );
    },
  });

  if (query.isLoading) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Loading boards…
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="text-[11px] text-destructive">
        Couldn&apos;t load boards.
      </div>
    );
  }
  const boards = query.data?.data ?? [];
  const currentId = query.data?.defaultBoardId ?? undefined;
  if (boards.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        No boards found on this Pinterest account.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground shrink-0">
        Default board
      </span>
      <Select
        value={currentId}
        onValueChange={(v) => setDefault.mutate(v)}
        disabled={setDefault.isPending}
      >
        <SelectTrigger size="sm" className="h-7 text-xs flex-1 min-w-0">
          <SelectValue placeholder="Pick a board" />
        </SelectTrigger>
        <SelectContent>
          {boards.map((b) => (
            <SelectItem key={b.id} value={b.id} className="text-xs">
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
