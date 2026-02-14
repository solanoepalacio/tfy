import fetch from "node-fetch";

const YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3";
const VIDEO_PARTS = "snippet,statistics,topicDetails";
const VIDEO_FIELDS = "items(id,snippet(title,description,channelTitle,publishedAt,thumbnails,topicDetails),statistics(viewCount,likeCount),etag),etag";
const SEARCH_FIELDS = "etag,items(id/videoId)";

export interface YouTubeVideoSnippet {
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnails: Record<string, { url: string; width?: number; height?: number }>;
  topicDetails?: {
    topicIds?: string[];
    relevantTopicIds?: string[];
  };
}

export interface YouTubeVideoMetadata {
  id: string;
  snippet: YouTubeVideoSnippet;
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
  etag?: string;
}

export class YouTubeApiError extends Error {
  public status?: number;
  public url?: string;

  constructor(message: string, details?: { status?: number; url?: string; body?: unknown }) {
    super(message);
    this.name = "YouTubeApiError";
    if (details?.status) {
      this.status = details.status;
    }
    if (details?.url) {
      this.url = details.url;
    }
  }
}

type RequestResult<T> = { body: T; etag?: string };

export class YouTubeDataService {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const resolved = apiKey ?? process.env.YOUTUBE_API_KEY;
    if (!resolved) {
      throw new YouTubeApiError("Missing YOUTUBE_API_KEY environment variable", { url: "env://YOUTUBE_API_KEY" });
    }
    this.apiKey = resolved;
  }

  private buildUrl(path: string, params: Record<string, string | number | undefined>): URL {
    const url = new URL(`${YOUTUBE_BASE}/${path}`);
    url.searchParams.set("key", this.apiKey);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value.toString());
      }
    });
    return url;
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined>, fields: string): Promise<RequestResult<T>> {
    const url = this.buildUrl(path, { ...params, fields });
    const response = await fetch(url.href, { headers: { Accept: "application/json" } });
    const responseEtag = response.headers.get("etag") ?? undefined;
    const text = await response.text();
    if (!response.ok) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parsed = text;
      }
      throw new YouTubeApiError("YouTube API request failed", {
        status: response.status,
        url: url.toString(),
        body: parsed,
      });
    }
    const body = JSON.parse(text) as T;
    if (responseEtag) {
      console.info(`[YouTubeDataService] ${path} ETag: ${responseEtag}`);
    }
    return { body, etag: responseEtag };
  }

  private mapVideoItem(item: any): YouTubeVideoMetadata {
    const snippet = item.snippet ?? {};
    return {
      id: item.id,
      snippet: {
        title: snippet.title,
        description: snippet.description,
        channelTitle: snippet.channelTitle,
        publishedAt: snippet.publishedAt,
        thumbnails: snippet.thumbnails ?? {},
        topicDetails: snippet.topicDetails,
      },
      statistics: item.statistics ? { viewCount: item.statistics.viewCount, likeCount: item.statistics.likeCount } : undefined,
      etag: item.etag,
    };
  }

  public async fetchVideo(videoId: string): Promise<{ metadata: YouTubeVideoMetadata; etag?: string }> {
    if (!videoId) {
      throw new YouTubeApiError("videoId is required for fetchVideo");
    }
    const { body, etag } = await this.request<{ items: any[] }>("videos", { part: VIDEO_PARTS, id: videoId }, VIDEO_FIELDS);
    const item = body.items?.[0];
    if (!item) {
      throw new YouTubeApiError(`Video ${videoId} not found`, { status: 404 });
    }
    const mapped = this.mapVideoItem(item);
    console.info(`[YouTubeDataService] fetchVideo -> ${mapped.id} (${mapped.snippet.title})`);
    return { metadata: mapped, etag: etag ?? mapped.etag };
  }

  public async fetchRelated(videoId: string, maxResults = 8): Promise<{ items: YouTubeVideoMetadata[]; etag?: string }> {
    const searchResult = await this.request<{ items: Array<{ id: { videoId: string } }>; etag?: string }>(
      "search",
      {
        part: "snippet",
        relatedToVideoId: videoId,
        type: "video",
        maxResults,
      },
      SEARCH_FIELDS,
    );
    const relatedIds = searchResult.body.items
      .map((item) => item.id?.videoId)
      .filter((id): id is string => Boolean(id));
    if (relatedIds.length === 0) {
      return { items: [], etag: searchResult.etag };
    }
    const videosResult = await this.request<{ items: any[] }>(
      "videos",
      { part: VIDEO_PARTS, id: relatedIds.join(",") },
      VIDEO_FIELDS,
    );
    const items = videosResult.body.items.map((item) => this.mapVideoItem(item));
    console.info(`[YouTubeDataService] fetchRelated -> found ${items.length} videos`);
    return { items, etag: videosResult.etag ?? searchResult.etag };
  }
}
