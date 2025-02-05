import { ToolConfig, ToolResponse } from '../types'

interface ExtractParams {
  urls: string | string[]
  apiKey: string
  extract_depth?: 'basic' | 'advanced'
}

interface ExtractResult {
  url: string
  raw_content: string
}

export interface ExtractResponse extends ToolResponse {
  output: {
    results: ExtractResult[]
    failed_results?: Array<{
      url: string
      error: string
    }>
    response_time: number
  }
}

export const extractTool: ToolConfig<ExtractParams, ExtractResponse> = {
  id: 'tavily_extract',
  name: 'Tavily Extract',
  description: 'Extract web page content from URLs using Tavily Extract',
  version: '1.0.0',

  params: {
    urls: {
      type: 'string',
      required: true,
      description: 'URL or array of URLs to extract content from',
    },
    apiKey: {
      type: 'string',
      required: true,
      description: 'Tavily API Key',
      requiredForToolCall: true,
    },
    extract_depth: {
      type: 'string',
      required: false,
      description: 'The depth of extraction (basic=1 credit/5 URLs, advanced=2 credits/5 URLs)',
    },
  },

  request: {
    url: 'https://api.tavily.com/extract',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        urls: typeof params.urls === 'string' ? [params.urls] : params.urls,
      }

      if (params.extract_depth) body.extract_depth = params.extract_depth

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Failed to extract content')
    }

    return {
      success: true,
      output: {
        results: data.results || [],
        ...(data.failed_results && { failed_results: data.failed_results }),
        response_time: data.response_time,
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'An error occurred while extracting content'
  },
}
