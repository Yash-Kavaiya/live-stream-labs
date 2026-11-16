import { livekitSettingsSchema, type LiveKitSettingsDto } from '@studio/shared';
import type { FastifyInstance } from 'fastify';
import { parse, requireUserId, type Deps } from '../http/context';
import { deleteLiveKitSettings, getLiveKitSettings, saveLiveKitSettings } from '../services/livekit-settings';

/** Per-account settings: the LiveKit project (e.g. LiveKit Cloud) that this account's studios use. */
export function settingsRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/settings/livekit', async (req): Promise<LiveKitSettingsDto> =>
    getLiveKitSettings(deps, await requireUserId(deps, req)),
  );

  app.put('/api/settings/livekit', async (req): Promise<LiveKitSettingsDto> => {
    const userId = await requireUserId(deps, req);
    return saveLiveKitSettings(deps, userId, parse(livekitSettingsSchema, req.body));
  });

  app.delete('/api/settings/livekit', async (req): Promise<LiveKitSettingsDto> =>
    deleteLiveKitSettings(deps, await requireUserId(deps, req)),
  );
}
