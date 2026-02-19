declare module "asana" {
  export class ApiClient {
    authentications: Record<string, { accessToken: string }>;
  }
  export class WorkspacesApi {
    constructor(client: ApiClient);
    getWorkspaces(opts: Record<string, unknown>): Promise<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: any[];
    }>;
  }
  export class UserTaskListsApi {
    constructor(client: ApiClient);
    getUserTaskListForUser(
      user: string,
      workspaceGid: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<{ data: any }>;
  }
  export class TasksApi {
    constructor(client: ApiClient);
    getTasksForUserTaskList(
      userTaskListGid: string,
      opts: Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<{ data: any[]; _response?: { next_page?: { offset?: string } } }>;
    getSubtasksForTask(
      task_gid: string,
      opts: Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<{ data: any[] }>;
    updateTask(
      taskGid: string,
      body: { data: Record<string, unknown> },
    ): Promise<unknown>;
  }
  export class StoriesApi {
    constructor(client: ApiClient);
    getStoriesForTask(
      task_gid: string,
      opts: Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<{ data: any[] }>;
  }
}
