import { createHash } from 'crypto';
import { Modules } from 'klayr-sdk';

export const key = Buffer.alloc(0);
export const receiptKey = (id: string) => Buffer.from(`receipt:${createHash('sha256').update(id).digest('hex')}`);
export class VotingStore extends Modules.BaseStore<{json: string}> {
 public schema = {$id:'/githubVoting/state',type:'object',required:['json'],properties:{json:{dataType:'string',fieldNumber:1}}};
}
