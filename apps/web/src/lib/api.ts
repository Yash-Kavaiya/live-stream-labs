import type {
  BroadcastDto,
  CommentDto,
  CreateBroadcastInput,
  CreateDestinationInput,
  DestinationDto,
  GoLiveResult,
  InviteDto,
  LoginInput,
  RecordingDto,
  Scene,
  ServerConfigDto,
  SignupInput,
  StudioSession,
  UpdateBroadcastInput,
  UserDto,
} from '@studio/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isBlob = body instanceof Blob;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': isBlob ? body.type : 'application/json' },
    body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});

export const api = {
  config: () => get<ServerConfigDto>('/api/config'),

  me: () => get<{ user: UserDto | null }>('/api/auth/me'),
  signup: (input: SignupInput) => post<UserDto>('/api/auth/signup', input),
  login: (input: LoginInput) => post<UserDto>('/api/auth/login', input),
  logout: () => post<{ ok: true }>('/api/auth/logout'),

  destinations: () => get<DestinationDto[]>('/api/destinations'),
  createDestination: (input: CreateDestinationInput) => post<DestinationDto>('/api/destinations', input),
  deleteDestination: (id: string) => request<{ ok: true }>('DELETE', `/api/destinations/${id}`),

  broadcasts: () => get<BroadcastDto[]>('/api/broadcasts'),
  broadcast: (id: string) => get<BroadcastDto>(`/api/broadcasts/${id}`),
  createBroadcast: (input: CreateBroadcastInput) => post<BroadcastDto>('/api/broadcasts', input),
  updateBroadcast: (id: string, input: UpdateBroadcastInput) =>
    request<BroadcastDto>('PATCH', `/api/broadcasts/${id}`, input),
  deleteBroadcast: (id: string) => request<{ ok: true }>('DELETE', `/api/broadcasts/${id}`),

  hostSession: (id: string) => post<StudioSession>(`/api/broadcasts/${id}/session`),
  saveScene: (id: string, scene: Scene) => request<{ scene: Scene }>('PUT', `/api/broadcasts/${id}/scene`, { scene }),
  createInvite: (id: string) => post<InviteDto>(`/api/broadcasts/${id}/invites`),
  removeParticipant: (id: string, identity: string) =>
    post(`/api/broadcasts/${id}/participants/${encodeURIComponent(identity)}/remove`),
  muteParticipant: (id: string, identity: string, trackSid: string) =>
    post(`/api/broadcasts/${id}/participants/${encodeURIComponent(identity)}/mute`, { trackSid }),
  uploadAsset: (id: string, file: Blob) => post<{ url: string }>(`/api/broadcasts/${id}/assets`, file),

  goLive: (id: string) => post<GoLiveResult>(`/api/broadcasts/${id}/live`),
  endBroadcast: (id: string) => post<{ ok: true }>(`/api/broadcasts/${id}/end`),
  comments: (id: string) => get<CommentDto[]>(`/api/broadcasts/${id}/comments`),

  invite: (token: string) => get<{ title: string }>(`/api/invites/${token}`),
  joinInvite: (token: string, name: string) => post<StudioSession>(`/api/invites/${token}/join`, { name }),

  recordings: () => get<RecordingDto[]>('/api/recordings'),
  deleteRecording: (id: string) => request<{ ok: true }>('DELETE', `/api/recordings/${id}`),
  watch: (token: string) => get<{ title: string; createdAt: string; sizeBytes: number }>(`/api/watch/${token}`),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
