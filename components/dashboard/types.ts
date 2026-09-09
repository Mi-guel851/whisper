export type DashboardProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  push_notifications: boolean | null;
};

export type DashboardTopic = {
  key: string;
  label: string;
  emoji: string;
  activity: number;
};
