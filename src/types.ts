// A simplified interface for the core attributes needed for the review
export interface MergeRequestAttributes {
  id: number;
  iid: number; // Internal MR ID
  project_id: number;
  source_branch: string;
  target_branch: string;
  action: 'open' | 'update' | 'close' | 'merge'; // The action that triggered the webhook
}

export interface WebhookProject {
  id: number;
  name: string;
}

// The complete GitLab Merge Request Webhook payload
export interface GitLabMergeRequestPayload {
  object_kind: 'merge_request';
  event_type: 'merge_request';
  user: {
    name: string;
    username: string;
  };
  project: WebhookProject;
  object_attributes: MergeRequestAttributes;
  // Other fields omitted for brevity
}