// Node adapter for the shared MAP package validator.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {prepareMapPackage} from '../lib/map-package.js';
export async function prepareMapImport(r,filename,file,mediaDir,readNote) {
  const hash=(data,algorithm='sha256')=>crypto.createHash(algorithm).update(data).digest('hex');
  return prepareMapPackage({r,filename,readNote,hash,packageFingerprint:hash(fs.readFileSync(file)),
    readMedia:(name)=>fs.readFileSync(path.join(mediaDir,name)),
    storeMedia:(name,bytes)=>fs.writeFileSync(path.join(mediaDir,name),bytes)});
}
