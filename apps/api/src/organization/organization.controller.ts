import { Body, Controller, ForbiddenException, Get, NotFoundException, Patch } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { organizationSettingsSchema, parseOrganizationSettings, PERMISSIONS, updateOrganizationSchema, UpdateOrganizationInput } from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import { Auth, AuthContext, Public, RequirePermissions } from '../common/auth-context';
import { env } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

@Controller()
export class OrganizationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Unauthenticated: branding for the login screen (single-company mode). Exposes no employee data. */
  @Public()
  @Get('public/branding')
  async branding() {
    const org = await this.prisma.organization.findUnique({ where: { slug: env().DEFAULT_ORG_SLUG } });
    if (!org) throw new NotFoundException('Workspace not configured');
    const s = parseOrganizationSettings(org.settings);
    return {
      name: org.name,
      logoUrl: org.logoUrl,
      primaryColor: org.primaryColor,
      secondaryColor: org.secondaryColor,
      tagline: s.branding.tagline,
      defaultTheme: s.branding.defaultTheme,
    };
  }

  @Get('organization')
  async get(@Auth() auth: AuthContext) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    return { ...org, settings: parseOrganizationSettings(org.settings) };
  }

  @Patch('organization')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async update(@Auth() auth: AuthContext, @Body(new ZodPipe(updateOrganizationSchema)) body: UpdateOrganizationInput) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    const current = parseOrganizationSettings(org.settings);
    if (body.settings?.security && !auth.isSuperAdmin) {
      const next = organizationSettingsSchema.parse(deepMerge(current, body.settings)).security;
      if (JSON.stringify(next) !== JSON.stringify(current.security)) throw new ForbiddenException('Only a Super Admin can change security settings');
    }
    const settings = body.settings
      ? organizationSettingsSchema.parse(deepMerge(parseOrganizationSettings(org.settings), body.settings))
      : undefined;
    const updated = await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        name: body.name,
        logoUrl: body.logoUrl,
        primaryColor: body.primaryColor,
        secondaryColor: body.secondaryColor,
        ...(settings ? { settings: settings as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log(auth, 'settings.updated', 'organization', org.id, {
      fields: Object.keys(body),
      settingsSections: body.settings ? Object.keys(body.settings) : [],
    });
    return { ...updated, settings: parseOrganizationSettings(updated.settings) };
  }
}
