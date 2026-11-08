import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { projectKeys } from "./queries";
import type {
  CreateProjectResourceRequest,
  ListProjectResourcesResponse,
  ProjectCodeFile,
  SaveProjectCodeFileRequest,
  UpdateProjectResourceRequest,
} from "../types";

export const projectResourceKeys = {
  list: (wsId: string, projectId: string) =>
    [...projectKeys.detail(wsId, projectId), "resources"] as const,
  codeTree: (wsId: string, projectId: string, resourceId: string) =>
    [...projectKeys.detail(wsId, projectId), "resources", resourceId, "code", "tree"] as const,
  codeFile: (wsId: string, projectId: string, resourceId: string, path: string) =>
    [...projectKeys.detail(wsId, projectId), "resources", resourceId, "code", "file", path] as const,
};

export function projectCodeTreeOptions(wsId: string, projectId: string, resourceId: string) {
  return queryOptions({
    queryKey: projectResourceKeys.codeTree(wsId, projectId, resourceId),
    queryFn: () => api.getProjectCodeTree(projectId, resourceId),
    staleTime: 60_000,
    retry: false,
  });
}

export function projectCodeFileOptions(
  wsId: string,
  projectId: string,
  resourceId: string,
  path: string,
) {
  return queryOptions({
    queryKey: projectResourceKeys.codeFile(wsId, projectId, resourceId, path),
    queryFn: () => api.getProjectCodeFile(projectId, resourceId, path),
    staleTime: 60_000,
    retry: false,
  });
}

export function useSaveProjectCodeFile(wsId: string, projectId: string, resourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SaveProjectCodeFileRequest) =>
      api.saveProjectCodeFile(projectId, resourceId, data),
    onSuccess: (saved: ProjectCodeFile) => {
      qc.setQueryData(projectResourceKeys.codeFile(wsId, projectId, resourceId, saved.path), saved);
    },
  });
}

export function projectResourcesOptions(wsId: string, projectId: string) {
  return queryOptions({
    queryKey: projectResourceKeys.list(wsId, projectId),
    queryFn: () => api.listProjectResources(projectId),
    select: (data) => data.resources,
  });
}

export function useCreateProjectResource(wsId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectResourceRequest) =>
      api.createProjectResource(projectId, data),
    onSuccess: (created) => {
      qc.setQueryData<ListProjectResourcesResponse>(
        projectResourceKeys.list(wsId, projectId),
        (old) =>
          old && !old.resources.some((r) => r.id === created.id)
            ? {
                ...old,
                resources: [...old.resources, created],
                total: old.total + 1,
              }
            : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({
        queryKey: projectResourceKeys.list(wsId, projectId),
      });
    },
  });
}

export function useUpdateProjectResource(wsId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      resourceId,
      data,
    }: {
      resourceId: string;
      data: UpdateProjectResourceRequest;
    }) => api.updateProjectResource(projectId, resourceId, data),
    onSuccess: (updated) => {
      qc.setQueryData<ListProjectResourcesResponse>(
        projectResourceKeys.list(wsId, projectId),
        (old) =>
          old
            ? {
                ...old,
                resources: old.resources.map((r) =>
                  r.id === updated.id ? updated : r,
                ),
              }
            : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({
        queryKey: projectResourceKeys.list(wsId, projectId),
      });
    },
  });
}

export function useDeleteProjectResource(wsId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) =>
      api.deleteProjectResource(projectId, resourceId),
    onSuccess: async (_data, resourceId) => {
      // Reads started during DELETE may still contain the removed resource.
      await qc.cancelQueries({
        queryKey: projectResourceKeys.list(wsId, projectId),
      });
      qc.setQueryData<ListProjectResourcesResponse>(
        projectResourceKeys.list(wsId, projectId),
        (old) =>
          old && old.resources.some((r) => r.id === resourceId)
            ? {
                ...old,
                resources: old.resources.filter((r) => r.id !== resourceId),
                total: old.total - 1,
              }
            : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({
        queryKey: projectResourceKeys.list(wsId, projectId),
      });
    },
  });
}
