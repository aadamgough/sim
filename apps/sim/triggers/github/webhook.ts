import { GithubIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const githubWebhookTrigger: TriggerConfig = {
  id: 'github_webhook',
  name: 'GitHub Webhook',
  provider: 'github',
  description: 'Trigger workflow from GitHub events like push, pull requests, issues, and more',
  version: '1.0.0',
  icon: GithubIcon,

  configFields: {
    contentType: {
      type: 'select',
      label: 'Content Type',
      options: ['application/json', 'application/x-www-form-urlencoded'],
      defaultValue: 'application/json',
      description: 'Format GitHub will use when sending the webhook payload.',
      required: true,
    },
    webhookSecret: {
      type: 'string',
      label: 'Webhook Secret (Recommended)',
      placeholder: 'Generate or enter a strong secret',
      description: 'Validates that webhook deliveries originate from GitHub.',
      required: false,
      isSecret: true,
    },
    sslVerification: {
      type: 'select',
      label: 'SSL Verification',
      options: ['enabled', 'disabled'],
      defaultValue: 'enabled',
      description: 'GitHub verifies SSL certificates when delivering webhooks.',
      required: true,
    },
  },

  outputs: {
    // GitHub webhook payload structure - maps 1:1 to actual GitHub webhook body
    ref: {
      type: 'string',
      description: 'Git reference (e.g., refs/heads/fix/telegram-wh)',
    },
    before: {
      type: 'string',
      description: 'SHA of the commit before the push',
    },
    after: {
      type: 'string',
      description: 'SHA of the commit after the push',
    },
    created: {
      type: 'boolean',
      description: 'Whether the push created the reference',
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the push deleted the reference',
    },
    forced: {
      type: 'boolean',
      description: 'Whether the push was forced',
    },
    base_ref: {
      type: 'string',
      description: 'Base reference for the push',
    },
    compare: {
      type: 'string',
      description: 'URL to compare the changes',
    },
    repository: {
      type: 'string',
      description: 'Repository information as JSON string',
    },
    pusher: {
      type: 'string',
      description: 'Information about who pushed the changes as JSON string',
    },
    sender: {
      type: 'string',
      description: 'Sender information as JSON string',
    },
    commits: {
      type: 'string',
      description: 'Array of commit objects as JSON string',
    },
    head_commit: {
      type: 'string',
      description: 'Head commit object as JSON string',
    },

    // Convenient flat fields for easy access
    event_type: {
      type: 'string',
      description: 'Type of GitHub event (e.g., push, pull_request, issues)',
    },
    action: {
      type: 'string',
      description: 'The action that was performed (e.g., opened, closed, synchronize)',
    },
    branch: {
      type: 'string',
      description: 'Branch name extracted from ref',
    },
  },

  instructions: [
    'Go to your GitHub Repository > Settings > Webhooks.',
    'Click "Add webhook".',
    'Paste the <strong>Webhook URL</strong> (from above) into the "Payload URL" field.',
    'Select your chosen Content Type from the dropdown above.',
    'Enter the <strong>Webhook Secret</strong> (from above) into the "Secret" field if you\'ve configured one.',
    'Set SSL verification according to your selection above.',
    'Choose which events should trigger this webhook.',
    'Ensure "Active" is checked and click "Add webhook".',
  ],

  samplePayload: {
    action: 'opened',
    number: 1,
    pull_request: {
      id: 1,
      number: 1,
      state: 'open',
      title: 'Update README',
      user: {
        login: 'octocat',
        id: 1,
      },
      body: 'This is a pretty simple change that we need to pull into main.',
      head: {
        ref: 'feature-branch',
        sha: 'abc123',
      },
      base: {
        ref: 'main',
        sha: 'def456',
      },
    },
    repository: {
      id: 35129377,
      name: 'public-repo',
      full_name: 'baxterthehacker/public-repo',
      owner: {
        login: 'baxterthehacker',
        id: 6752317,
      },
    },
    sender: {
      login: 'baxterthehacker',
      id: 6752317,
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    },
  },
}
