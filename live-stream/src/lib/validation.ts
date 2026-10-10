import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().toLowerCase().max(255).pipe(z.email('Enter a valid email')),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(255).pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required').max(128),
});

export const createRoomSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(150),
  description: z.string().trim().max(1000).optional().default(''),
});

export const roomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/, 'Invalid room ID');

// ── Socket payloads ─────────────────────────────────────────
const socketId = z.string().min(1).max(64);

export const deviceNameSchema = z.string().trim().min(1).max(40);

export const joinRoomSchema = z.object({
  roomId: roomIdSchema,
  role: z.enum(['broadcaster', 'viewer', 'remote']),
  device: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), name: deviceNameSchema }).optional(),
});

export const cameraStateSchema = z.object({
  phase: z.enum(['preview', 'live']),
  replaySupported: z.boolean(),
  replayAvailable: z.number().min(0).max(600),
  replaying: z.object({ rate: z.number().min(0.1).max(2), progress: z.number().min(0).max(1) }).nullable(),
  aspect: z.number().min(0.2).max(5),
});

export const replayCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), seconds: z.number().int().min(5).max(180), rate: z.number().min(0.25).max(1) }),
  z.object({ action: z.literal('stop') }),
  z.object({ action: z.literal('clip'), url: z.string().max(500).regex(/^\/[A-Za-z0-9_\/-]*\/api\/clips\/(ball|innings)\/\d+$/) }),
]);

export const sdpSignalSchema = z.object({
  to: socketId,
  sdp: z.object({
    type: z.enum(['offer', 'answer']),
    sdp: z.string().min(1).max(200_000),
  }),
});

export const iceSignalSchema = z.object({
  to: socketId,
  candidate: z.object({
    candidate: z.string().max(4096),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }),
});

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}
