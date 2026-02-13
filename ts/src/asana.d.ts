declare module "asana" {
  export interface AsanaClient {
    workspaces: {
      getWorkspaces(opts?: object): Promise<{
        data: Array<{ gid: string; name?: string }>;
      }>;
    };
    userTaskLists: {
      getUserTaskListForUser(
        userGid: string,
        opts?: object,
      ): Promise<{ gid: string }>;
    };
    tasks: {
      getTasksForUserTaskList(
        userTaskListGid: string,
        opts?: object,
      ): Promise<{
        data: Array<{
          gid: string;
          name: string;
          completed: boolean;
          due_on: string | null;
          tags: Array<{ name?: string }> | null;
          projects: Array<{ name?: string }> | null;
          notes: string | null;
        }>;
      }>;
    };
  }

  interface AsanaModule {
    Client: {
      create(): {
        useAccessToken(token: string): AsanaClient;
      };
    };
  }

  const asana: AsanaModule;
  export default asana;
}
