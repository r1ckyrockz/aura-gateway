import { z } from 'zod';

export const converseSchema = z.object({
  text: z.string().trim().min(1).max(4000).describe('What the user said or typed'),
  conversationId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Reuse to continue a conversation (needed for follow-ups and confirmations)'),
  speaker: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Identified speaker id, e.g. from a voice profile'),
  room: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Area the request comes from, e.g. the satellite area'),
  language: z.string().min(2).max(16).optional().describe('Override reply language, e.g. "de"'),
});
export type ConverseDto = z.infer<typeof converseSchema>;

export const confirmSchema = z.object({
  approve: z.boolean(),
  language: z.string().min(2).max(16).optional(),
});
export type ConfirmDto = z.infer<typeof confirmSchema>;
