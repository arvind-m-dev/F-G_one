import { z } from 'zod';
import { PRESENCE_KEYS } from './presence';

/** Request contracts shared by the API (validation) and the web app (forms). */

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

const name = z.string().trim().min(1).max(60);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalId = z.string().min(1).max(40).nullable().optional();
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable()
  .optional();

export const createEmployeeSchema = z.object({
  email: emailSchema,
  firstName: name,
  lastName: name,
  roleId: z.string().min(1),
  departmentId: optionalId,
  managerId: optionalId,
  designation: optionalText(80),
  employeeCode: optionalText(30),
  joinedAt: optionalDate,
  sendInvite: z.boolean().default(true),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
  roleId: z.string().min(1).optional(),
  departmentId: optionalId,
  managerId: optionalId,
  designation: optionalText(80),
  employeeCode: optionalText(30),
  phone: optionalText(30),
  joinedAt: optionalDate,
  birthday: optionalDate,
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const updateProfileSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
  displayName: optionalText(60),
  phone: optionalText(30),
  bio: optionalText(280),
  pronouns: optionalText(30),
  timezone: z.string().max(60).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  birthday: optionalDate,
  showBirthday: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const setStatusSchema = z.object({
  presence: z.enum(PRESENCE_KEYS),
  emoji: z.string().max(16).nullable().optional(),
  text: z.string().trim().max(100).nullable().optional(),
  expiry: z.enum(['never', '30m', '1h', '4h', 'today']).default('never'),
});
export type SetStatusInput = z.infer<typeof setStatusSchema>;

export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: optionalText(240),
  headId: optionalId,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const listEmployeesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  departmentId: z.string().max(40).optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED', 'ALL']).default('ACTIVE'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/* ---------------- chat ---------------- */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'Use lowercase letters, numbers, - and _');

export const createChannelSchema = z.object({
  name: slug,
  description: optionalText(240),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  memberIds: z.array(z.string().min(1)).max(500).default([]),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: slug.optional(),
  description: optionalText(240),
  topic: optionalText(160),
});

export const openDirectMessageSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(8),
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message is empty').max(4000),
  parentId: z.string().max(40).nullable().optional(),
  clientId: z.string().max(60).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const channelMembersSchema = z.object({ userIds: z.array(z.string().min(1)).min(1).max(200) });

export const reactionSchema = z.object({ emoji: z.string().min(1).max(16) });
