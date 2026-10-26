/**
 * Reads Home Assistant's area, device and entity registries over the WebSocket API and returns
 * `entity_id → area name`. Unlike the REST template endpoint, these list commands do not require
 * an admin user.
 */
type WebSocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error' | 'close', listener: () => void): void;
};
export type WebSocketFactory = (url: string) => WebSocketLike;

interface Area {
  area_id: string;
  name: string;
}
interface Device {
  id: string;
  area_id: string | null;
}
interface EntityEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
}

const COMMANDS = {
  1: 'config/area_registry/list',
  2: 'config/device_registry/list',
  3: 'config/entity_registry/list',
} as const;

export function websocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/api/websocket`;
}

export function buildAreaMap(
  areas: Area[],
  devices: Device[],
  entities: EntityEntry[],
): Map<string, string | null> {
  const areaNames = new Map(areas.map((a) => [a.area_id, a.name]));
  const deviceAreas = new Map(devices.map((d) => [d.id, d.area_id]));
  return new Map(
    entities.map((e) => {
      const areaId = e.area_id ?? (e.device_id ? deviceAreas.get(e.device_id) : null) ?? null;
      return [e.entity_id, areaId ? (areaNames.get(areaId) ?? null) : null];
    }),
  );
}

export function fetchAreaMap(
  baseUrl: string,
  token: string,
  timeoutMs: number,
  connect: WebSocketFactory = (url) => new WebSocket(url),
): Promise<Map<string, string | null>> {
  return new Promise((resolve, reject) => {
    const socket = connect(websocketUrl(baseUrl));
    const results: Record<number, unknown> = {};
    let settled = false;
    const finish = (error?: Error, value?: Map<string, string | null>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(new Error('Home Assistant WebSocket timed out')),
      timeoutMs,
    );

    socket.addEventListener('error', () => finish(new Error('Home Assistant WebSocket error')));
    socket.addEventListener('close', () =>
      finish(new Error('Home Assistant WebSocket closed early')),
    );
    socket.addEventListener('message', ({ data }) => {
      let message: {
        type: string;
        id?: number;
        success?: boolean;
        result?: unknown;
        error?: { message?: string };
      };
      try {
        message = JSON.parse(String(data)) as typeof message;
      } catch {
        return;
      }
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (message.type === 'auth_invalid') {
        finish(new Error('Home Assistant rejected the token'));
      } else if (message.type === 'auth_ok') {
        for (const [id, type] of Object.entries(COMMANDS))
          socket.send(JSON.stringify({ id: Number(id), type }));
      } else if (message.type === 'result' && message.id !== undefined) {
        if (!message.success) {
          finish(
            new Error(`Registry command failed: ${message.error?.message ?? 'unknown error'}`),
          );
          return;
        }
        results[message.id] = message.result;
        if (Object.keys(COMMANDS).every((id) => Number(id) in results)) {
          finish(
            undefined,
            buildAreaMap(results[1] as Area[], results[2] as Device[], results[3] as EntityEntry[]),
          );
        }
      }
    });
  });
}
