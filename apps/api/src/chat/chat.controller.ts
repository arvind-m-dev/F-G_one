import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  channelMembersSchema,
  createChannelSchema,
  editMessageSchema,
  openDirectMessageSchema,
  PERMISSIONS,
  reactionSchema,
  sendMessageSchema,
  updateChannelSchema,
} from '@fg/shared';
import { z } from 'zod';
import { Auth, AuthContext, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ChatService } from './chat.service';

const messagesQuery = z.object({
  before: z.string().datetime().optional(),
  parentId: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('channels')
  mine(@Auth() auth: AuthContext) {
    return this.chat.listMine(auth);
  }

  @Get('channels/browse')
  browse(@Auth() auth: AuthContext) {
    return this.chat.browse(auth);
  }

  @Post('channels')
  @RequirePermissions(PERMISSIONS.CHANNELS_CREATE)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(createChannelSchema)) body: z.infer<typeof createChannelSchema>) {
    return this.chat.create(auth, body);
  }

  @Post('dm')
  @HttpCode(200)
  dm(@Auth() auth: AuthContext, @Body(new ZodPipe(openDirectMessageSchema)) body: z.infer<typeof openDirectMessageSchema>) {
    return this.chat.openDirect(auth, body.userIds);
  }

  @Get('channels/:id')
  details(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.details(auth, id);
  }

  @Patch('channels/:id')
  update(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(updateChannelSchema)) body: z.infer<typeof updateChannelSchema>) {
    return this.chat.update(auth, id, body);
  }

  @Post('channels/:id/join')
  @HttpCode(200)
  join(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.join(auth, id);
  }

  @Post('channels/:id/leave')
  @HttpCode(200)
  leave(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.leave(auth, id);
  }

  @Post('channels/:id/members')
  @HttpCode(200)
  addMembers(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(channelMembersSchema)) body: { userIds: string[] }) {
    return this.chat.addMembers(auth, id, body.userIds);
  }

  @Delete('channels/:id/members/:userId')
  removeMember(@Auth() auth: AuthContext, @Param('id') id: string, @Param('userId') userId: string) {
    return this.chat.removeMember(auth, id, userId);
  }

  @Patch('channels/:id/members/:userId')
  setRole(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body(new ZodPipe(z.object({ role: z.enum(['ADMIN', 'MEMBER']) }))) body: { role: 'ADMIN' | 'MEMBER' },
  ) {
    return this.chat.setMemberRole(auth, id, userId, body.role);
  }

  @Get('channels/:id/messages')
  messages(@Auth() auth: AuthContext, @Param('id') id: string, @Query(new ZodPipe(messagesQuery)) q: z.infer<typeof messagesQuery>) {
    return this.chat.messages(auth, id, q);
  }

  @Post('channels/:id/messages')
  send(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(sendMessageSchema)) body: z.infer<typeof sendMessageSchema>) {
    return this.chat.send(auth, id, body);
  }

  @Post('channels/:id/read')
  @HttpCode(200)
  read(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.markRead(auth, id);
  }

  @Patch('messages/:id')
  edit(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(editMessageSchema)) body: { body: string }) {
    return this.chat.edit(auth, id, body.body);
  }

  @Delete('messages/:id')
  remove(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.remove(auth, id);
  }

  @Post('messages/:id/reactions')
  @HttpCode(200)
  react(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(reactionSchema)) body: { emoji: string }) {
    return this.chat.toggleReaction(auth, id, body.emoji);
  }
}
