import { useEffect, useMemo, useState } from 'react';
import { fetchWithClientId } from '@/lib/api/fetch-with-client-id';

export type WorktreeBaseRefKind = 'local' | 'remote' | 'detached';

export interface WorktreeBaseRef {
  name: string;
  label: string;
  kind: WorktreeBaseRefKind;
  current: boolean;
}

interface WorktreeBaseRefsResponse {
  refs?: WorktreeBaseRef[];
  error?: string;
}

export function useWorktreeBaseRefs(projectDir: string | null | undefined) {
  const [refs, setRefs] = useState<WorktreeBaseRef[]>([]);
  const [selectedBaseRef, setSelectedBaseRef] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedProjectDir, setLoadedProjectDir] = useState<string | null>(null);

  useEffect(() => {
    if (!projectDir) {
      return;
    }

    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setIsLoading(true);
      setError(null);
    });

    const params = new URLSearchParams({ projectDir });
    fetchWithClientId(`/api/worktrees/refs?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as WorktreeBaseRefsResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? 'Failed to load base branches');
        }
        return payload.refs ?? [];
      })
      .then((nextRefs) => {
        setLoadedProjectDir(projectDir);
        setRefs(nextRefs);
        const currentRef = nextRefs.find((ref) => ref.current) ?? nextRefs[0] ?? null;
        setSelectedBaseRef(currentRef?.name ?? '');
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        const message = loadError instanceof Error ? loadError.message : 'Failed to load base branches';
        setLoadedProjectDir(projectDir);
        setRefs([]);
        setSelectedBaseRef('');
        setError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [projectDir]);

  const isStale = Boolean(projectDir && loadedProjectDir !== projectDir);
  const effectiveRefs = useMemo(
    () => projectDir && !isStale ? refs : [],
    [isStale, projectDir, refs],
  );
  const effectiveSelectedBaseRef = projectDir && !isStale ? selectedBaseRef : '';

  const selectedRef = useMemo(
    () => effectiveRefs.find((ref) => ref.name === effectiveSelectedBaseRef) ?? null,
    [effectiveRefs, effectiveSelectedBaseRef],
  );

  return {
    refs: effectiveRefs,
    selectedBaseRef: effectiveSelectedBaseRef,
    selectedRef,
    setSelectedBaseRef,
    isLoading: Boolean(projectDir) && (isLoading || isStale),
    error: projectDir && !isStale ? error : null,
  };
}
