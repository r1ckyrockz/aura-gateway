import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Recorded {
  method: string;
  url: string;
  body: unknown;
  auth?: string;
}

type Handler = (req: Recorded) => unknown;

/** Minimal HTTP server that records requests and answers with JSON from a handler. */
export class FakeServer {
  readonly requests: Recorded[] = [];
  private server?: Server;

  constructor(private readonly handler: Handler) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      void readBody(req).then((raw) => {
        const recorded: Recorded = {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          body: raw ? JSON.parse(raw) : undefined,
          auth: req.headers.authorization,
        };
        this.requests.push(recorded);
        const payload = this.handler(recorded);
        if (payload === undefined) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => resolve(data));
  });
}
