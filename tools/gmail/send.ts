import { ToolConfig } from '../types'
import { GmailSendParams, GmailToolResponse } from './types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const gmailSendTool: ToolConfig<GmailSendParams, GmailToolResponse> = {
  id: 'gmail_send',
  name: 'Gmail Send',
  description: 'Send emails using Gmail',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'OAuth access token for Gmail API',
    },
    to: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Recipient email address',
    },
    subject: {
      type: 'string',
      required: true,
      description: 'Email subject',
    },
    body: {
      type: 'string',
      required: true,
      description: 'Email body content',
    },
  },

  request: {
    url: () => `${GMAIL_API_BASE}/messages/send`,
    method: 'POST',
    headers: (params: GmailSendParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GmailSendParams): Record<string, any> => {
      const email = [
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        `To: ${params.to}`,
        `Subject: ${params.subject}`,
        '',
        params.body,
      ].join('\n')

      return {
        raw: Buffer.from(email).toString('base64url'),
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to send email')
    }

    return {
      success: true,
      output: {
        content: 'Email sent successfully',
        metadata: {
          id: data.id,
          threadId: data.threadId,
          labelIds: data.labelIds,
        },
      },
    }
  },

  transformError: (error) => {
    // Handle Google API error format
    if (error.error?.message) {
      if (error.error.message.includes('invalid authentication credentials')) {
        return 'Invalid or expired access token. Please reauthenticate.'
      }
      if (error.error.message.includes('quota')) {
        return 'Gmail API quota exceeded. Please try again later.'
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while sending email'
  },
}
