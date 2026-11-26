import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(process.env.DATABASE_PATH??path.join(root,'.data','velvet-room.sqlite')),target=process.argv[2]&&path.resolve(process.argv[2]);
if(!target||target===source||existsSync(target)||!existsSync(source)){console.error('Usage: node backup.mjs <new-backup-file.sqlite>. The source must exist; the destination must be new.');process.exit(1);}
mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const db=new DatabaseSync(source,{readOnly:true});try{await backup(db,target);console.log('Database backup completed.');}finally{db.close();}
